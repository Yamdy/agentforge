import type {
  AbortSignal as AbortSignalType,
  CheckpointStore,
  PipelineContext,
  PipelineStage,
  StreamEvent,
  SuspensionSignal,
} from '@agentforge/sdk';
import type { PipelineRunner } from './pipeline.js';
import type { HookManager } from './hook-manager.js';
import type { EventBus } from './event-bus.js';
import { applyReactiveRules } from './processors/provider-history-compat.js';
import { StateMachine, type AgentState } from './state-machine.js';
import { serialize, deserialize } from './serialize.js';
import { InMemoryCheckpointStore } from './checkpoint-store.js';

const PRE_LOOP_STAGES: PipelineStage[] = ['processInput', 'buildContext'];
const LOOP_STAGES: PipelineStage[] = [
  'prepareStep', 'gateLLM', 'invokeLLM', 'processStepOutput', 'gateTool', 'executeTools', 'evaluateIteration',
];
const POST_LOOP_STAGES: PipelineStage[] = ['processOutput'];

export interface LoopOptions {
  maxIterations: number;
  signal?: globalThis.AbortSignal;
  modelString: string;
  sessionId: string;
  maxCompatRetries?: number;
  /** When true, saves a checkpoint after each completed iteration */
  autoCheckpoint?: boolean;
}

export class LoopOrchestrator {
  readonly stateMachine = new StateMachine();
  private checkpointStore: CheckpointStore<ReturnType<typeof serialize>>;
  private eventBus?: EventBus;

  constructor(
    private runner: PipelineRunner,
    private hookManager: HookManager,
    checkpointStore?: CheckpointStore<ReturnType<typeof serialize>>,
    eventBus?: EventBus,
  ) {
    this.checkpointStore = checkpointStore ?? new InMemoryCheckpointStore<ReturnType<typeof serialize>>();
    this.eventBus = eventBus;
  }

  get state(): AgentState {
    return this.stateMachine.current;
  }

  async runLoop(ctx: PipelineContext, options: LoopOptions): Promise<PipelineContext> {
    const { signal, maxIterations, modelString, sessionId } = options;
    const maxCompatRetries = options.maxCompatRetries ?? 3;

    this.resetToRunning();

    try {
      // Pre-loop stages
      let result = await this.runner.run(ctx, PRE_LOOP_STAGES, { signal });
      this.checkAbort(result, signal);
      await this.checkSuspendAndCheckpoint(result, ctx, sessionId);

      // Agentic loop
      let loopCtx = result as PipelineContext;
      let compatRetryCount = 0;
      for (let i = 0; i < maxIterations; i++) {
        if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

        const { ctx: stepCtx, stages } = this.computeLoopStages(loopCtx, i);
        loopCtx = stepCtx;

        try {
          result = await this.runner.run(loopCtx, stages, { signal });
        } catch (error) {
          await this.hookManager.invoke('error', { error, stage: 'invokeLLM' as PipelineStage, sessionId }, {});
          const fixed = applyReactiveRules(
            loopCtx.session.messageHistory ?? [],
            modelString,
            error,
          );
          if (fixed) {
            compatRetryCount++;
            this.eventBus?.emit('compat:retry', { step: i, sessionId, retryCount: compatRetryCount, maxRetries: maxCompatRetries });
            if (compatRetryCount > maxCompatRetries) {
              this.eventBus?.emit('compat:retry_exhausted', { step: i, sessionId, retryCount: compatRetryCount, maxRetries: maxCompatRetries });
              throw error;
            }
            loopCtx = { ...loopCtx, session: { ...loopCtx.session, messageHistory: fixed } };
            continue;
          }
          throw error;
        }
        if (this.isAbort(result)) {
          const abort = result as AbortSignalType;
          if (abort.retryFrom) {
            loopCtx = { ...loopCtx, iteration: { ...loopCtx.iteration, loopDirective: { action: 'retry', retryFrom: abort.retryFrom } } };
            continue;
          }
          throw new Error(`Agent aborted: ${abort.reason}`);
        }
        if (this.isSuspend(result)) {
          await this.saveCheckpoint(sessionId, loopCtx);
          this.stateMachine.transition('paused');
          throw new Error(`Agent suspended: ${(result as SuspensionSignal).reason}`);
        }
        loopCtx = result as PipelineContext;

        await this.hookManager.invoke('iteration.end', { step: loopCtx.iteration.step, sessionId }, {});

        if (options.autoCheckpoint) {
          await this.saveCheckpoint(sessionId, loopCtx);
        }

        if (loopCtx.iteration.loopDirective?.action === 'stop') break;
      }

      if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

      // Post-loop stage
      result = await this.runner.run(loopCtx, POST_LOOP_STAGES, { signal });
      this.checkAbort(result, signal);
      await this.checkSuspendAndCheckpoint(result, loopCtx, sessionId);

      this.stateMachine.transition('completed');
      return result as PipelineContext;
    } catch (e) {
      this.finalizeState(e);
      throw e;
    }
  }

  async resumeLoop(sessionId: string, options: LoopOptions): Promise<PipelineContext> {
    const checkpoint = await this.checkpointStore.load(sessionId);
    if (!checkpoint) throw new Error(`No checkpoint found for session: ${sessionId}`);
    const ctx = deserialize(checkpoint);
    const result = await this.runLoop(ctx, options);
    await this.checkpointStore.delete(sessionId);
    return result;
  }

  async *streamLoop(ctx: PipelineContext, options: LoopOptions): AsyncGenerator<string> {
    const { signal, maxIterations, modelString, sessionId } = options;
    const maxCompatRetries = options.maxCompatRetries ?? 3;

    this.resetToRunning();

    let loopCtx = ctx;
    let compatRetryCount = 0;
    try {
      for await (const event of this.runner.stream(loopCtx, PRE_LOOP_STAGES, { signal })) {
        if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');
        if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignalType).reason}`);
        if (event.type === 'suspended') {
          await this.saveCheckpoint(sessionId, loopCtx);
          this.stateMachine.transition('paused');
          yield ` [suspended: ${(event as { reason: string }).reason}]`;
          return;
        }
        if (event.type === 'text_delta') yield event.text;
        if (event.type === 'complete') loopCtx = (event as { context: PipelineContext }).context;
      }

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
              yield ` [suspended: ${(event as { reason: string }).reason}]`;
              return;
            }
            if (event.type === 'text_delta') yield event.text;
            if (event.type === 'complete') loopCtx = (event as { context: PipelineContext }).context;
          }
        } catch (error) {
          await this.hookManager.invoke('error', { error, stage: 'invokeLLM' as PipelineStage, sessionId }, {});
          const fixed = applyReactiveRules(
            loopCtx.session.messageHistory ?? [],
            modelString,
            error,
          );
          if (fixed) {
            compatRetryCount++;
            this.eventBus?.emit('compat:retry', { step: i, sessionId, retryCount: compatRetryCount, maxRetries: maxCompatRetries });
            if (compatRetryCount > maxCompatRetries) {
              this.eventBus?.emit('compat:retry_exhausted', { step: i, sessionId, retryCount: compatRetryCount, maxRetries: maxCompatRetries });
              throw error;
            }
            loopCtx = { ...loopCtx, session: { ...loopCtx.session, messageHistory: fixed } };
            compatRetry = true;
          } else {
            throw error;
          }
        }
        if (compatRetry) continue;
        if (loopBreak) continue;

        await this.hookManager.invoke('iteration.end', { step: loopCtx.iteration.step, sessionId }, {});

        if (options.autoCheckpoint) {
          await this.saveCheckpoint(sessionId, loopCtx);
        }

        if (loopCtx.iteration.loopDirective?.action === 'stop') break;
      }

      if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

      for await (const event of this.runner.stream(loopCtx, POST_LOOP_STAGES, { signal })) {
        if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignalType).reason}`);
        if (event.type === 'text_delta') yield event.text;
      }

      this.stateMachine.transition('completed');
    } catch (e) {
      this.finalizeState(e);
      throw e;
    }
  }

  async *streamEvents(ctx: PipelineContext, options: LoopOptions): AsyncGenerator<StreamEvent> {
    const { signal, maxIterations, modelString, sessionId } = options;
    const maxCompatRetries = options.maxCompatRetries ?? 3;

    this.resetToRunning();

    let loopCtx = ctx;
    let compatRetryCount = 0;
    try {
      for await (const event of this.runner.stream(loopCtx, PRE_LOOP_STAGES, { signal })) {
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
          await this.hookManager.invoke('error', { error, stage: 'invokeLLM' as PipelineStage, sessionId }, {});
          const fixed = applyReactiveRules(
            loopCtx.session.messageHistory ?? [],
            modelString,
            error,
          );
          if (fixed) {
            compatRetryCount++;
            this.eventBus?.emit('compat:retry', { step: i, sessionId, retryCount: compatRetryCount, maxRetries: maxCompatRetries });
            if (compatRetryCount > maxCompatRetries) {
              this.eventBus?.emit('compat:retry_exhausted', { step: i, sessionId, retryCount: compatRetryCount, maxRetries: maxCompatRetries });
              throw error;
            }
            loopCtx = { ...loopCtx, session: { ...loopCtx.session, messageHistory: fixed } };
            compatRetry = true;
          } else {
            throw error;
          }
        }
        if (compatRetry) continue;
        if (loopBreak) continue;

        await this.hookManager.invoke('iteration.end', { step: loopCtx.iteration.step, sessionId }, {});

        if (options.autoCheckpoint) {
          await this.saveCheckpoint(sessionId, loopCtx);
        }

        if (loopCtx.iteration.loopDirective?.action === 'stop') break;
      }

      if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

      for await (const event of this.runner.stream(loopCtx, POST_LOOP_STAGES, { signal })) {
        if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignalType).reason}`);
        yield event;
      }

      this.stateMachine.transition('completed');
    } catch (e) {
      this.finalizeState(e);
      throw e;
    }
  }

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
    const stages = retryFrom ? LOOP_STAGES.slice(LOOP_STAGES.indexOf(retryFrom)) : LOOP_STAGES;
    return { ctx: newCtx, stages };
  }

  private checkAbort(result: PipelineContext | AbortSignalType | SuspensionSignal, signal?: globalThis.AbortSignal): void {
    if (this.isAbort(result)) {
      throw new Error(`Agent aborted: ${(result as AbortSignalType).reason}`);
    }
    if (signal?.aborted) {
      throw new DOMException('Agent run aborted', 'AbortError');
    }
  }

  private async checkSuspendAndCheckpoint(
    result: PipelineContext | AbortSignalType | SuspensionSignal,
    ctx: PipelineContext,
    sessionId: string,
  ): Promise<void> {
    if (this.isSuspend(result)) {
      await this.saveCheckpoint(sessionId, ctx);
      this.stateMachine.transition('paused');
      throw new Error(`Agent suspended: ${(result as SuspensionSignal).reason}`);
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

  private isAbort(result: PipelineContext | AbortSignalType | SuspensionSignal): result is AbortSignalType {
    return 'type' in result && result.type === 'abort';
  }

  private isSuspend(result: PipelineContext | AbortSignalType | SuspensionSignal): result is SuspensionSignal {
    return 'type' in result && result.type === 'suspend';
  }
}
