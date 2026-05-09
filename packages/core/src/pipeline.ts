import type {
  AbortSignal,
  PipelineContext,
  PipelineStage,
  Processor,
  ProcessorResult,
} from '@agentforge/sdk';

export type RunResult = PipelineContext | AbortSignal;

export class PipelineRunner {
  private processors: Processor[] = [];

  register(processor: Processor): void {
    this.processors.push(processor);
  }

  async run(context: PipelineContext, stages: PipelineStage[]): Promise<RunResult> {
    let ctx = context;

    for (const stage of stages) {
      const stageProcessors = this.processors.filter((p) => p.stage === stage);
      for (const processor of stageProcessors) {
        const result: ProcessorResult = await processor.execute(ctx);
        if ('type' in result && result.type === 'abort') {
          return result;
        }
        ctx = Object.freeze({ ...(result as PipelineContext) });
      }
    }

    return ctx;
  }
}
