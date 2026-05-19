import { z } from 'zod';
import type { Processor, ProcessorContext, PipelineContext } from '@primo-ai/sdk';
import { SpanAttributeKeys, SpanType } from '@primo-ai/sdk';

interface GoalEchoState {
  lastEchoStep: number;
  originalGoal: string;
}

export interface GoalEchoConfig {
  enabled: boolean;
  /** Echo every N iterations. 1 = every iteration. Default: 3. */
  echoFrequency: number;
  /** Inject progress assessment prompt alongside goal reminder. Default: false. */
  progressTracking: boolean;
}

const GoalEchoConfigSchema = z.object({
  enabled: z.boolean(),
  echoFrequency: z.number().int().positive(),
  progressTracking: z.boolean(),
});

export function createGoalEchoProcessor(config: GoalEchoConfig): Processor {
  GoalEchoConfigSchema.parse(config);
  return {
    stage: 'evaluateIteration',
    execute: async (pCtx: ProcessorContext) => {
      if (!config.enabled) return;
      const ctx = pCtx.state;

      const state = (ctx.session.custom.goalEcho as GoalEchoState | undefined)
        ?? { lastEchoStep: -1, originalGoal: ctx.request.input };

      const step = ctx.iteration.step;
      const shouldEcho = step === 0 || (step - state.lastEchoStep) >= config.echoFrequency;

      if (!shouldEcho) {
        ctx.session.custom = { ...ctx.session.custom, goalEcho: state };
        return;
      }

      const childSpan = ctx.iteration.span?.startChild(SpanType.GOAL_ECHO);
      childSpan?.setAttribute(SpanAttributeKeys.GOAL_TEXT, state.originalGoal);
      childSpan?.setAttribute(SpanAttributeKeys.GOAL_ITERATION, step);

      let fragment = `[Goal Reminder] Your original objective: "${state.originalGoal}"\nCurrent iteration: ${step}`;

      if (config.progressTracking) {
        fragment += '\n[Progress Assessment] Compare your current response against the original goal. '
          + 'If the goal is accomplished, provide a final answer. If not, continue working toward it.';
        childSpan?.setAttribute(SpanAttributeKeys.GOAL_PROGRESS, 'assessed');
      }

      childSpan?.end();

      const newState: GoalEchoState = { ...state, lastEchoStep: step };
      ctx.agent.promptFragments = [...ctx.agent.promptFragments, fragment];
      ctx.session.custom = { ...ctx.session.custom, goalEcho: newState };
    },
  };
}
