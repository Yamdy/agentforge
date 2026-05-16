import type {
  AbortSignal as AbortSignalType,
  CheckpointStore,
  PipelineContext,
  PipelineStage,
  PipelineStageConfig,
  StreamEvent,
  SuspensionSignal,
} from '@agentforge/sdk';
import type { PipelineRunner } from './pipeline.js';
import type { HookManager } from './hook-manager.js';
import type { EventBus } from './event-bus.js';
import { applyReactiveRules } from './processors/provider-history-compat.js';
import { StateMachine, type AgentState } from './state-machine.js';
import { serialize, deserialize } from './serialize.js';
import { InMemoryCheckpointStore, JsonlCheckpointStore } from './checkpoint-store.js';
import { join } from 'node:path';

const PRE_LOOP_STAGES: PipelineStage[] = ['processInput', 'buildContext'];
const LOOP_STAGES: PipelineStage[] = [
  'prepareStep', 'gateLLM', 'invokeLLM', 'processStepOutput', 'gateTool', 'executeTools', 'evaluateIteration',
];
const POST_LOOP_STAGES: PipelineStage[] = ['processOutput'];

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
}

/** Mutable state shared between loop methods for retry statistics. */
interface LoopRunState {
  compatRetries: number;
}

export class LoopOrchestrator {
  readonly stateMachine = new StateMachine();
  private checkpointStore: CheckpointStore<ReturnType<typeof serialize>>;
  private eventBus?: EventBus;
  private readonly preLoopStages: PipelineStage[];
  private readonly loopStages: PipelineStage[];
  private readonly postLoopStages: PipelineStage[];

  constructor(
    private runner: PipelineRunner,
    private hookManager: HookManager,
    checkpointStore?: CheckpointStore<ReturnType<typeof serialize>>,
    eventBus?: EventBus,
    stageConfig?: PipelineStageConfig,
  ) {
    this.checkpointStore = checkpointStore ?? new JsonlCheckpointStore<ReturnType<typeof serialize>>(
      join(process.cwd(), '.agentforge', 'checkpoints'),
    );
    this.eventBus = eventBus;
    this.preLoopStages = stageConfig?.preLoop ?? PRE_LOOP_STAGES;
    this.loopStages = stageConfig?.loop ?? LOOP_STAGES;
    this.postLoopStages = stageConfig?.postLoop ?? POST_LOOP_STAGES;
  }

  get state(): AgentState {
    return this.stateMachine.current;
  }

  // ---------------------------------------------------------------------------
  // Public: run (non-streaming) — delegates to streamCore
  // ---------------------------------------------------------------------------

  async runLoop(ctx: PipelineContext, options: LoopOptions): Promise<LoopResult> {
    const runState: LoopRunState = { compatRetries: 0 };
    let finalCtx = ctx;

    for await (const event of this.streamCore(ctx, options, runState)) {
      if (event.type === 'complete') {
        finalCtx = (event as { context: PipelineContext }).context;
      }
    }

    return { context: finalCtx, compatRetries: runState.compatRetries };
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
    const runState = sharedRunState ?? { compatRetries: 0 };

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
  ): { ctx: PipelineContext; stages: PipelineStage[] } {
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
    await this.hookManager.invoke('iteration.end', { step: loopCtx.iteration.step, sessionId }, {});
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
