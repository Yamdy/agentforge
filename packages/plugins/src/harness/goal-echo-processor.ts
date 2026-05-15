import type { Processor, PipelineContext, ProcessorResult } from '@agentforge/sdk';
import { SpanAttributeKeys, SpanType } from '@agentforge/sdk';

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

export function createGoalEchoProcessor(config: GoalEchoConfig): Processor {
  return {
    stage: 'evaluateIteration',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (!config.enabled) return ctx;

      const state = (ctx.session.custom.goalEcho as GoalEchoState | undefined)
        ?? { lastEchoStep: -1, originalGoal: ctx.request.input };

      const step = ctx.iteration.step;
      const shouldEcho = step === 0 || (step - state.lastEchoStep) >= config.echoFrequency;

      if (!shouldEcho) {
        return {
          ...ctx,
          session: { ...ctx.session, custom: { ...ctx.session.custom, goalEcho: state } },
        };
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

      return {
        ...ctx,
        agent: {
          ...ctx.agent,
          promptFragments: [...ctx.agent.promptFragments, fragment],
        },
        session: {
          ...ctx.session,
          custom: { ...ctx.session.custom, goalEcho: newState },
        },
      };
    },
  };
}
