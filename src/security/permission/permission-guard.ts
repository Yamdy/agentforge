/**
 * AgentForge Permission Guard
 *
 * Provides the security check function that intercepts tool.call events
 * before execution.
 *
 * @see design/17-SECURITY.md Section 4.1
 */

import { Observable, from } from 'rxjs';
import { mergeMap, observeOn, catchError } from 'rxjs/operators';
import { asyncScheduler } from 'rxjs';
import type { AgentEvent } from '../../core/events.js';
import { serializeError, generateId } from '../../core/events.js';
import type { ToolDefinition } from '../../core/interfaces.js';
import type { PermissionController, PermissionDecision } from './permission-controller.js';
import {
  evaluatePermission,
  type PermissionPolicy,
  type PolicyDecision,
} from './permission-policy.js';

// ============================================================
// Types
// ============================================================

export type PermissionGuardResult =
  | { type: 'allow'; toolName: string }
  | { type: 'deny'; toolName: string; reason: string }
  | {
      type: 'ask';
      toolName: string;
      promptId: string;
      request$: Observable<PermissionGuardResult>;
    };

export interface PermissionGuardContext {
  sessionId: string;
  step: number;
  policy: PermissionPolicy;
  permissionController?: PermissionController;
}

// ============================================================
// Permission Guard Function
// ============================================================

export function evaluatePermissionGuard(
  tool: ToolDefinition,
  policy: PermissionPolicy
): PolicyDecision {
  return evaluatePermission(tool, policy);
}

export function createPermissionDeniedEvents(
  toolName: string,
  sessionId: string,
  step: number,
  reason: string
): AgentEvent[] {
  const errorEvent: AgentEvent = {
    type: 'agent.error',
    timestamp: Date.now(),
    sessionId,
    error: {
      name: 'PermissionDeniedError',
      message: reason || `Permission denied for tool: ${toolName}`,
    },
    step,
  };

  const doneEvent: AgentEvent = {
    type: 'done',
    timestamp: Date.now(),
    sessionId,
    reason: 'error',
  };

  return [errorEvent, doneEvent];
}

export function createPermissionPromptEvent(
  promptId: string,
  permission: string,
  sessionId: string,
  context?: Record<string, unknown>
): AgentEvent {
  return {
    type: 'permission.prompt',
    timestamp: Date.now(),
    sessionId,
    promptId,
    permission,
    context,
  };
}

export function createPermissionDecisionEvent(
  promptId: string,
  decision: PermissionDecision,
  sessionId: string
): AgentEvent {
  return {
    type: 'permission.decision',
    timestamp: Date.now(),
    sessionId,
    promptId,
    decision,
  };
}

export function handlePermissionAsk(
  toolCall: { id: string; name: string; args: Record<string, unknown> },
  tool: ToolDefinition,
  sessionId: string,
  step: number,
  permissionController: PermissionController,
  onAllow: () => Observable<{ event: AgentEvent; state: unknown }>
): Observable<{ event: AgentEvent; state: unknown }> {
  const promptId = `perm-${generateId()}`;

  const askContext: Record<string, unknown> = {};
  if (tool.riskLevel !== undefined) {
    askContext.riskLevel = tool.riskLevel;
  }
  if (tool.approvalMessage !== undefined) {
    askContext.approvalMessage = tool.approvalMessage;
  }

  return permissionController
    .ask({
      promptId,
      permission: toolCall.name,
      context: askContext,
      toolName: toolCall.name,
      toolArgs: toolCall.args,
    })
    .pipe(
      observeOn(asyncScheduler),
      mergeMap((decision: PermissionDecision) => {
        const decisionEvent = createPermissionDecisionEvent(promptId, decision, sessionId);

        if (decision === 'allow' || decision === 'allow_always') {
          return onAllow().pipe(
            mergeMap(result => {
              return from([{ event: decisionEvent, state: result.state }, result] as Array<{
                event: AgentEvent;
                state: unknown;
              }>);
            })
          );
        }

        const denialEvents = createPermissionDeniedEvents(
          toolCall.name,
          sessionId,
          step,
          tool.approvalMessage ?? `Permission denied for tool: ${toolCall.name}`
        );

        return from([
          { event: decisionEvent, state: undefined },
          ...denialEvents.map(event => ({ event, state: undefined })),
        ] as Array<{ event: AgentEvent; state: unknown }>);
      }),
      catchError(error => {
        const errorEvent: AgentEvent = {
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId,
          error: serializeError(error),
          step,
        };
        const doneEvent: AgentEvent = {
          type: 'done',
          timestamp: Date.now(),
          sessionId,
          reason: 'error',
        };
        return from([
          { event: errorEvent, state: undefined },
          { event: doneEvent, state: undefined },
        ] as Array<{ event: AgentEvent; state: unknown }>);
      })
    );
}
