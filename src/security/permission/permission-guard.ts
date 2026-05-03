/**
 * AgentForge Permission Guard
 *
 * Provides the security check function for tool execution permission.
 *
 * @see design/17-SECURITY.md Section 4.1
 */

import { serializeError, generateId } from '../../core/events.js';
import type { AgentEvent } from '../../core/events.js';
import type { ToolDefinition } from '../../core/interfaces.js';
import type { PermissionController, PermissionDecision } from './permission-controller.js';
import {
  evaluatePermission,
  type PermissionPolicy,
  type PolicyDecision,
} from './permission-policy.js';
import { safeClassify, type PermissionClassifier } from './classifier.js';

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
      /** Promise that resolves when user answers */
      answerPromise: Promise<PermissionGuardResult>;
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
  } as AgentEvent;
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
  } as AgentEvent;
}

/**
 * Handle permission check for a tool call.
 * Returns a Promise of event+state pairs.
 */
export async function handlePermissionAsk(
  toolCall: { id: string; name: string; args: Record<string, unknown> },
  tool: ToolDefinition,
  sessionId: string,
  step: number,
  permissionController: PermissionController,
  onAllow: () => Promise<{ event: AgentEvent; state: unknown }>,
  classifier?: PermissionClassifier
): Promise<Array<{ event: AgentEvent; state: unknown }>> {
  const promptId = `perm-${generateId()}`;

  const askContext: Record<string, unknown> = {};
  if (tool.riskLevel !== undefined) {
    askContext.riskLevel = tool.riskLevel;
  }
  if (tool.approvalMessage !== undefined) {
    askContext.approvalMessage = tool.approvalMessage;
  }

  try {
    // ── Permission Classifier: try auto-decision before human ask ──
    const classification = await safeClassify(classifier, {
      toolName: toolCall.name,
      toolArgs: toolCall.args,
      riskLevel: tool.riskLevel ?? 'medium',
      sessionId,
      step,
      policyDecision: evaluatePermission(tool, {
        riskPolicies: { low: 'allow', medium: 'allow', high: 'ask', critical: 'deny' },
        defaultPolicy: 'ask',
        toolPolicies: {},
        enforceApprovalFlag: true,
      }),
    });

    if (classification.action === 'allow' || classification.action === 'deny') {
      const classifierDecision: PermissionDecision =
        classification.action === 'allow' ? 'allow' : 'deny';
      const decisionEvent = createPermissionDecisionEvent(promptId, classifierDecision, sessionId);

      if (classifierDecision === 'allow') {
        const result = await onAllow();
        return [{ event: decisionEvent, state: result.state }, result];
      }

      const denialEvents = createPermissionDeniedEvents(
        toolCall.name,
        sessionId,
        step,
        classification.reason || `Classifier denied: ${toolCall.name}`
      );
      return [
        { event: decisionEvent, state: undefined },
        ...denialEvents.map(event => ({ event, state: undefined })),
      ];
    }

    // ── Classifier unsure → fall through to human-in-the-loop ──
    const decision = await permissionController.ask({
      promptId,
      permission: toolCall.name,
      context: askContext,
      toolName: toolCall.name,
      toolArgs: toolCall.args,
    });

    const decisionEvent = createPermissionDecisionEvent(promptId, decision, sessionId);

    if (decision === 'allow' || decision === 'allow_always') {
      const result = await onAllow();
      return [{ event: decisionEvent, state: result.state }, result];
    }

    const denialEvents = createPermissionDeniedEvents(
      toolCall.name,
      sessionId,
      step,
      tool.approvalMessage ?? `Permission denied for tool: ${toolCall.name}`
    );

    return [
      { event: decisionEvent, state: undefined },
      ...denialEvents.map(event => ({ event, state: undefined })),
    ];
  } catch (error) {
    const errorEvent: AgentEvent = {
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId,
      error: serializeError(error),
      step,
    } as AgentEvent;
    const doneEvent: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId,
      reason: 'error',
    } as AgentEvent;
    return [
      { event: errorEvent, state: undefined },
      { event: doneEvent, state: undefined },
    ];
  }
}
