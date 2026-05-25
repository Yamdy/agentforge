import type { Processor, ProcessorContext, PipelineContext, ProcessorDeps, ProcessorResult } from '@primo-ai/sdk';

const PLAN_PROMPT = `You are a planning assistant. Given the following task, create a concise step-by-step plan.

Task: {input}

Provide a numbered list of steps. Be specific and actionable.`;

export interface PlanStepDeps {
  getLLM?: (systemPrompt?: string) => Promise<(prompt: string) => Promise<string>>;
}

export function createPlanStepProcessor(deps?: PlanStepDeps): Processor {
  return {
    stage: 'planStep',
    async execute(ctx: ProcessorContext): Promise<PipelineContext | ProcessorResult> {
      const step = ctx.state.iteration.step;
      // Only plan on first iteration
      if (step > 0) {
        return ctx.state;
      }

      const input = ctx.state.session.input;
      if (!input || !deps?.getLLM) {
        return ctx.state;
      }

      try {
        const llm = await deps.getLLM('You are a planning assistant. Create concise, actionable step-by-step plans.');
        const planPrompt = PLAN_PROMPT.replace('{input}', input);
        const plan = await llm(planPrompt);

        return {
          ...ctx.state,
          session: {
            ...ctx.state.session,
            custom: {
              ...ctx.state.session.custom,
              plan,
            },
          },
        } as PipelineContext;
      } catch {
        // Planning failure is non-fatal -- skip silently
        return ctx.state;
      }
    },
  };
}
