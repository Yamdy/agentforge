/**
 * Plan Executor — extracted from agent-loop.ts
 *
 * Runs the plan-then-execute path: invokes the planner, validates the plan,
 * executes via PlanExecutorImpl, and handles re-planning on failure.
 */

import type { AgentContext, AgentState } from '../core/index.js';
import type { AgentEventEmitter, SerializedError, AgentEvent } from '../core/index.js';
import type { AgentStateMachine } from '../core/state-machine.js';

export interface PlanExecutorDeps {
  ctx: AgentContext;
  state: AgentState;
  input: string;
  emitter: AgentEventEmitter;
  stateMachine: AgentStateMachine;
  executionMode: 'react' | 'plan-then-execute' | 'plan-then-execute-strict';
  maxSteps: number;
  cleanupRun: () => void;
}

/**
 * Run the plan-then-execute path.
 *
 * @returns plannerSucceeded=true if planner produced output (skip ReAct loop).
 *          shouldTerminate=true if a strict-mode error occurred (caller should return '').
 */
export async function runPlanThenExecute(
  deps: PlanExecutorDeps
): Promise<{ plannerSucceeded: boolean; shouldTerminate: boolean; finalOutput?: string }> {
  const { ctx, emitter, stateMachine, executionMode, maxSteps, cleanupRun } = deps;

  if (executionMode === 'react' || !ctx.planner) {
    return { plannerSucceeded: false, shouldTerminate: false };
  }

  let shouldTerminate = false;

  const strictFail = (reason: string, planningError?: unknown): void => {
    const causeMsg = planningError instanceof Error ? planningError.message : '';
    const fullMessage = causeMsg
      ? `Plan-then-execute (strict mode) failed: ${causeMsg} — ${reason}`
      : `Plan-then-execute (strict mode) failed: ${reason}`;
    ctx.logger?.error(`[strict plan-then-execute] ${fullMessage}`);
    const plannedError: SerializedError = {
      name: 'PlannerError',
      message: fullMessage,
      stack: planningError instanceof Error ? planningError.stack : undefined,
    };
    stateMachine.transition('error');
    void emitter.emit({
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      error: plannedError,
    } as AgentEvent);
    void emitter.emit({
      type: 'done',
      reason: 'error',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
    });
    cleanupRun();
    shouldTerminate = true;
  };

  try {
    const toolNames = ctx.tools?.getFunctionDefs().map((f: { name: string }) => f.name) ?? [];
    const plan = await ctx.planner.plan(deps.input, {
      availableTools: toolNames,
      maxSteps,
    });

    if (!plan || plan.steps.length === 0) {
      if (executionMode === 'plan-then-execute-strict') {
        strictFail(
          ctx.planner.lastDiagnostic ?? 'Planner produced an empty plan (no steps generated)'
        );
        return { plannerSucceeded: false, shouldTerminate };
      }
      ctx.logger?.warn('Plan-then-execute produced empty plan, falling back to ReAct loop');
      return { plannerSucceeded: false, shouldTerminate };
    }

    const validation = await ctx.planner.validate(plan, {
      availableTools: toolNames,
      maxSteps,
    });

    if (!validation.valid) {
      if (executionMode === 'plan-then-execute-strict') {
        const errorDetail = validation.errors
          .map((e: { path: string; message: string }) => `${e.path}: ${e.message}`)
          .join('; ');
        strictFail(`Plan validation failed: ${errorDetail}`);
        return { plannerSucceeded: false, shouldTerminate };
      }
      ctx.logger?.warn('Plan validation failed, falling back to ReAct loop');
      return { plannerSucceeded: false, shouldTerminate };
    }

    if (!ctx.tools) {
      return { plannerSucceeded: false, shouldTerminate };
    }

    // Dynamic import PlanExecutorImpl to avoid circular deps
    const { PlanExecutorImpl } = await import('../planning/plan-executor.js');
    const executor = new PlanExecutorImpl();
    let result = await executor.execute(plan, ctx.tools);

    // Re-plan on failure (up to 2 retries)
    let replanAttempts = 0;
    const maxReplanAttempts = 2;
    while (result.status === 'failed' && replanAttempts < maxReplanAttempts) {
      let failedStepId: string | undefined;
      for (const [stepId, stepResult] of result.stepResults) {
        if (stepResult.status === 'failed') {
          failedStepId = stepId;
          break;
        }
      }
      if (!failedStepId) break;

      replanAttempts++;
      const newPlan = await ctx.planner.replan(
        deps.input,
        { availableTools: toolNames, maxSteps },
        failedStepId,
        result.stepResults
      );
      result = await executor.resume(newPlan, ctx.tools, result.stepResults);
    }

    // Build final output from step results
    const outputs: string[] = [];
    for (const [, stepResult] of result.stepResults) {
      if (stepResult.status === 'completed' && stepResult.output) {
        outputs.push(stepResult.output);
      }
    }

    if (outputs.length > 0) {
      const finalOutput = outputs.join('\n');
      stateMachine.transition('completed');
      void emitter.emit({
        type: 'agent.complete',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        output: finalOutput,
        steps: deps.state.step,
      } as AgentEvent);
      void emitter.emit({
        type: 'done',
        reason: 'stop',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
      });
      deps.state.output = finalOutput;
      cleanupRun();
      return { plannerSucceeded: true, shouldTerminate: false, finalOutput };
    }

    if (executionMode === 'plan-then-execute-strict') {
      strictFail('Plan execution produced no output (all steps completed but returned empty)');
      return { plannerSucceeded: false, shouldTerminate };
    }

    return { plannerSucceeded: false, shouldTerminate };
  } catch (planningError) {
    if (executionMode === 'plan-then-execute-strict') {
      strictFail(ctx.planner.lastDiagnostic ?? 'Planner threw an exception', planningError);
      return { plannerSucceeded: false, shouldTerminate };
    }

    if (ctx.logger) {
      ctx.logger.warn('Plan-then-execute failed, falling back to ReAct loop');
    }
    return { plannerSucceeded: false, shouldTerminate };
  }
}
