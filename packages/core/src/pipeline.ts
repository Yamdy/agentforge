import type {
  AbortSignal,
  PipelineContext,
  PipelineStage,
  Processor,
  ProcessorResult,
  Span,
  StreamEvent,
  Tracer,
} from '@agentforge/sdk';
import { NoOpTracer } from '@agentforge/observability';

export type RunResult = PipelineContext | AbortSignal;

export interface PipelineRunnerOptions {
  tracer?: Tracer;
}

export class PipelineRunner {
  private processors: Processor[] = [];
  private tracer: Tracer;

  constructor(options?: PipelineRunnerOptions) {
    this.tracer = options?.tracer ?? new NoOpTracer();
  }

  register(processor: Processor): void {
    this.processors.push(processor);
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
          ctx = await this.consumeTextStream(ctx);
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
            yield { type: 'abort', reason: stageResult.reason };
            return;
          }
          ctx = stageResult;

          const textStream = ctx.pipeline.textStream;
          if (textStream) {
            for await (const chunk of textStream) {
              yield { type: 'text_delta', text: chunk };
            }
            const usage = ctx.pipeline.usagePromise
              ? await ctx.pipeline.usagePromise
              : undefined;
            ctx = Object.freeze({
              ...ctx,
              pipeline: {
                ...ctx.pipeline,
                ...(usage ? { tokenUsage: usage } : {}),
                textStream: undefined,
                usagePromise: undefined,
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
    let currentCtx = ctx;
    for (const processor of stageProcessors) {
      const ctxWithSpan = Object.freeze({
        ...currentCtx,
        pipeline: { ...currentCtx.pipeline, _span: stageSpan },
      });
      const result: ProcessorResult = await processor.execute(ctxWithSpan);
      if ('type' in result && result.type === 'abort') {
        return result;
      }
      currentCtx = Object.freeze({ ...(result as PipelineContext) });
    }
    return currentCtx;
  }

  private isAbort(result: PipelineContext | AbortSignal): result is AbortSignal {
    return 'type' in result && result.type === 'abort';
  }

  private async consumeTextStream(ctx: PipelineContext): Promise<PipelineContext> {
    const textStream = ctx.pipeline.textStream;
    if (!textStream) return ctx;

    const chunks: string[] = [];
    for await (const chunk of textStream) chunks.push(chunk);

    const usage = ctx.pipeline.usagePromise
      ? await ctx.pipeline.usagePromise
      : undefined;

    return Object.freeze({
      ...ctx,
      pipeline: {
        ...ctx.pipeline,
        response: chunks.join(''),
        ...(usage ? { tokenUsage: usage } : {}),
        textStream: undefined,
        usagePromise: undefined,
      },
    });
  }
}
