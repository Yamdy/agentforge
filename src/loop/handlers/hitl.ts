/**
 * Handler: hitl.ask → Wait for human answer (NEVER-blocking pattern)
 * @module
 */

import { from, type Observable } from 'rxjs';
import { mergeMap, catchError, observeOn } from 'rxjs/operators';
import { asyncScheduler } from 'rxjs';
import { type AgentEvent, type AgentState, serializeError } from '../../core/index.js';
import type { HandlerDeps, StepContext } from '../agent-loop.js';

/**
 * HITL ask handler.
 *
 * Subscribes to ctx.hitl.ask() Observable. The Observable represents
 * "pause until human answers" semantics:
 * - Observable doesn't emit → expand naturally pauses (equivalent to NEVER)
 * - External answer() call → Subject emits → expand resumes
 * - On answer: emits hitl.answer + tool.result events
 */
export function handleHITLAsk(
  deps: HandlerDeps,
  state: AgentState,
  event: Extract<AgentEvent, { type: 'hitl.ask' }>
): Observable<StepContext> {
  const { ctx, sessionId } = deps;

  if (!ctx.hitl) {
    // No HITL controller - shouldn't happen (executeSingleTool guards this)
    // but handle gracefully with errors-as-events
    const errorEvent: AgentEvent = {
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId,
      error: {
        name: 'HITLNotAvailableError',
        message: 'HITL controller not available for hitl.ask event',
      },
    };
    const doneEvent: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId,
      reason: 'error',
    };
    return from([
      { event: errorEvent, state },
      { event: doneEvent, state },
    ] as StepContext[]);
  }

  // Subscribe to HITL Observable - this is the core NEVER-blocking pattern
  // Build options conditionally to satisfy exactOptionalPropertyTypes
  const askOptions: {
    question: string;
    askId: string;
    toolCallId: string;
    toolName: string;
    options?: string[];
    metadata?: Record<string, unknown>;
  } = {
    question: event.question,
    askId: event.askId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  };
  if (event.options !== undefined) {
    askOptions.options = event.options;
  }
  if (event.metadata !== undefined) {
    askOptions.metadata = event.metadata;
  }

  return ctx.hitl.ask(askOptions).pipe(
    // Defer emission to next microtask to avoid synchronous deadlock.
    // When hitl.ask is processed in expand, the Observable is subscribed synchronously.
    // If the answer() call happens in the same sync stack (e.g., subscriber.next callback),
    // the answerSubject hasn't been subscribed yet. observeOn(asyncScheduler) ensures
    // the answer is delivered on a fresh microtask, after the subscription is established.
    observeOn(asyncScheduler),
    mergeMap(answer => {
      // Emit hitl.answer (for downstream observability) + tool.result
      const answerEvent: AgentEvent = {
        type: 'hitl.answer',
        timestamp: Date.now(),
        sessionId,
        askId: event.askId,
        answer,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      };

      const resultEvent: AgentEvent = {
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: answer,
        isError: false,
      };

      const newMessages = [
        ...state.messages,
        {
          role: 'tool' as const,
          content: answer,
          toolCallId: event.toolCallId,
          name: event.toolName,
        },
      ];
      const newState = { ...state, messages: newMessages };

      return from([
        { event: answerEvent, state: newState },
        { event: resultEvent, state: newState },
      ] as StepContext[]);
    }),
    catchError(error => {
      // Notify error handler
      const err = error instanceof Error ? error : new Error(String(error));
      ctx.onError?.(err, event, 'unknown');
      // HITL error → errors-as-events
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: serializeError(error),
      };
      const doneEvent: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'error',
      };
      return from([
        { event: errorEvent, state },
        { event: doneEvent, state },
      ] as StepContext[]);
    })
  );
}
