import type {
  AbortSignal,
  PipelineContext,
  PipelineStage,
  Processor,
  ProcessorResult,
  Span,
  StreamEvent,
  ToolCall,
  Tracer,
  TokenUsage,
} from '@agentforge/sdk';
import { NoOpTracer } from '@agentforge/observability';
import type { HookManager } from './hook-manager.js';

export type RunResult = PipelineContext | AbortSignal;

export interface PipelineRunnerOptions {
  tracer?: Tracer;
  hookManager?: HookManager;
}

function extractTokenUsage(usage: any): TokenUsage {
  return {
    input: typeof usage?.inputTokens === 'number'
      ? usage.inputTokens
      : (usage?.inputTokens as any)?.total ?? 0,
    output: typeof usage?.outputTokens === 'number'
      ? usage.outputTokens
      : (usage?.outputTokens as any)?.total ?? 0,
  };
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

  setHookManager(hookManager: HookManager): void {
    this.hookManager = hookManager;
  }

  async run(context: PipelineContext, stages: PipelineStage[]): Promise<RunResult> {
    const rootSpan = this.tracer.startSpan('pipeline');
    let ctx = context;

    try {
      for (const stage of stages) {
        const stageSpan = rootSpan.startChild(stage);
        try {
          const stageResult = await this.executeStage(ctx, stage, stageSpan);
          if (this.isAbort(stageResult)) {
            stageSpan.end();
            rootSpan.end();
            return stageResult;
          }
          ctx = stageResult;
          ctx = await this.consumeStream(ctx);
        } finally {
          stageSpan.end();
        }
      }
    } finally {
      rootSpan.end();
    }

    return ctx;
  }

  async *stream(context: PipelineContext, stages: PipelineStage[]): AsyncGenerator<StreamEvent> {
    const rootSpan = this.tracer.startSpan('pipeline');
    let ctx = context;

    try {
      for (const stage of stages) {
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
          ctx = stageResult;

          const fullStream = ctx.iteration.fullStream;
          if (fullStream) {
            const toolCalls: ToolCall[] = [];
            const reasoningParts: string[] = [];
            let usage: TokenUsage | undefined;

            for await (const event of fullStream as AsyncIterable<any>) {
              if (event.type === 'text-delta') {
                yield { type: 'text_delta', text: event.text };
              } else if (event.type === 'tool-call') {
                const tc: ToolCall = {
                  id: event.toolCallId ?? event.id ?? '',
                  name: event.toolName ?? event.name ?? '',
                  args: event.args ?? event.input ?? {},
                };
                toolCalls.push(tc);
                yield { type: 'tool_call', name: tc.name, args: tc.args };
              } else if (event.type === 'reasoning') {
                reasoningParts.push(event.textDelta ?? event.text ?? '');
              } else if (event.type === 'finish-step') {
                usage = extractTokenUsage(event.usage);
              } else if (event.type === 'error') {
                throw event.error;
              }
            }

            const pendingUsage = ctx.iteration.usagePromise
              ? await ctx.iteration.usagePromise
              : undefined;

            let reasoningContent = reasoningParts.length > 0 ? reasoningParts.join('') : undefined;
            if (!reasoningContent && ctx.iteration.reasoningPromise) {
              try { reasoningContent = await ctx.iteration.reasoningPromise ?? undefined; } catch { /* ignore */ }
            }

            ctx = Object.freeze({
              ...ctx,
              iteration: {
                ...ctx.iteration,
                response: ctx.iteration.response ?? '',
                pendingToolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                reasoningContent,
                tokenUsage: usage ?? pendingUsage,
                fullStream: undefined,
                usagePromise: undefined,
                reasoningPromise: undefined,
              },
            });
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
  ): Promise<PipelineContext | AbortSignal> {
    const stageProcessors = this.processors.filter((p) => p.stage === stage);

    // stage.before hook
    if (this.hookManager) {
      await this.hookManager.invoke('stage.before', { stage, context: ctx }, {});
    }

    let currentCtx = ctx;
    for (const processor of stageProcessors) {
      const ctxWithSpan = Object.freeze({
        ...currentCtx,
        iteration: { ...currentCtx.iteration, span: stageSpan },
      });
      const result: ProcessorResult = await processor.execute(ctxWithSpan);
      if ('type' in result && result.type === 'abort') {
        return result;
      }
      currentCtx = Object.freeze({ ...(result as PipelineContext) });
    }

    // stage.after hook
    if (this.hookManager) {
      await this.hookManager.invoke('stage.after', { stage, context: currentCtx }, {});
    }

    return currentCtx;
  }

  private isAbort(result: PipelineContext | AbortSignal): result is AbortSignal {
    return 'type' in result && result.type === 'abort';
  }

  private async consumeStream(ctx: PipelineContext): Promise<PipelineContext> {
    const fullStream = ctx.iteration.fullStream;
    if (!fullStream) return ctx;

    const chunks: string[] = [];
    const toolCalls: ToolCall[] = [];
    const reasoningParts: string[] = [];
    let usage: TokenUsage | undefined;

    for await (const event of fullStream as AsyncIterable<any>) {
      if (event.type === 'text-delta') {
        chunks.push(event.text);
      } else if (event.type === 'tool-call') {
        toolCalls.push({
          id: event.toolCallId ?? event.id ?? '',
          name: event.toolName ?? event.name ?? '',
          args: event.args ?? event.input ?? {},
        });
      } else if (event.type === 'reasoning') {
        reasoningParts.push(event.textDelta ?? event.text ?? '');
      } else if (event.type === 'finish-step') {
        usage = extractTokenUsage(event.usage);
      } else if (event.type === 'error') {
        throw event.error;
      }
    }

    const pendingUsage = ctx.iteration.usagePromise
      ? await ctx.iteration.usagePromise
      : undefined;

    let reasoningContent = reasoningParts.length > 0 ? reasoningParts.join('') : undefined;
    if (!reasoningContent && ctx.iteration.reasoningPromise) {
      try { reasoningContent = await ctx.iteration.reasoningPromise ?? undefined; } catch { /* ignore */ }
    }

    return Object.freeze({
      ...ctx,
      iteration: {
        ...ctx.iteration,
        response: chunks.join('') || ctx.iteration.response,
        pendingToolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        reasoningContent,
        tokenUsage: usage ?? pendingUsage,
        fullStream: undefined,
        usagePromise: undefined,
        reasoningPromise: undefined,
      },
    });
  }
}
