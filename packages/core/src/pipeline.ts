import type {
  AbortSignal,
  PipelineContext,
  PipelineStage,
  Processor,
  ProcessorResult,
  Span,
  StreamEvent,
  SuspensionSignal,
  ToolCall,
  Tracer,
  TokenUsage,
} from '@agentforge/sdk';
import { SpanType } from '@agentforge/sdk';
import { NoOpTracer } from '@agentforge/observability';
import type { HookManager } from './hook-manager.js';
import { extractTokenUsage } from './llm-invoker.js';

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

export type RunResult = PipelineContext | AbortSignal | SuspensionSignal;

export interface PipelineRunnerOptions {
  tracer?: Tracer;
  hookManager?: HookManager;
}

interface FullStreamCallbacks {
  onTextDelta?: (text: string) => void;
  onToolCall?: (tc: ToolCall) => void;
}

interface FullStreamResult {
  chunks: string[];
  toolCalls: ToolCall[];
  reasoningParts: string[];
  usage: TokenUsage | undefined;
}

async function parseFullStream(
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>,
  callbacks?: FullStreamCallbacks,
): Promise<FullStreamResult> {
  const chunks: string[] = [];
  const toolCalls: ToolCall[] = [];
  const reasoningParts: string[] = [];
  let usage: TokenUsage | undefined;

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

export class PipelineRunner {
  private processors: Processor[] = [];
  private tracer: Tracer;
  private hookManager?: HookManager;

  constructor(options?: PipelineRunnerOptions) {
    this.tracer = options?.tracer ?? new NoOpTracer();
    this.hookManager = options?.hookManager;
  }

  register(processor: Processor): void {
    this.processors.push(processor);
  }

  unregister(stage: PipelineStage): void {
    this.processors = this.processors.filter((p) => p.stage !== stage);
  }

  replace(stage: PipelineStage, processor: Processor): void {
    this.processors = this.processors.filter((p) => p.stage !== stage);
    this.processors.push(processor);
  }

  setHookManager(hookManager: HookManager): void {
    this.hookManager = hookManager;
  }

  async run(context: PipelineContext, stages: PipelineStage[], options?: { signal?: globalThis.AbortSignal }): Promise<RunResult> {
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
          ctx = stageResult;
          ctx = await this.consumeStream(ctx);

          // Fire llm.after after stream is consumed (response is now available)
          if (stage === 'invokeLLM' && this.hookManager && (ctx.iteration as unknown as { _modelString?: string })._modelString) {
            await this.hookManager.invoke('llm.after', { model: (ctx.iteration as unknown as { _modelString?: string })._modelString }, { response: ctx.iteration.response });
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

  async *stream(context: PipelineContext, stages: PipelineStage[], options?: { signal?: globalThis.AbortSignal }): AsyncGenerator<StreamEvent> {
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
          ctx = stageResult;

          const fullStream = ctx.iteration.fullStream;
          if (fullStream) {
            const chunks: string[] = [];
            const toolCalls: ToolCall[] = [];
            const reasoningParts: string[] = [];
            let usage: TokenUsage | undefined;

            for await (const event of fullStream as AsyncIterable<{ type: string; [key: string]: unknown }>) {
              if (event.type === 'text-delta') {
                chunks.push(event.text as string);
                yield { type: 'text_delta', text: event.text as string };
              } else if (event.type === 'tool-call') {
                const tc: ToolCall = {
                  id: (event.toolCallId ?? event.id ?? '') as string,
                  name: (event.toolName ?? event.name ?? '') as string,
                  args: (event.args ?? event.input ?? {}) as Record<string, unknown>,
                };
                toolCalls.push(tc);
                yield { type: 'tool_call', name: tc.name, args: tc.args };
              } else if (event.type === 'reasoning') {
                reasoningParts.push((event.textDelta ?? event.text ?? '') as string);
              } else if (event.type === 'finish-step') {
                usage = extractTokenUsage(event.usage);
              } else if (event.type === 'error') {
                throw event.error;
              }
            }

            const reasoningContent = await resolveReasoningContent(reasoningParts, ctx.iteration.reasoningPromise);
            const pendingUsage = ctx.iteration.usagePromise
              ? await ctx.iteration.usagePromise
              : undefined;

            ctx = deepFreeze({
              ...ctx,
              iteration: {
                ...ctx.iteration,
                response: chunks.join('') || ctx.iteration.response || '',
                pendingToolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                reasoningContent,
                tokenUsage: usage ?? pendingUsage,
                fullStream: undefined,
                usagePromise: undefined,
                reasoningPromise: undefined,
              },
            });
          }

          // Fire llm.after after stream is consumed (response is now available)
          if (stage === 'invokeLLM' && this.hookManager && (ctx.iteration as unknown as { _modelString?: string })._modelString) {
            await this.hookManager.invoke('llm.after', { model: (ctx.iteration as unknown as { _modelString?: string })._modelString }, { response: ctx.iteration.response });
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
    stage: PipelineStage,
    stageSpan: Span,
  ): Promise<PipelineContext | AbortSignal | SuspensionSignal> {
    const stageProcessors = this.processors.filter((p) => p.stage === stage);
    if (stageProcessors.length === 0) return ctx;
    if (stageProcessors.every((p) => p.isNoOp)) return ctx;

    // stage.before hook
    if (this.hookManager) {
      await this.hookManager.invoke('stage.before', { stage, context: ctx }, {});
    }

    let currentCtx = ctx;
    for (const processor of stageProcessors) {
      const ctxWithSpan = deepFreeze({
        ...currentCtx,
        iteration: { ...currentCtx.iteration, span: stageSpan },
      });
      const result: ProcessorResult = await processor.execute(ctxWithSpan);
      if ('type' in result && (result.type === 'abort' || result.type === 'suspend')) {
        return result;
      }
      currentCtx = deepFreeze({ ...(result as PipelineContext) });
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

  private async consumeStream(ctx: PipelineContext): Promise<PipelineContext> {
    const fullStream = ctx.iteration.fullStream;
    if (!fullStream) return ctx;

    const result = await parseFullStream(fullStream as AsyncIterable<{ type: string; [key: string]: unknown }>);
    const reasoningContent = await resolveReasoningContent(result.reasoningParts, ctx.iteration.reasoningPromise);
    const pendingUsage = ctx.iteration.usagePromise
      ? await ctx.iteration.usagePromise
      : undefined;

    return deepFreeze({
      ...ctx,
      iteration: {
        ...ctx.iteration,
        response: result.chunks.join('') || ctx.iteration.response,
        pendingToolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        reasoningContent,
        tokenUsage: result.usage ?? pendingUsage,
        fullStream: undefined,
        usagePromise: undefined,
        reasoningPromise: undefined,
      },
    });
  }
}
