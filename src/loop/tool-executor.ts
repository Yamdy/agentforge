/**
 * Tool Executor — extracted from agent-loop.ts
 *
 * Executes a single tool call through the full safety pipeline:
 * ToolHook → PermissionController → SecurityGuard → Sandbox → Execute.
 */

import type { Message, ToolCall } from '../core/events.js';
import type { AgentContext } from '../core/context.js';
import type { AgentState } from '../core/state.js';
import type { AgentEventEmitter } from '../core/events.js';
import { extractText } from '../core/content-utils.js';
import type { HookRegistry } from '../core/hooks.js';
import type { ToolDefinition } from '../core/interfaces.js';
import { evaluatePermission } from '../security/permission/permission-policy.js';
import { generateId, serializeError } from '../core/events.js';
import { truncateOutput } from './tool-truncation.js';

// ============================================================
// Types
// ============================================================

export interface ToolExecutorDeps {
  ctx: AgentContext;
  hooks: HookRegistry;
  emitter: AgentEventEmitter;
  getState: () => AgentState | null;
  runLifecycleHook: (
    phase: import('../core/hooks.js').LifecyclePhase,
    input: unknown,
    output: unknown
  ) => Promise<void>;
}

export interface ToolBatch {
  calls: ToolCall[];
  isConcurrencySafe: boolean;
}

// ============================================================
// Single Tool Execution
// ============================================================

export async function executeSingleTool(
  deps: ToolExecutorDeps,
  tc: ToolCall,
  signal: AbortSignal,
  batchId?: string
): Promise<Message> {
  const { ctx, hooks, emitter, getState, runLifecycleHook } = deps;
  const state = getState();

  // Emit tool.call
  void emitter.emit({
    type: 'tool.call',
    timestamp: Date.now(),
    sessionId: ctx.sessionId,
    toolCallId: tc.id,
    toolName: tc.name,
    args: tc.args,
    ...(batchId ? { batchId } : {}),
  });

  // Helper to emit tool.result with common fields + optional batchId
  const emitToolResult = (
    result: string,
    isError: boolean,
    extra?: Record<string, unknown>
  ): void => {
    void emitter.emit({
      type: 'tool.result',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      toolCallId: tc.id,
      toolName: tc.name,
      result,
      isError,
      ...(batchId ? { batchId } : {}),
      ...(extra ?? {}),
    });
  };

  // Audit tool call
  ctx.auditLogger?.append({
    sessionId: ctx.sessionId,
    agentName: ctx.agentName,
    eventType: 'tool.call',
    action: 'tool.call',
    resource: tc.name,
    result: 'success',
    details: { toolCallId: tc.id },
  });

  // ToolHook: permission check
  let blocked = false;
  for (const h of hooks.getToolHooks()) {
    if (!(await h.beforeExecute(tc, state!))) {
      blocked = true;
      break;
    }
  }

  if (blocked) {
    const deniedMsg: Message = {
      role: 'tool',
      content: `Permission denied for tool: ${tc.name}`,
      toolCallId: tc.id,
      name: tc.name,
    };
    emitToolResult(extractText(deniedMsg.content), true);
    return deniedMsg;
  }

  // Get tool definition for subsequent checks
  const toolDef: ToolDefinition | undefined = ctx.tools.get(tc.name);

  // HITL PermissionController: primary gate
  if (toolDef && ctx.permissionController && ctx.permissionPolicy) {
    const policyDecision = evaluatePermission(toolDef, ctx.permissionPolicy);

    if (policyDecision === 'deny') {
      const deniedMsg: Message = {
        role: 'tool',
        content: `Permission denied for tool: ${tc.name} (policy: deny)`,
        toolCallId: tc.id,
        name: tc.name,
      };
      emitToolResult(extractText(deniedMsg.content), true);
      ctx.auditLogger?.append({
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        eventType: 'tool.call',
        action: 'tool.call',
        resource: tc.name,
        result: 'denied',
        details: { toolCallId: tc.id, reason: 'permission_policy_deny' },
      });
      return deniedMsg;
    }

    if (policyDecision === 'ask') {
      const promptId = `perm-${tc.id}`;
      void emitter.emit({
        type: 'permission',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        promptId,
        permission: tc.name,
        context: {
          riskLevel: toolDef.riskLevel,
          approvalMessage: toolDef.approvalMessage,
          toolArgs: tc.args,
        },
      });

      let permDecision: 'allow' | 'deny' | 'allow_always';
      try {
        permDecision = await ctx.permissionController.ask({
          promptId,
          permission: tc.name,
          toolName: tc.name,
          toolArgs: tc.args,
          context: {
            riskLevel: toolDef.riskLevel,
            approvalMessage: toolDef.approvalMessage,
          },
        });
      } catch {
        permDecision = 'deny';
      }

      void emitter.emit({
        type: 'permission',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        promptId,
        permission: tc.name,
        decision: permDecision,
      });

      ctx.auditLogger?.append({
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        eventType: 'tool.call',
        action: 'tool.call',
        resource: tc.name,
        result: permDecision === 'deny' ? 'denied' : 'success',
        details: {
          toolCallId: tc.id,
          reason: permDecision === 'deny' ? 'HITL rejection' : `HITL ${permDecision}`,
        },
      });

      if (permDecision === 'deny') {
        const deniedMsg: Message = {
          role: 'tool',
          content: `Permission denied for tool: ${tc.name} (HITL rejection)`,
          toolCallId: tc.id,
          name: tc.name,
        };
        emitToolResult(extractText(deniedMsg.content), true);
        return deniedMsg;
      }
    }
  }

  // Security check before tool execution
  if (toolDef && ctx.securityGuard) {
    const cmdCheck = ctx.securityGuard.checkCommand(tc.name);
    if (!cmdCheck.allowed) {
      const blockedMsg: Message = {
        role: 'tool',
        content: `Tool "${tc.name}" blocked by security guard: ${cmdCheck.reason}`,
        toolCallId: tc.id,
        name: tc.name,
      };
      emitToolResult(`Blocked: ${cmdCheck.reason}`, true);
      ctx.auditLogger?.append({
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        eventType: 'tool.call',
        action: 'tool.call',
        resource: tc.name,
        result: 'denied',
        details: { toolCallId: tc.id, reason: cmdCheck.reason },
      });
      return blockedMsg;
    }
  }

  // Sandbox routing
  if (toolDef?.sandboxRequired && ctx.sandboxExecutor) {
    const sandboxResult = await ctx.sandboxExecutor.execute(
      { toolName: tc.name, args: tc.args },
      { sessionId: ctx.sessionId, signal, timeoutMs: 30000 }
    );
    let sbResultStr = sandboxResult.success
      ? (sandboxResult.result ?? '')
      : `Sandbox error: ${sandboxResult.error?.message ?? 'Unknown error'}`;
    const sbTruncated = truncateOutput(sbResultStr);
    sbResultStr = sbTruncated.content;
    emitToolResult(
      sbResultStr,
      !sandboxResult.success,
      sbTruncated.truncated
        ? { truncated: sbTruncated.truncated, originalLength: sbTruncated.originalLength }
        : undefined
    );
    return {
      role: 'tool',
      content: sbResultStr,
      toolCallId: tc.id,
      name: tc.name,
    };
  }

  // Execute tool
  await runLifecycleHook(
    'tool.before',
    { sessionId: ctx.sessionId, toolName: tc.name, callId: tc.id, args: tc.args },
    {}
  );

  try {
    const result = await ctx.tools.execute(tc.name, tc.args, {
      toolCallId: tc.id,
      parentSessionId: ctx.sessionId,
    });

    await runLifecycleHook(
      'tool.after',
      { sessionId: ctx.sessionId, toolName: tc.name, callId: tc.id, args: tc.args },
      { result }
    );

    let resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const truncation = truncateOutput(resultStr);
    resultStr = truncation.content;
    emitToolResult(
      resultStr,
      false,
      truncation.truncated
        ? { truncated: truncation.truncated, originalLength: truncation.originalLength }
        : undefined
    );

    ctx.auditLogger?.append({
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      eventType: 'tool.result',
      action: 'tool.result',
      resource: tc.name,
      result: 'success',
      details: { toolCallId: tc.id },
    });

    if (ctx.services.resultValidator) {
      try {
        const validation = ctx.services.resultValidator.validate(tc.name, resultStr);
        if (!validation.valid) {
          ctx.logger?.warn(`Tool result validation failed for ${tc.name}:`, {
            errors: validation.errors,
          });
        }
      } catch (err) {
        ctx.logger?.warn('Tool execution error', {
          toolName: tc.name,
          error: serializeError(err),
        });
      }
    }

    return {
      role: 'tool',
      content: resultStr,
      toolCallId: tc.id,
      name: tc.name,
    };
  } catch (err) {
    let errStr = err instanceof Error ? err.message : String(err);
    const errTruncation = truncateOutput(errStr);
    errStr = errTruncation.content;

    await runLifecycleHook(
      'tool.error',
      { sessionId: ctx.sessionId, toolName: tc.name, callId: tc.id, error: err },
      { retry: false }
    );

    emitToolResult(
      errStr,
      true,
      errTruncation.truncated
        ? { truncated: errTruncation.truncated, originalLength: errTruncation.originalLength }
        : undefined
    );

    ctx.auditLogger?.append({
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      eventType: 'tool.result',
      action: 'tool.result',
      resource: tc.name,
      result: 'error',
      details: { toolCallId: tc.id, error: errStr },
    });

    if (ctx.errorClassifier && ctx.circuitBreaker) {
      try {
        const severity = ctx.errorClassifier.classify({
          name: 'ToolExecutionError',
          message: errStr,
          stack: undefined,
        });
        ctx.circuitBreaker.recordFailure(severity);
      } catch (err) {
        ctx.logger?.warn('Tool execution error', {
          toolName: tc.name,
          error: serializeError(err),
        });
      }
    }

    return {
      role: 'tool',
      content: `Error: ${errStr}`,
      toolCallId: tc.id,
      name: tc.name,
    };
  }
}

// ============================================================
// Batch Execution
// ============================================================

export async function executeToolBatchParallel(
  deps: ToolExecutorDeps,
  batch: ToolBatch,
  signal: AbortSignal
): Promise<Message[]> {
  const batchId = generateId('batch');

  const settled = await Promise.all(
    batch.calls.map(tc => executeSingleTool(deps, tc, signal, batchId))
  );

  return settled;
}

export async function executeToolBatch(
  deps: ToolExecutorDeps,
  batch: ToolBatch,
  signal: AbortSignal,
  parallelToolCalls: boolean
): Promise<Message[]> {
  if (batch.isConcurrencySafe && parallelToolCalls && batch.calls.length > 1) {
    return executeToolBatchParallel(deps, batch, signal);
  }

  const results: Message[] = [];
  for (const tc of batch.calls) {
    if (signal.aborted) break;
    results.push(await executeSingleTool(deps, tc, signal));
  }
  return results;
}
