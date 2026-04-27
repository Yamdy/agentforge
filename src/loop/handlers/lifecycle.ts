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
