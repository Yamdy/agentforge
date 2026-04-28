/**
 * Handlers: Tool Call, Tool Result, Batch Complete + executeSingleTool, executeBatchTools
 * @module
 */

import { Observable, of, from, EMPTY } from 'rxjs';
import { mergeMap, timeout, takeUntil, catchError } from 'rxjs/operators';
import {
  type AgentEvent,
  type AgentState,
  type ToolCall,
  type Message,
  type BatchContext,
  type PermissionDecision,
  type PermissionAskOptions,
  generateId,
} from '../../core/index.js';
import { validateToolOutputForEvent } from '../../contracts/tool-output-contract.js';
import type { HandlerDeps, StepContext } from '../agent-loop.js';
import { handleSubagentDelegation } from './subagent.js';

// ============================================================
// Handler: tool.call → Execute Single Tool or Delegate to Subagent
// ============================================================

export function handleToolCall(
  deps: HandlerDeps,
  state: AgentState,
  event: Extract<AgentEvent, { type: 'tool.call' }>
): Observable<StepContext> {
  const { ctx } = deps;

  const tc: ToolCall = {
    id: event.toolCallId,
    name: event.toolName,
    args: event.args,
  };

  // Check if this is a subagent delegation
  if (ctx.subagents?.has(event.toolName)) {
    return handleSubagentDelegation(deps, tc, state, event);
  }

  return executeSingleTool(deps, tc, state);
}

// ============================================================
// Handler: tool.result → Continue or Complete
// ============================================================

export function handleToolResult(
  deps: HandlerDeps,
  state: AgentState,
  _event: Extract<AgentEvent, { type: 'tool.result' }>
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;

  // Ignore if in batch context - handled by batch.complete
  if (state.batchContext) {
    return EMPTY;
  }

  // Check max steps
  const newStep = state.step + 1;
  if (newStep > state.maxSteps) {
    const completeEvent: AgentEvent = {
      type: 'agent.complete',
      timestamp: Date.now(),
      sessionId,
      output: 'Max steps reached',
      steps: state.step,
    };

    const doneEvent: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId,
      reason: 'length',
    };

    const newState = { ...state, step: newStep };
    return from([
      { event: completeEvent, state: newState },
      { event: doneEvent, state: newState },
    ] as StepContext[]);
  }

  // Continue to next LLM call — emit agent.step + llm.request
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

// ============================================================
// Handler: tool.batch.complete → Continue
// ============================================================

export function handleBatchComplete(
  deps: HandlerDeps,
  state: AgentState,
  _event: Extract<AgentEvent, { type: 'tool.batch.complete' }>
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;

  const newStep = state.step + 1;

  // Check max steps
  if (newStep > state.maxSteps) {
    const completeEvent: AgentEvent = {
      type: 'agent.complete',
      timestamp: Date.now(),
      sessionId,
      output: 'Max steps reached',
      steps: state.step,
    };

    const doneEvent: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId,
      reason: 'length',
    };

    const newState = { ...state, step: newStep, pendingToolCalls: [] };
    delete newState.batchContext;
    return from([
      { event: completeEvent, state: newState },
      { event: doneEvent, state: newState },
    ] as StepContext[]);
  }

  const newState = {
    ...state,
    step: newStep,
    pendingToolCalls: [],
  };
  delete newState.batchContext;

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

// ============================================================
// Direct Tool Execution (extracted for reuse by permission flow)
// ============================================================

/**
 * Execute tool directly — called after all guard checks pass.
 * Shared by the normal execution path and the permission "allow" path.
 */
export function executeToolDirectly(
  deps: HandlerDeps,
  tc: ToolCall,
  state: AgentState
): Observable<StepContext> {
  const { ctx, sessionId } = deps;

  const executeEvent: AgentEvent = {
    type: 'tool.execute',
    timestamp: Date.now(),
    sessionId,
    toolCallId: tc.id,
    toolName: tc.name,
  };

  // Emit execute event, then execute tool and emit result or hitl.ask
  return from(
    ctx.tools
      .execute(tc.name, tc.args)
      .then(result => {
        // Check if HITL is required (result starts with HITL_REQUIRED:)
        if (result.startsWith('HITL_REQUIRED:') && ctx.hitl) {
          const question = result.slice('HITL_REQUIRED:'.length).trim();
          const askId = `ask-${generateId()}`;

          // Emit hitl.ask event - step() will handle via hitl.ask case
          // The hitl.ask handler subscribes to ctx.hitl.ask() Observable
          // and emits hitl.answer + tool.result when answer arrives
          const askEvent: AgentEvent = {
            type: 'hitl.ask',
            timestamp: Date.now(),
            sessionId,
            askId,
            question,
            toolCallId: tc.id,
            toolName: tc.name,
          };

          // Only emit execute + hitl.ask, handler will emit result
          return [
            { event: executeEvent, state },
            { event: askEvent, state },
          ] as StepContext[];
        }

        // Normal tool result (no HITL required)
        // P1: Validate tool output if outputSchema is defined
        const toolDef = ctx.tools.get(tc.name);
        const validationMetadata = toolDef
          ? validateToolOutputForEvent(result, toolDef)
          : { structuredOutput: undefined, isValid: undefined, validationError: undefined };

        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result,
          isError: false,
          // P1: Structured output validation fields
          structuredOutput: validationMetadata.structuredOutput,
          isValid: validationMetadata.isValid,
          validationError: validationMetadata.validationError,
        };
        const newMessages: Message[] = [
          ...state.messages,
          { role: 'tool', content: result, toolCallId: tc.id, name: tc.name },
        ];
        const newState = { ...state, messages: newMessages };
        return [
          { event: executeEvent, state },
          { event: resultEvent, state: newState },
        ] as StepContext[];
      })
      .catch(error => {
        // Notify error handler
        const err = error instanceof Error ? error : new Error(String(error));
        const toolErrorEvent: AgentEvent = {
          type: 'tool.call',
          timestamp: Date.now(),
          sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.args,
        };
        ctx.onError?.(err, toolErrorEvent, 'tool_execution');
        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: error instanceof Error ? error.message : String(error),
          isError: true,
        };
        return [
          { event: executeEvent, state },
          { event: resultEvent, state },
        ] as StepContext[];
      })
  ).pipe(mergeMap(arr => from(arr)));
}

// ============================================================
// Single Tool Execution (with guard checks)
// ============================================================

export function executeSingleTool(
  deps: HandlerDeps,
  tc: ToolCall,
  state: AgentState
): Observable<StepContext> {
  const { ctx, sessionId } = deps;

  // MPU M6: Permission policy check (BEFORE securityGuard)
  if (ctx.permissionPolicy) {
    const toolDef = ctx.tools.get(tc.name);
    const riskLevel = toolDef?.riskLevel ?? 'medium';
    const requiresApproval = toolDef?.requiresApproval ?? false;

    // Check tool-level policy first, then risk-level policy, then default
    const policy =
      ctx.permissionPolicy.toolPolicies[tc.name] ??
      ctx.permissionPolicy.riskPolicies[riskLevel] ??
      ctx.permissionPolicy.defaultPolicy;

    // Override: if tool has requiresApproval=true and enforceApprovalFlag, force 'ask'
    const effectivePolicy =
      requiresApproval && ctx.permissionPolicy.enforceApprovalFlag ? 'ask' : policy;

    if (effectivePolicy === 'deny') {
      const resultEvent: AgentEvent = {
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
        result: `Permission denied: tool "${tc.name}" is not allowed by policy`,
        isError: true,
      };
      return of({ event: resultEvent, state } as StepContext);
    }

    if (effectivePolicy === 'ask' && ctx.permissionController) {
      // KEY DESIGN: This Observable BLOCKS expand recursion until human answers.
      // This mirrors the HITL pattern — the stream pauses, no events are lost.
      // When permissionController.ask() emits, the tool execution continues.
      const permController = ctx.permissionController;
      const promptId = `perm-${generateId()}`;
      return permController
        .ask({
          promptId,
          permission: tc.name,
          context: { args: tc.args },
          toolName: tc.name,
          toolArgs: tc.args,
        } satisfies PermissionAskOptions)
        .pipe(
          mergeMap((decision: PermissionDecision) => {
            if (decision === 'deny') {
              const resultEvent: AgentEvent = {
                type: 'tool.result',
                timestamp: Date.now(),
                sessionId,
                toolCallId: tc.id,
                toolName: tc.name,
                result: `Permission denied by user for tool "${tc.name}"`,
                isError: true,
              };
              return of({ event: resultEvent, state } as StepContext);
            }
            // 'allow' or 'allow_always' — proceed to execute
            if (decision === 'allow_always') {
              try {
                permController.isAutoAllowed(tc.name);
              } catch {
                /* fire-and-forget */
              }
            }
            return executeToolDirectly(deps, tc, state);
          }),
          catchError(() => executeToolDirectly(deps, tc, state))
        );
    }
  }

  // MPU M6: Security check before tool execution
  if (ctx.securityGuard) {
    try {
      const argsStr = JSON.stringify(tc.args ?? {});
      const cmdCheck = ctx.securityGuard.checkCommand(argsStr);
      if (!cmdCheck.allowed) {
        // Security violation — return error result, do not execute tool
        const resultEvent: AgentEvent = {
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: `Security violation: ${cmdCheck.reason}`,
          isError: true,
        };
        return of({ event: resultEvent, state } as StepContext);
      }
    } catch {
      // Security check failure must never crash the loop — allow execution
    }
  }

  // MPU M3: Sandbox execution for sandboxRequired tools
  if (ctx.sandboxExecutor) {
    const toolDef = ctx.tools.get(tc.name);
    if (toolDef?.sandboxRequired) {
      return from(
        ctx.sandboxExecutor.execute(
          { toolName: tc.name, args: tc.args },
          { sessionId, timeoutMs: 30000, toolRegistry: ctx.tools }
        )
      ).pipe(
        timeout(30000), // Prevent infinite hang on Docker/container issues
        takeUntil(deps.destroy$), // Allow cancellation during sandbox execution
        mergeMap(sandboxResult => {
          const resultEvent: AgentEvent = {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: sandboxResult.success
              ? (sandboxResult.result ?? 'Sandbox execution completed')
              : `Sandbox error: ${sandboxResult.error?.message ?? 'unknown'}`,
            isError: !sandboxResult.success,
          };
          return of({ event: resultEvent, state } as StepContext);
        }),
        catchError((error: unknown) => {
          const resultEvent: AgentEvent = {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: `Sandbox execution failed: ${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          };
          return of({ event: resultEvent, state } as StepContext);
        })
      );
    }
  }

  // Default: execute tool directly
  return executeToolDirectly(deps, tc, state);
}

// ============================================================
// Batch Tool Execution (Parallel)
// ============================================================

export function executeBatchTools(
  deps: HandlerDeps,
  toolCalls: ToolCall[],
  state: AgentState
): Observable<StepContext> {
  const { ctx, sessionId } = deps;

  const batchId = `batch-${generateId()}`;
  const startedAt = Date.now();

  // Create batch context
  const batchContext: BatchContext = {
    batchId,
    totalCalls: toolCalls.length,
    completedCalls: 0,
    startedAt,
  };

  const batchState = {
    ...state,
    pendingToolCalls: toolCalls,
    batchContext,
  };

  // Execute all tools in parallel and collect all events
  return from(
    Promise.all(
      toolCalls.map(async tc => {
        try {
          const result = await ctx.tools.execute(tc.name, tc.args);
          return { tc, result, isError: false };
        } catch (error) {
          return {
            tc,
            result: error instanceof Error ? error.message : String(error),
            isError: true,
          };
        }
      })
    ).then(results => {
      const events: StepContext[] = [];
      const newMessages: Message[] = [...state.messages];
      let successCount = 0;
      let errorCount = 0;

      // Emit batch.start
      events.push({
        event: {
          type: 'tool.batch.start',
          timestamp: Date.now(),
          sessionId,
          batchId,
          totalCalls: toolCalls.length,
        },
        state: batchState,
      });

      // Emit batch event
      events.push({
        event: {
          type: 'tool.batch',
          timestamp: Date.now(),
          sessionId,
          batchId,
          calls: toolCalls.map(tc => ({
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.args,
          })),
        },
        state: batchState,
      });

      // Emit execute + result for each tool
      for (const r of results) {
        events.push({
          event: {
            type: 'tool.execute',
            timestamp: Date.now(),
            sessionId,
            toolCallId: r.tc.id,
            toolName: r.tc.name,
          },
          state: batchState,
        });

        // P1: Validate tool output if outputSchema is defined
        const toolDef = ctx.tools.get(r.tc.name);
        const validationMetadata = toolDef
          ? validateToolOutputForEvent(r.result, toolDef)
          : { structuredOutput: undefined, isValid: undefined, validationError: undefined };

        events.push({
          event: {
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId,
            toolCallId: r.tc.id,
            toolName: r.tc.name,
            result: r.result,
            isError: r.isError,
            // P1: Structured output validation fields
            structuredOutput: validationMetadata.structuredOutput,
            isValid: validationMetadata.isValid,
            validationError: validationMetadata.validationError,
          },
          state: batchState,
        });

        newMessages.push({
          role: 'tool',
          content: r.result,
          toolCallId: r.tc.id,
          name: r.tc.name,
        });

        if (r.isError) {
          errorCount++;
        } else {
          successCount++;
        }
      }

      // Emit batch.complete
      const completeState = {
        ...state,
        messages: newMessages,
        pendingToolCalls: [],
      };
      delete completeState.batchContext;

      events.push({
        event: {
          type: 'tool.batch.complete',
          timestamp: Date.now(),
          sessionId,
          batchId,
          totalCalls: toolCalls.length,
          successCount,
          errorCount,
          durationMs: Date.now() - startedAt,
        },
        state: completeState,
      });

      return events;
    })
  ).pipe(mergeMap(arr => from(arr)));
}
