/**
 * Handler: agent.start → Emit step + request LLM
 * @module
 */

import { from, type Observable } from 'rxjs';
import type { AgentEvent, AgentState } from '../../core/index.js';
import type { HandlerDeps, StepContext } from '../agent-loop.js';

/**
 * Handler: agent.start → Call LLM
 *
 * Emit agent.step + llm.request — let llm.request handler call the LLM.
 */
export function handleAgentStart(
  deps: HandlerDeps,
  state: AgentState,
  _event: Extract<AgentEvent, { type: 'agent.start' }>
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;

  // MPU M2: Planning — fire-and-forget plan generation
  // Phase 1: Plan result is logged but NOT injected into AgentState.
  // Phase 2 (future): Add currentPlan to AgentState, modify prompt builder to include plan.
  if (ctx.planner) {
    const input =
      typeof state.messages[state.messages.length - 1]?.content === 'string'
        ? state.messages[state.messages.length - 1]!.content
        : '';
    ctx.planner
      .plan(input, { availableTools: ctx.tools.list(), maxSteps: state.maxSteps })
      .then(plan => {
        // Log plan via audit (fire-and-forget)
        ctx.auditLogger?.append({
          sessionId,
          agentName: state.agentName,
          eventType: 'agent.start' as const,
          action: 'plan.generated',
          resource: input,
          result: 'success' as const,
          details: { planId: plan.id, stepCount: plan.steps.length },
        });
      })
      .catch(() => {
        // Planner failure must never crash the loop
      });
  }

  // Emit agent.step + llm.request — let llm.request handler call the LLM
  const newStep = 1;
  const newState = { ...state, step: newStep };

  const stepEvent: AgentEvent = {
    type: 'agent.step',
    timestamp: Date.now(),
    sessionId,
    step: newStep,
    maxSteps: state.maxSteps,
  };

  const requestEvent: AgentEvent = {
    type: 'llm.request',
    timestamp: Date.now(),
    sessionId,
    messages: newState.messages,
    model: config.model,
    tools: ctx.tools.list(),
  };

  return from([
    { event: stepEvent, state: newState },
    { event: requestEvent, state: newState },
  ] as StepContext[]);
}
