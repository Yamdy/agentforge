import type {
  AbortSignal as AbortSignalType,
  CheckpointStore,
  PipelineContext,
  PipelineStage,
  PipelineStageConfig,
  StageMutation,
  StageName,
  StreamEvent,
  SnapshotService,
} from '@primo-ai/sdk';
import type { PipelineRunner } from './pipeline.js';
import type { HookManager } from './hook-manager.js';
import type { EventBus } from './event-bus.js';
import { applyReactiveRules } from './processors/provider-history-compat.js';
import { StateMachine, type AgentState } from './state-machine.js';
import { serialize, deserialize } from './serialize.js';
import { InMemoryCheckpointStore, JsonlCheckpointStore } from './checkpoint-store.js';
import { Runner } from './runner.js';
import { join } from 'node:path';
import type { CircuitBreaker } from './circuit-breaker.js';
import type { RetryStateStore } from './retry-state-store.js';

const PRE_LOOP_STAGES: PipelineStage[] = ['processInput', 'buildContext'];
const LOOP_STAGES: PipelineStage[] = [
  'prepareStep', 'gateLLM', 'invokeLLM', 'processStepOutput', 'gateTool', 'executeTools', 'evaluateIteration',
];
const POST_LOOP_STAGES: PipelineStage[] = ['processOutput'];

// ---------------------------------------------------------------------------
// RunMode — concurrent control for shell-interrupt
// ---------------------------------------------------------------------------

export enum RunMode {
  Normal = 'Normal',
  Shell = 'Shell',
}

/** Allowed RunMode transitions (excluding self -> self no-ops). */
const RUN_MODE_TRANSITIONS: Record<RunMode, RunMode[]> = {
  [RunMode.Normal]: [RunMode.Shell],
  [RunMode.Shell]: [RunMode.Normal],
};

/** Result of runLoop / resumeLoop, carrying both the final context and retry statistics. */
export interface LoopResult {
  context: PipelineContext;
  compatRetries: number;
}

export interface LoopOptions {
  maxIterations: number;
  signal?: globalThis.AbortSignal;
  modelString: string;
  sessionId: string;
  maxCompatRetries?: number;
  /** When true, saves a checkpoint after each completed iteration */
  autoCheckpoint?: boolean;
  /** Max times a processor can retryFrom the same stage per loop (default: 3) */
  maxProcessorRetries?: number;
  /** Persistent retry state store for survival across process restarts */
  retryStateStore?: RetryStateStore;
  /** Circuit breaker to prevent cascading failures */
  circuitBreaker?: CircuitBreaker;
}

/** Mutable state shared between loop methods for retry statistics. */
interface LoopRunState {
  compatRetries: number;
}

export class LoopOrchestrator {
  readonly stateMachine = new StateMachine();
  /** Runner instance for structured concurrency control */
  readonly taskRunner = new Runner();
  private checkpointStore: CheckpointStore<ReturnType<typeof serialize>>;
  private eventBus?: EventBus;
  private preLoopStages: StageName[];
  private loopStages: StageName[];
  private postLoopStages: StageName[];
  /** Optional snapshot service for file system auditing on suspend */
  private snapshotService?: SnapshotService;

  // ---------------------------------------------------------------------------
  // RunMode (concurrent control)
  // ---------------------------------------------------------------------------

  private _mode: RunMode = RunMode.Normal;
  private _pendingRun: {
    ctx: PipelineContext;
    options: LoopOptions;
    resolve: (result: LoopResult) => void;
    reject: (err: unknown) => void;
  } | null = null;
  private _onModeChange: ((mode: RunMode) => void) | null = null;

  /** Current run mode. Defaults to `RunMode.Normal`. */
  get mode(): RunMode {
    return this._mode;
  }

  /**
   * Set the run mode. Valid transitions:
   * - Normal -> Shell (queues subsequent runs)
   * - Shell -> Normal (drains the queued run)
   * - Same -> Same (no-op)
   */
  setMode(mode: RunMode): void {
    if (mode === this._mode) return;
    const allowed = RUN_MODE_TRANSITIONS[this._mode];
    if (!allowed?.includes(mode)) {
      throw new Error(`Invalid RunMode transition: ${this._mode} -> ${mode}`);
    }
    const prev = this._mode;
    this._mode = mode;
    if (prev === RunMode.Shell && mode === RunMode.Normal) {
      this.drainQueue();
    }
    this._onModeChange?.(mode);
  }

  /**
   * Register a callback invoked on every mode change (no-op transitions excluded).
   */
  onModeChange(cb: (mode: RunMode) => void): void {
    this._onModeChange = cb;
  }

  private enqueueRun(ctx: PipelineContext, options: LoopOptions): Promise<LoopResult> {
    if (this._pendingRun) {
      return Promise.reject(new Error('A run is already queued; only one pending run allowed'));
    }
    return new Promise<LoopResult>((resolve, reject) => {
      this._pendingRun = { ctx, options, resolve, reject };
    });
  }

  private drainQueue(): void {
    if (!this._pendingRun) return;
    const { ctx, options, resolve, reject } = this._pendingRun;
    this._pendingRun = null;
    this.runLoop(ctx, options).then(resolve).catch(reject);
  }

  constructor(
    private runner: PipelineRunner,
    private hookManager: HookManager,
    checkpointStore?: CheckpointStore<ReturnType<typeof serialize>>,
    eventBus?: EventBus,
    stageConfig?: PipelineStageConfig,
    snapshotService?: SnapshotService,
  ) {
    this.checkpointStore = checkpointStore ?? new JsonlCheckpointStore<ReturnType<typeof serialize>>(
      join(process.cwd(), '.agentforge', 'checkpoints'),
    );
    this.eventBus = eventBus;
    this.preLoopStages = stageConfig?.preLoop ?? PRE_LOOP_STAGES;
    this.loopStages = stageConfig?.loop ?? LOOP_STAGES;
    this.postLoopStages = stageConfig?.postLoop ?? POST_LOOP_STAGES;
    this.snapshotService = snapshotService;
  }

  get state(): AgentState {
    return this.stateMachine.current;
  }

  get stageConfig(): PipelineStageConfig {
    return {
      preLoop: [...this.preLoopStages],
      loop: [...this.loopStages],
      postLoop: [...this.postLoopStages],
    };
  }

  applyMutation(mutation: StageMutation): void {
    if (this.stateMachine.current !== 'pending') {
      throw new Error(`Stage mutations only allowed before first run (current: ${this.stateMachine.current})`);
    }
    const arr = mutation.phase === 'preLoop' ? this.preLoopStages
      : mutation.phase === 'loop' ? this.loopStages
      : this.postLoopStages;

    switch (mutation.type) {
      case 'insert': {
        const idx = arr.indexOf(mutation.after);
        if (idx === -1) throw new Error(`Stage "${mutation.after}" not found in ${mutation.phase}`);
        arr.splice(idx + 1, 0, mutation.stage);
        break;
      }
      case 'remove': {
        const idx = arr.indexOf(mutation.stage);
        if (idx === -1) throw new Error(`Stage "${mutation.stage}" not found in ${mutation.phase}`);
        arr.splice(idx, 1);
        break;
      }
      case 'replace': {
        if (mutation.phase === 'loop' && !mutation.stages.includes('invokeLLM')) {
          throw new Error('Cannot replace loop stages: required stage "invokeLLM" is missing');
        }
        arr.length = 0;
        arr.push(...mutation.stages);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public: run (non-streaming) — delegates to streamCore
  // ---------------------------------------------------------------------------

  async runLoop(ctx: PipelineContext, options: LoopOptions): Promise<LoopResult> {
    if (this._mode === RunMode.Shell) {
      return this.enqueueRun(ctx, options);
    }

    // Use Runner.ensureRunning for structured concurrency
    return this.taskRunner.ensureRunning(async () => {
      const runState: LoopRunState = { compatRetries: 0 };
      let finalCtx = ctx;

      for await (const event of this.streamCore(ctx, options, runState)) {
        if (event.type === 'complete') {
          finalCtx = (event as { context: PipelineContext }).context;
        }
      }

      return { context: finalCtx, compatRetries: runState.compatRetries };
    });
  }

  async resumeLoop(sessionId: string, options: LoopOptions): Promise<LoopResult> {
    const checkpoint = await this.checkpointStore.load(sessionId);
    if (!checkpoint) throw new Error(`No checkpoint found for session: ${sessionId}`);
    const ctx = deserialize(checkpoint);
    const result = await this.runLoop(ctx, options);
    await this.checkpointStore.delete(sessionId);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Public: streamLoop (yields text deltas)
  // ---------------------------------------------------------------------------

  async *streamLoop(ctx: PipelineContext, options: LoopOptions): AsyncGenerator<string> {
    for await (const event of this.streamCore(ctx, options)) {
      if (event.type === 'text_delta') yield event.text;
      if (event.type === 'suspended') yield ` [suspended: ${(event as { reason: string }).reason}]`;
    }
  }

  // ---------------------------------------------------------------------------
  // Public: streamEvents (yields StreamEvents)
  // ---------------------------------------------------------------------------

  async *streamEvents(ctx: PipelineContext, options: LoopOptions): AsyncGenerator<StreamEvent> {
    yield* this.streamCore(ctx, options);
  }

  // ---------------------------------------------------------------------------
  // Core streaming loop — single source of truth for streamLoop + streamEvents
  // ---------------------------------------------------------------------------

  private async *streamCore(
    ctx: PipelineContext,
    options: LoopOptions,
    sharedRunState?: LoopRunState,
  ): AsyncGenerator<StreamEvent> {
    const { signal, maxIterations, modelString, sessionId } = options;
    const maxCompatRetries = options.maxCompatRetries ?? 3;
    const maxProcessorRetries = options.maxProcessorRetries ?? 3;
    const runState = sharedRunState ?? { compatRetries: 0 };
    const processorRetryCounts = new Map<PipelineStage, number>();
    // Load persisted retry counts from store (survives process restart)
    if (options.retryStateStore) {
      const entries = await options.retryStateStore.list(sessionId);
      for (const e of entries) {
        processorRetryCounts.set(e.key as PipelineStage, e.count);
      }
    }

    this.resetToRunning();

    let loopCtx = ctx;
    try {
      // Pre-loop stages
      for await (const event of this.runner.stream(loopCtx, this.preLoopStages, { signal })) {
        if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');
        if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignalType).reason}`);
        if (event.type === 'suspended') {
          await this.saveCheckpoint(sessionId, loopCtx);
          this.stateMachine.transition('paused');
          yield event;
          return;
        }
        if (event.type === 'error') throw event.error;
        if (event.type === 'complete') loopCtx = (event as { context: PipelineContext }).context;
        yield event;
      }

      // Agentic loop
      for (let i = 0; i < maxIterations; i++) {
        if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

        const { ctx: stepCtx, stages } = this.computeLoopStages(loopCtx, i);
        loopCtx = stepCtx;

        let loopBreak = false;
        let compatRetry = false;
        try {
          for await (const event of this.runner.stream(loopCtx, stages, { signal })) {
            if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');
            if (event.type === 'abort') {
              const abortEvent = event as { type: 'abort'; reason: string; retryFrom?: PipelineStage };
              if (abortEvent.retryFrom) {
                const count = (processorRetryCounts.get(abortEvent.retryFrom) ?? 0) + 1;
                if (count > maxProcessorRetries) {
                  this.eventBus?.emit('processor:retry_exhausted', { stage: abortEvent.retryFrom, retries: count - 1, max: maxProcessorRetries });
                  throw new Error(`Processor retry budget exhausted for ${abortEvent.retryFrom}: ${abortEvent.reason}`);
                }
                processorRetryCounts.set(abortEvent.retryFrom, count);
                await options.retryStateStore?.increment(sessionId, abortEvent.retryFrom);
                loopCtx = { ...loopCtx, iteration: { ...loopCtx.iteration, loopDirective: { action: 'retry', retryFrom: abortEvent.retryFrom } } };
                loopBreak = true;
                break;
              }
              throw new Error(`Agent aborted: ${abortEvent.reason}`);
            }
            if (event.type === 'suspended') {
              await this.saveCheckpoint(sessionId, loopCtx);
              this.stateMachine.transition('paused');
              yield event;
              return;
            }
            if (event.type === 'error') {
              if (event.recoverable) {
                this.eventBus?.emit('pipeline:stage_error', { stage: event.stage, error: event.error });
                loopBreak = true;
                break;
              }
              throw event.error;
            }
            if (event.type === 'complete') loopCtx = (event as { context: PipelineContext }).context;
            yield event;
          }
        } catch (error) {
          loopCtx = await this.handleLoopError(error, loopCtx, i, sessionId, modelString, maxCompatRetries, runState);
          compatRetry = true;
        }
        if (compatRetry) continue;
        if (loopBreak) continue;

        await this.afterIteration(loopCtx, sessionId, options.autoCheckpoint);
        if (loopCtx.iteration.loopDirective?.action === 'stop') break;
      }

      if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

      // Post-loop stages
      for await (const event of this.runner.stream(loopCtx, this.postLoopStages, { signal })) {
        if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignalType).reason}`);
        yield event;
      }

      this.stateMachine.transition('completed');
    } catch (e) {
      this.finalizeState(e);
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  private resetToRunning(): void {
    if (this.stateMachine.current !== 'pending') {
      this.stateMachine.transition('pending');
    }
    this.stateMachine.transition('running');
  }

  private async saveCheckpoint(sessionId: string, ctx: PipelineContext): Promise<void> {
    await this.checkpointStore.save(sessionId, serialize(ctx));
  }

  private computeLoopStages(
    ctx: PipelineContext,
    step: number,
  ): { ctx: PipelineContext; stages: StageName[] } {
    const prevDirective = ctx.iteration.loopDirective;
    const newCtx = { ...ctx, iteration: { ...ctx.iteration, step, loopDirective: undefined } };
    const retryFrom = prevDirective?.action === 'retry' ? prevDirective.retryFrom : undefined;
    const stages = retryFrom ? this.loopStages.slice(this.loopStages.indexOf(retryFrom)) : this.loopStages;
    return { ctx: newCtx, stages };
  }

  /** Handle compat retry logic. Returns updated loopCtx on retry, throws on unrecoverable error. */
  private async handleLoopError(
    error: unknown,
    loopCtx: PipelineContext,
    step: number,
    sessionId: string,
    modelString: string,
    maxCompatRetries: number,
    runState: LoopRunState,
  ): Promise<PipelineContext> {
    await this.hookManager.invoke('error', { error, stage: 'invokeLLM' as PipelineStage, sessionId }, {});
    const compatResult = applyReactiveRules(
      loopCtx.session.messageHistory ?? [],
      modelString,
      error,
    );
    if (!compatResult) throw error;

    runState.compatRetries++;
    this.eventBus?.emit('compat:retry', { step, sessionId, retryCount: runState.compatRetries, maxRetries: maxCompatRetries });
    this.eventBus?.emit('compat:diff', { step, sessionId, diff: compatResult.diff });
    if (runState.compatRetries > maxCompatRetries) {
      this.eventBus?.emit('compat:retry_exhausted', { step, sessionId, retryCount: runState.compatRetries, maxRetries: maxCompatRetries });
      throw error;
    }
    return { ...loopCtx, session: { ...loopCtx.session, messageHistory: compatResult.history } };
  }

  private async afterIteration(
    loopCtx: PipelineContext,
    sessionId: string,
    autoCheckpoint?: boolean,
  ): Promise<void> {
    await this.hookManager.invoke('iteration.end', { step: loopCtx.iteration.step, sessionId, response: loopCtx.iteration.response, content: loopCtx.iteration.content }, {});
    if (autoCheckpoint) {
      await this.saveCheckpoint(sessionId, loopCtx);
    }
  }

  private finalizeState(e: unknown): void {
    if (this.stateMachine.current !== 'running') return;
    if (e instanceof DOMException && e.name === 'AbortError') {
      this.stateMachine.transition('cancelled');
    } else {
      this.stateMachine.transition('error');
    }
  }
}
