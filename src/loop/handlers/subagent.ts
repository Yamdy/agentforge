/**
 * Handler: Subagent Delegation
 * @module
 */

import { of, type Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import {
  type AgentEvent,
  type AgentState,
  type ToolCall,
  type Message,
  serializeError,
} from '../../core/index.js';
import type { HandlerDeps, StepContext } from '../agent-loop.js';

/**
 * Handle tool.call by delegating to a subagent.
 *
 * Pattern from design doc:
 * 1. Emit subagent.start event
 * 2. Run nested agent via ctx.subagents.run()
 * 3. All nested events bubble up with parentSessionId
 * 4. Emit subagent.complete event
 * 5. Emit tool.result with subagent output
 *
 * The registry.run() method handles the full lifecycle:
 * - subagent.start, nested agent events, subagent.complete
 *
 * After delegation completes, we emit tool.result with the output.
 */
export function handleSubagentDelegation(
  deps: HandlerDeps,
  tc: ToolCall,
  state: AgentState,
  _event: Extract<AgentEvent, { type: 'tool.call' }>
): Observable<StepContext> {
  const { ctx, sessionId } = deps;

  // Extract input from tool args
  // The subagent expects a string input
  let input: string;
  if (typeof tc.args.input === 'string') {
    input = tc.args.input;
  } else if (typeof tc.args.input === 'object' && tc.args.input !== null) {
    input = JSON.stringify(tc.args.input);
  } else if (Object.keys(tc.args).length === 0) {
    // No args, use empty string
    input = '';
  } else {
    // Use all args as input
    input = JSON.stringify(tc.args);
  }

  // Build options with session messages
  const options = {
    sessionMessages: state.messages,
  };

  // Run the subagent via registry
  // The registry emits: subagent.start, nested events (with parentSessionId), subagent.complete
  return ctx.subagents!.run(tc.name, input, options).pipe(
    map(nestedEvent => {
      // Check if this is subagent.complete - we need to create tool.result
      if (nestedEvent.type === 'subagent.complete') {
        const completeEvent = nestedEvent;

        // Create tool.result event with subagent output
        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: completeEvent.output,
          isError: false,
        };

        // Add tool message to state
        const newMessages: Message[] = [
          ...state.messages,
          { role: 'tool', content: completeEvent.output, toolCallId: tc.id, name: tc.name },
        ];
        const newState = { ...state, messages: newMessages };

        return { event: resultEvent, state: newState } as StepContext;
      }

      if (nestedEvent.type === 'subagent.error') {
        const errorEvent = nestedEvent;

        // Create tool.result with error
        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: `Subagent error: ${errorEvent.error.message}`,
          isError: true,
        };

        return { event: resultEvent, state } as StepContext;
      }

      // Pass through all other events (subagent.start, nested agent events, etc.)
      // These are for observability - they bubble up to the parent stream
      return { event: nestedEvent, state } as StepContext;
    }),
    catchError(error => {
      // Notify error handler
      const err = error instanceof Error ? error : new Error(String(error));
      const errorAgentEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: serializeError(err),
      };
      ctx.onError?.(err, errorAgentEvent, 'tool_execution');
      // Errors-as-events: convert to tool.result with error
      const resultEvent: AgentEvent = {
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
        result: error instanceof Error ? error.message : String(error),
        isError: true,
      };
      return of({ event: resultEvent, state } as StepContext);
    })
  );
}
