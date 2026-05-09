import type {
  AbortSignal,
  PipelineContext,
  PipelineStage,
  Processor,
  ProcessorResult,
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
          const stageProcessors = this.processors.filter((p) => p.stage === stage);
          for (const processor of stageProcessors) {
            const ctxWithSpan = Object.freeze({ ...ctx, pipeline: { ...ctx.pipeline, _span: stageSpan } });
            const result: ProcessorResult = await processor.execute(ctxWithSpan);
            if ('type' in result && result.type === 'abort') {
              stageSpan.end();
              rootSpan.end();
              return result;
            }
            ctx = Object.freeze({ ...(result as PipelineContext) });
          }
        } finally {
          stageSpan.end();
        }
      }
    } finally {
      rootSpan.end();
    }

    return ctx;
  }
}
