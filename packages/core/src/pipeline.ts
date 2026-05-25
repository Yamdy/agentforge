import type {
  AbortSignal,
  ErrorResult,
  PipelineContext,
  PipelineStage,
  Processor,
  ProcessorResult,
  Span,
  StageName,
  StreamEvent,
  SuspensionSignal,
  ToolCall,
  Tracer,
  TokenUsage,
} from '@primo-ai/sdk';
import { SpanType } from '@primo-ai/sdk';
import { NoOpTracer } from '@primo-ai/observability';
import type { HookManager } from './hook-manager.js';
import type { EventBus } from './event-bus.js';
import { extractTokenUsage } from './llm-invoker.js';
import { assembleContentBlocks, textContentFromBlocks, toolCallsFromBlocks, reasoningFromBlocks } from './content-blocks.js';
import { AbortControlFlow, SuspendControlFlow, ErrorControlFlow } from './control-flow.js';
import { ProcessorContextImpl } from './processor-context.js';


/**
 * Recursively freezes an object and all nested plain objects / arrays.
 * Uses a WeakSet to guard against circular references.
 * Skips null, non-objects, and already-frozen objects.
 */
function deepFreeze<T>(obj: T, seen: WeakSet<object> = new WeakSet()): Readonly<T> {
  if (obj === null || typeof obj !== 'object') return obj as Readonly<T>;
  if (Object.isFrozen(obj)) return obj as Readonly<T>;
  if (seen.has(obj as object)) return obj as Readonly<T>;

  seen.add(obj as object);
  Object.freeze(obj);

  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
      deepFreeze(value, seen);
    }
  }

  return obj as Readonly<T>;
}

export type RunResult = PipelineContext | AbortSignal | SuspensionSignal | ErrorResult;

/** Type guard: checks if a value is a ProcessorResult (has status + summary). */
function isProcessorResult(value: unknown): value is ProcessorResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'status' in value &&
    'summary' in value &&
    typeof (value as ProcessorResult).status === 'string' &&
    typeof (value as ProcessorResult).summary === 'string'
  );
}

export interface PipelineRunnerOptions {
  tracer?: Tracer;
  hookManager?: HookManager;
  eventBus?: EventBus;
}

interface FullStreamCallbacks {
  onTextDelta?: (text: string) => void;
  onToolCall?: (tc: ToolCall) => void;
}

interface FullStreamResult {
  chunks: string[];
  toolCalls: ToolCall[];
  reasoningParts: string[];
  usage: TokenUsage | null | undefined;
}

async function parseFullStream(
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>,
  callbacks?: FullStreamCallbacks,
): Promise<FullStreamResult> {
  const chunks: string[] = [];
  const toolCalls: ToolCall[] = [];
  const reasoningParts: string[] = [];
  let usage: TokenUsage | null | undefined;

  for await (const event of fullStream) {
    if (event.type === 'text-delta') {
      chunks.push(event.text as string);
      callbacks?.onTextDelta?.(event.text as string);
    } else if (event.type === 'tool-call') {
      const tc: ToolCall = {
        id: (event.toolCallId ?? event.id ?? '') as string,
        name: (event.toolName ?? event.name ?? '') as string,
        args: (event.args ?? event.input ?? {}) as Record<string, unknown>,
      };
      toolCalls.push(tc);
      callbacks?.onToolCall?.(tc);
    } else if (event.type === 'reasoning') {
      reasoningParts.push((event.textDelta ?? event.text ?? '') as string);
    } else if (event.type === 'finish-step') {
      usage = extractTokenUsage(event.usage);
    } else if (event.type === 'error') {
      throw event.error;
    }
  }

  return { chunks, toolCalls, reasoningParts, usage };
}

async function resolveReasoningContent(
  reasoningParts: string[],
  reasoningPromise: Promise<string | undefined> | undefined,
): Promise<string | undefined> {
  let reasoningContent = reasoningParts.length > 0 ? reasoningParts.join('') : undefined;
  if (!reasoningContent && reasoningPromise) {
    try { reasoningContent = await reasoningPromise ?? undefined; } catch { /* ignore */ }
  }
  return reasoningContent;
}

/** Build a final ContentBlock from accumulated block data at content_block_end time. */
function buildFinalBlock(
  block: { type: string; chunks: string[] },
  _toolCalls: ToolCall[],
  _reasoningParts: string[],
  _textParts: string[],
): import('@primo-ai/sdk').ContentBlock | null {
  if (block.type === 'text') {
    return { type: 'text', text: block.chunks.join('') };
  }
  if (block.type === 'thinking') {
    return { type: 'thinking', text: block.chunks.join('') };
  }
  return null;
}

export class PipelineRunner {
  private processors: Processor[] = [];
  private tracer: Tracer;
  private hookManager?: HookManager;
  private eventBus?: EventBus;
  private _currentProcessorCtx?: ProcessorContextImpl;
  /** @internal Collected ProcessorResults from the last executeStage call, for stream emission. */
  _lastStageProcessorResults: Array<{ stage: StageName; result: ProcessorResult }> = [];

  constructor(options?: PipelineRunnerOptions) {
    this.tracer = options?.tracer ?? new NoOpTracer();
    this.hookManager = options?.hookManager;
    this.eventBus = options?.eventBus;
  }

  register(processor: Processor): void {
    this.processors.push(processor);
  }

  unregister(stage: StageName): void {
    this.processors = this.processors.filter((p) => p.stage !== stage);
  }

  replace(stage: StageName, processor: Processor): void {
    this.processors = this.processors.filter((p) => p.stage !== stage);
    this.processors.push(processor);
  }

  setHookManager(hookManager: HookManager): void {
    this.hookManager = hookManager;
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  async run(context: PipelineContext, stages: StageName[], options?: { signal?: globalThis.AbortSignal }): Promise<RunResult> {
    const rootSpan = this.tracer.startSpan(SpanType.AGENT_RUN);
    const signal = options?.signal;
    let ctx = context;

    try {
      for (const stage of stages) {
        if (signal?.aborted) throw new DOMException('Pipeline aborted', 'AbortError');
        const stageSpan = rootSpan.startChild(stage);
        try {
          const stageResult = await this.executeStage(ctx, stage, stageSpan);
          if (this.isAbort(stageResult) || this.isSuspend(stageResult)) {
            stageSpan.end();
            rootSpan.end();
            return stageResult;
          }
          if (this.isError(stageResult)) {
            stageSpan.end();
            if (this.hookManager) {
              try { await this.hookManager.invoke('error', { error: stageResult.error, stage: stageResult.stage }, {}); } catch { /* hook error must not mask original */ }
            }
            rootSpan.end();
            return stageResult;
          }
          ctx = stageResult;
          ctx = await this.consumeStream(ctx);

          // Fire llm.after after stream is consumed (response is now available)
          if (stage === 'invokeLLM' && this.hookManager && (ctx.iteration as unknown as { _modelString?: string })._modelString) {
            await this.hookManager.invoke('llm.after', { model: (ctx.iteration as unknown as { _modelString?: string })._modelString }, { response: ctx.iteration.response, content: ctx.iteration.content });
          }

          // Auto-enrich span with token usage after stream consumption
          if (stage === 'invokeLLM' && ctx.iteration.tokenUsage) {
            stageSpan.setAttribute('tokens.input', ctx.iteration.tokenUsage.input);
            stageSpan.setAttribute('tokens.output', ctx.iteration.tokenUsage.output);
          }
        } catch (error) {
          if (this.hookManager) {
            try { await this.hookManager.invoke('error', { error, stage }, {}); } catch { /* hook error must not mask original */ }
          }
          throw error;
        } finally {
          stageSpan.end();
        }
      }
    } finally {
      rootSpan.end();
    }

    return ctx;
  }

  async *stream(context: PipelineContext, stages: StageName[], options?: { signal?: globalThis.AbortSignal }): AsyncGenerator<StreamEvent> {
    const rootSpan = this.tracer.startSpan(SpanType.AGENT_RUN);
    const signal = options?.signal;
    let ctx = context;

    try {
      for (const stage of stages) {
        if (signal?.aborted) throw new DOMException('Pipeline aborted', 'AbortError');
        yield { type: 'stage_start', stage };
        const stageSpan = rootSpan.startChild(stage);
        try {
          const stageResult = await this.executeStage(ctx, stage, stageSpan);
          if (this.isAbort(stageResult)) {
            stageSpan.end();
            rootSpan.end();
            yield { type: 'abort', reason: stageResult.reason, ...(stageResult.retryFrom ? { retryFrom: stageResult.retryFrom } : {}) };
            return;
          }
          if (this.isSuspend(stageResult)) {
            stageSpan.end();
            rootSpan.end();
            yield { type: 'suspended', suspensionId: stageResult.suspensionId, reason: stageResult.reason, checkpoint: stageResult.checkpoint };
            return;
          }
          if (this.isError(stageResult)) {
            stageSpan.end();
            if (this.hookManager) {
              try { await this.hookManager.invoke('error', { error: stageResult.error, stage: stageResult.stage }, {}); } catch { /* hook error must not mask original */ }
            }
            rootSpan.end();
            yield { type: 'error', error: stageResult.error, stage: stageResult.stage, recoverable: stageResult.recoverable };
            return;
          }
          ctx = stageResult;

          // Emit processor_result stream events for any ProcessorResults from this stage
          for (const pr of this._lastStageProcessorResults) {
            yield { type: 'processor_result' as const, stage: pr.stage, result: pr.result };
          }

          const fullStream = this._currentProcessorCtx?._streamHandle?.fullStream;
          if (fullStream) {
            const chunks: string[] = [];
            const toolCalls: ToolCall[] = [];
            const reasoningParts: string[] = [];
            let usage: TokenUsage | null | undefined;

            // Content block lifecycle tracking
            let currentBlockType: string | null = null;
            let currentBlockIndex = -1;
            const openBlocks: Array<{ type: string; chunks: string[] }> = [];

            for await (const event of fullStream as AsyncIterable<{ type: string; [key: string]: unknown }>) {
              if (event.type === 'text-delta') {
                const text = event.text as string;
                chunks.push(text);

                // Emit content_block_start on first text delta
                if (currentBlockType !== 'text') {
                  if (currentBlockType !== null) {
                    // Close previous block
                    const prevIdx = currentBlockIndex;
                    const prevBlock = buildFinalBlock(openBlocks[prevIdx], toolCalls, reasoningParts, chunks);
                    if (prevBlock) yield { type: 'content_block_end', index: prevIdx, block: prevBlock };
                  }
                  currentBlockType = 'text';
                  currentBlockIndex++;
                  openBlocks.push({ type: 'text', chunks: [] });
                  yield { type: 'content_block_start', blockType: 'text', index: currentBlockIndex } as StreamEvent;
                }
                openBlocks[currentBlockIndex].chunks.push(text);
                yield { type: 'content_block_delta', index: currentBlockIndex, delta: text } as StreamEvent;

                // Backward compat
                yield { type: 'text_delta', text };
              } else if (event.type === 'tool-call') {
                const tc: ToolCall = {
                  id: (event.toolCallId ?? event.id ?? '') as string,
                  name: (event.toolName ?? event.name ?? '') as string,
                  args: (event.args ?? event.input ?? {}) as Record<string, unknown>,
                };
                toolCalls.push(tc);

                // Close any open text block first
                if (currentBlockType === 'text') {
                  const prevBlock = buildFinalBlock(openBlocks[currentBlockIndex], toolCalls, reasoningParts, chunks);
                  if (prevBlock) yield { type: 'content_block_end', index: currentBlockIndex, block: prevBlock };
                }

                // Start tool-call block
                currentBlockType = 'tool-call';
                currentBlockIndex++;
                yield { type: 'content_block_start', blockType: 'tool-call', index: currentBlockIndex } as StreamEvent;

                // Tool-call blocks end immediately (no delta stream)
                const toolBlock = { type: 'tool-call' as const, id: tc.id, name: tc.name, args: tc.args };
                yield { type: 'content_block_end', index: currentBlockIndex, block: toolBlock } as StreamEvent;

                currentBlockType = null; // Reset — next event starts a new block

                // Backward compat
                yield { type: 'tool_call', name: tc.name, args: tc.args };
              } else if (event.type === 'reasoning') {
                const delta = (event.textDelta ?? event.text ?? '') as string;
                reasoningParts.push(delta);

                // Emit content_block_start on first reasoning delta
                if (currentBlockType !== 'thinking') {
                  if (currentBlockType !== null) {
                    // Close previous block
                    const prevBlock = buildFinalBlock(openBlocks[currentBlockIndex], toolCalls, reasoningParts, chunks);
                    if (prevBlock) yield { type: 'content_block_end', index: currentBlockIndex, block: prevBlock };
                  }
                  currentBlockType = 'thinking';
                  currentBlockIndex++;
                  openBlocks.push({ type: 'thinking', chunks: [] });
                  yield { type: 'content_block_start', blockType: 'thinking', index: currentBlockIndex } as StreamEvent;
                }
                openBlocks[currentBlockIndex].chunks.push(delta);
                yield { type: 'content_block_delta', index: currentBlockIndex, delta } as StreamEvent;
              } else if (event.type === 'finish-step') {
                usage = extractTokenUsage(event.usage);
              } else if (event.type === 'error') {
                throw event.error;
              }
            }

            // Close any remaining open block
            if (currentBlockType !== null && currentBlockIndex >= 0 && openBlocks[currentBlockIndex]) {
              const finalBlock = buildFinalBlock(openBlocks[currentBlockIndex], toolCalls, reasoningParts, chunks);
              if (finalBlock) yield { type: 'content_block_end', index: currentBlockIndex, block: finalBlock } as StreamEvent;
            }

            const reasoningContent = await resolveReasoningContent(reasoningParts, this._currentProcessorCtx?._streamHandle?.reasoningPromise);
            const pendingUsage = this._currentProcessorCtx?._streamHandle?.usagePromise
              ? await this._currentProcessorCtx?._streamHandle?.usagePromise
              : undefined;

            const content = assembleContentBlocks(chunks, toolCalls, reasoningParts);
            ctx = deepFreeze({
              ...ctx,
              iteration: {
                ...ctx.iteration,
                content,
                response: textContentFromBlocks(content) || ctx.iteration.response || '',
                pendingToolCalls: toolCallsFromBlocks(content).length > 0 ? toolCallsFromBlocks(content) : undefined,
                reasoningContent: reasoningFromBlocks(content) ?? reasoningContent,
                tokenUsage: usage ?? pendingUsage ?? undefined,
              },
            });

            // Emit step_complete after stream consumption
            if (stage === 'invokeLLM' && usage) {
              yield { type: 'step_complete', step: ctx.iteration.step, tokenUsage: usage, content: content } as StreamEvent;
            }
          }
          // Clear consumed stream handle to prevent stale propagation
          if (this._currentProcessorCtx) this._currentProcessorCtx._streamHandle = undefined;

          // Fire llm.after after stream is consumed (response is now available)
          if (stage === 'invokeLLM' && this.hookManager && (ctx.iteration as unknown as { _modelString?: string })._modelString) {
            await this.hookManager.invoke('llm.after', { model: (ctx.iteration as unknown as { _modelString?: string })._modelString }, { response: ctx.iteration.response, content: ctx.iteration.content });
          }

          // Auto-enrich span with token usage after stream consumption
          if (stage === 'invokeLLM' && ctx.iteration.tokenUsage) {
            stageSpan.setAttribute('tokens.input', ctx.iteration.tokenUsage.input);
            stageSpan.setAttribute('tokens.output', ctx.iteration.tokenUsage.output);
          }
        } finally {
          stageSpan.end();
        }
        yield { type: 'stage_complete', stage };
      }
    } finally {
      rootSpan.end();
    }

    yield { type: 'complete', context: ctx };
  }

  private async executeStage(
    ctx: PipelineContext,
    stage: StageName,
    stageSpan: Span,
  ): Promise<PipelineContext | AbortSignal | SuspensionSignal | ErrorResult> {
    const stageProcessors = this.processors.filter((p) => p.stage === stage);
    if (stageProcessors.length === 0) return ctx;
    if (stageProcessors.every((p) => p.isNoOp)) return ctx;

    // Sort by priority descending (default 100), stable for same priority
    stageProcessors.sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));

    // stage.before hook
    if (this.hookManager) {
      await this.hookManager.invoke('stage.before', { stage, context: ctx }, {});
    }

    let currentCtx = ctx;
    this._lastStageProcessorResults = [];
    for (const processor of stageProcessors) {
      // Create mutable context for processor (don't freeze before processor execution)
      try {
        const processorCtx = new ProcessorContextImpl(currentCtx);
        processorCtx.span = stageSpan;
        const prevHandle = this._currentProcessorCtx?._streamHandle;
        if (prevHandle) processorCtx._streamHandle = prevHandle;
        this._currentProcessorCtx = processorCtx;
        const result = await processor.execute(processorCtx);

        // If processor returned a ProcessorResult, emit observation event and use state
        if (isProcessorResult(result)) {
          this.eventBus?.emit('processor:result', {
            stage,
            processorResult: result,
            sessionId: currentCtx.session.sessionId,
          });
          this._lastStageProcessorResults.push({ stage, result });
          // Context was mutated in-place via pCtx.state
          currentCtx = deepFreeze({ ...processorCtx.state });
        } else {
          // Freeze result after processor execution for immutability between stages
          // result is PipelineContext | void here (ProcessorResult handled above)
          currentCtx = deepFreeze(result ? { ...(result as PipelineContext) } : { ...processorCtx.state });
        }
      } catch (error) {
        // Handle control flow exceptions from v2 API
        if (error instanceof AbortControlFlow) {
          return {
            type: 'abort',
            reason: error.reason,
            retryFrom: error.retryFrom,
          };
        }
        if (error instanceof SuspendControlFlow) {
          const checkpoint = error.checkpoint?.context
            ? { ...error.checkpoint, context: error.checkpoint.context }
            : {
                context: currentCtx,
                nextStages: [],
                iteration: currentCtx.iteration.step,
              };
          return {
            type: 'suspend',
            suspensionId: error.suspensionId,
            reason: `Suspended at stage: ${stage}`,
            checkpoint: checkpoint as import('@primo-ai/sdk').PipelineCheckpoint,
          };
        }
        if (error instanceof ErrorControlFlow) {
          return {
            type: 'error',
            error: error.originalError,
            stage: error.stage,
            recoverable: error.recoverable,
          };
        }
        // Re-throw unexpected errors
        throw error;
      }
    }

    // stage.after hook
    if (this.hookManager) {
      await this.hookManager.invoke('stage.after', { stage, context: currentCtx }, {});
    }

    return currentCtx;
  }

  private isAbort(result: RunResult): result is AbortSignal {
    return 'type' in result && result.type === 'abort';
  }

  private isSuspend(result: RunResult): result is SuspensionSignal {
    return 'type' in result && result.type === 'suspend';
  }

  private isError(result: RunResult): result is ErrorResult {
    return 'type' in result && result.type === 'error';
  }

  private async consumeStream(ctx: PipelineContext): Promise<PipelineContext> {
    const fullStream = this._currentProcessorCtx?._streamHandle?.fullStream;
    if (!fullStream) return ctx;

    const result = await parseFullStream(fullStream as AsyncIterable<{ type: string; [key: string]: unknown }>);
    const reasoningContent = await resolveReasoningContent(result.reasoningParts, this._currentProcessorCtx?._streamHandle?.reasoningPromise);
    const pendingUsage = this._currentProcessorCtx?._streamHandle?.usagePromise
      ? await this._currentProcessorCtx?._streamHandle?.usagePromise
      : undefined;

    const content = assembleContentBlocks(result.chunks, result.toolCalls, result.reasoningParts);
    if (this._currentProcessorCtx) this._currentProcessorCtx._streamHandle = undefined;
    return deepFreeze({
      ...ctx,
      iteration: {
        ...ctx.iteration,
        content,
        response: textContentFromBlocks(content) || ctx.iteration.response || '',
        pendingToolCalls: toolCallsFromBlocks(content).length > 0 ? toolCallsFromBlocks(content) : undefined,
        reasoningContent: reasoningFromBlocks(content) ?? reasoningContent,
        tokenUsage: result.usage ?? pendingUsage ?? undefined,
      },
    });
  }
}
