/**
 * AgentForge Agent Loop — Imperative Implementation
 *
 * Uses an imperative while(true) loop for control flow.
 * All control flow (token budget, error recovery, tool partitioning, compaction)
 * is inline in a single closure — no event-type switch, no handler delegation.
 *
 * Design principles:
 * - while(true) + await (not expand + switch)
 * - HookRegistry for plugin cut-points (not event-stream interception)
 * - AgentEventEmitter for observability
 * - AbortController for cancellation (not takeUntil)
 * - Errors-as-events for error reporting
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import {
  type AgentEvent,
  type Message,
  type ToolCall,
  type SerializedError,
  AgentEventEmitter,
  AgentStateMachine,
  type AgentStateEnum,
  serializeError,
  generateId,
} from '../core/index.js';
import type { AgentContext, AgentState } from '../core/index.js';
import { extractText } from '../core/content-utils.js';
import {
  HookRegistry,
  type HookName,
  RequestHookPriority,
  type CheckpointFn,
} from '../core/hooks.js';
import { createInitialState } from '../core/state.js';
import type { LLMOptions } from '../core/interfaces.js';
import { checkTokenBudget, createBudgetTracker, shouldCompact } from './token-budget.js';
import { analyzeLLMError, RECOVERY_LIMITS, ESCALATED_MAX_OUTPUT_TOKENS } from './error-analyzer.js';
import { partitionToolCalls } from './tool-partition.js';
import { evaluatePermission } from '../security/permission/permission-policy.js';

// ============================================================
// Types
// ============================================================

export interface AgentLoopConfig {
  model: { provider: string; model: string };
  maxSteps?: number;
  maxLLMRepairAttempts?: number;
  parallelToolCalls?: boolean;
  streaming?: boolean;
  tokenBudget?: number | undefined;
  fallbackModel?: { provider: string; model: string } | undefined;
  history?: Message[] | undefined;
  systemPrompt?: string | undefined;
  checkpoint?: { enabled?: boolean; interval?: string } | undefined;
  /**
   * Execution mode for the planner.
   *
   * - 'react': ReAct loop only, planner is never invoked (default, backward compatible)
   * - 'plan-then-execute': Try planner first, fall back to ReAct on failure
   * - 'plan-then-execute-strict': Planner MUST succeed, otherwise error and terminate
   */
  executionMode?: 'react' | 'plan-then-execute' | 'plan-then-execute-strict';
  /** Checkpoint functions to execute before each LLM call (quota, rate-limit) */
  preLlmCheckpoints?: CheckpointFn[];
  /** Checkpoint functions to execute after each LLM response (quality gate, circuit breaker) */
  postLlmCheckpoints?: CheckpointFn[];
}

/**
 * Agent Loop instance returned by createAgentLoop()
 */
export interface AgentLoop {
  /** Run the agent loop with user input. Returns final output text. */
  run(input: string): Promise<string>;
  /**
   * AsyncGenerator-based iteration. Captures all emitted events and yields them
   * to the caller. Returns the final output string. Subscribe via on()/onAny()
   * for events outside the generator context.
   */
  iterate(input: string): AsyncGenerator<AgentEvent, string, void>;
  /** Subscribe to typed events */
  on<T extends AgentEvent['type']>(
    type: T,
    fn: (e: Extract<AgentEvent, { type: T }>) => void
  ): () => void;
  /** Subscribe to all events */
  onAny(fn: (e: AgentEvent) => void): () => void;
  /** Emit an external event through this loop's emitter (e.g., from subsystems) */
  emit(event: AgentEvent): Promise<void>;
  /** Cancel current execution */
  cancel(): void;
  /** Pause execution (blocks the loop) */
  pause(): void;
  /** Resume execution */
  resume(): void;
  /** Get current loop state (null if not started) */
  getState(): AgentState | null;
  /** Get current lifecycle status from state machine */
  getStatus(): string;
  /** Subscribe to lifecycle state changes */
  onStateChange(fn: (from: string, to: string) => void): () => void;
  /** Clean up all resources */
  destroy(): void;
}

// ============================================================
// Factory
// ============================================================

export function createAgentLoop(ctx: AgentContext, config: AgentLoopConfig): AgentLoop {
  const emitter = new AgentEventEmitter();
  const hooks = ctx.hookRegistry ?? new HookRegistry();
  let abortController: AbortController | null = null;
  let onExternalAbort: (() => void) | null = null;
  let state: AgentState | null = null;
  let isRunning = false;

  // ── State Machine ──
  const stateMachine = new AgentStateMachine();
  stateMachine.onChange((from: AgentStateEnum, to: AgentStateEnum) => {
    void emitter.emit({
      type: 'state.change',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      from,
      to,
    });
  });
  // ── Checkpoints: from plugin pipeline (primary) or config fallback ──
  const preLlmCheckpoints =
    ctx.pluginManager?.getCheckpoints('pre-llm') ?? config.preLlmCheckpoints ?? [];
  const postLlmCheckpoints =
    ctx.pluginManager?.getCheckpoints('post-llm') ?? config.postLlmCheckpoints ?? [];

  // ── Working Memory: register system injection RequestHook ──
  // When working memory is configured, inject <working-memory> XML before each LLM call.
  // Priority 25 — sits between MEMORY_CONTEXT (20) and SKILL_INSTRUCTIONS (30).
  if (ctx.workingMemoryProcessor && ctx.workingMemory) {
    const wmHook = ctx.workingMemoryProcessor.createSystemInjectionHook(
      ctx.workingMemory,
      RequestHookPriority.WORKING_MEMORY
    );
    hooks.registerRequest(wmHook);
  }

  // ── Pause/Resume ──
  let paused = false;
  let resumePromise: Promise<void> | null = null;
  let resumeResolve: (() => void) | null = null;

  // ── Streaming ──

  // ── Error recovery mutable state (shared with handleLLMError) ──
  const recoveryState = {
    escalatedMaxTokens: undefined as number | undefined,
  };

  // ============================================================
  // Lifecycle Hook Runner (error-isolated)
  // ============================================================

  async function runLifecycleHook(name: HookName, input: unknown, output: unknown): Promise<void> {
    for (const h of hooks.getLifecycleHooks(name)) {
      try {
        await h(input, output);
      } catch {
        /* isolate */
      }
    }
  }

  // ============================================================
  // Error Recovery
  // ============================================================

  async function handleLLMError(
    error: unknown,
    signal: AbortSignal
  ): Promise<'continue' | 'fatal'> {
    if (signal.aborted) return 'fatal';

    const errStatus =
      error instanceof Error ? (error as Error & { status?: number }).status : undefined;
    const analysis = analyzeLLMError(error as Error, config.model.model, errStatus);

    if (analysis.recoverable && state) {
      switch (analysis.recovery) {
        case 'escalate_output_tokens':
          if (state.recovery.outputTokenEscalationCount < RECOVERY_LIMITS.outputTokenEscalation) {
            state.recovery.outputTokenEscalationCount++;
            recoveryState.escalatedMaxTokens = ESCALATED_MAX_OUTPUT_TOKENS;
            await runLifecycleHook('recovery.escalate', { error: analysis.message }, {});
            return 'continue';
          }
          break;

        case 'inject_recovery_message':
          if (state.recovery.recoveryMessageCount < RECOVERY_LIMITS.recoveryMessage) {
            state.recovery.recoveryMessageCount++;
            state.messages.push({
              role: 'user',
              content: 'Output token limit hit. Resume directly — no apology, no recap.',
            });
            await runLifecycleHook('recovery.compact', { error: analysis.message }, {});
            return 'continue';
          }
          break;

        case 'switch_fallback_model':
          if (
            config.fallbackModel &&
            state.recovery.fallbackSwitchCount < RECOVERY_LIMITS.fallbackSwitch
          ) {
            state.recovery.fallbackSwitchCount++;
            config.model = config.fallbackModel;
            await runLifecycleHook(
              'recovery.fallback',
              { error: analysis.message },
              { model: config.fallbackModel }
            );
            return 'continue';
          }
          break;

        case 'trigger_compaction':
          if (
            ctx.compactionManager &&
            state.recovery.compactionRetryCount < RECOVERY_LIMITS.compactionRetry
          ) {
            state.recovery.compactionRetryCount++;
            if (state) {
              await runLifecycleHook(
                'compaction.before',
                {
                  sessionId: ctx.sessionId,
                  messages: state.messages,
                  tokenCount: state.tokens.prompt + state.tokens.completion,
                },
                {}
              );
              const result = await ctx.compactionManager.compact(
                {
                  sessionId: ctx.sessionId,
                  messages: state.messages,
                  maxTokens: config.tokenBudget ?? 200_000,
                  currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
                },
                { aggressive: true }
              );
              state.messages = result.messages as Message[];
              await runLifecycleHook(
                'compaction.after',
                {
                  sessionId: ctx.sessionId,
                  messages: state.messages,
                },
                {}
              );
            }
            return 'continue';
          }
          break;
      }
    }

    return 'fatal';
  }

  // ============================================================
  // Tool Execution
  // ============================================================

  /**
   * Execute a single tool call with full safety pipeline:
   * ToolHook → PermissionController → SecurityGuard → Sandbox/Tool execution.
   * Extracted from the serial loop so both serial and parallel paths reuse it.
   */
  async function executeSingleTool(tc: ToolCall, signal: AbortSignal): Promise<Message> {
    // Emit tool.call
    void emitter.emit({
      type: 'tool.call',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      toolCallId: tc.id,
      toolName: tc.name,
      args: tc.args,
    });

    // ── MPU M5: Audit tool call ──
    ctx.auditLogger?.append({
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      eventType: 'tool.call',
      action: 'tool.call',
      resource: tc.name,
      result: 'success',
      details: { toolCallId: tc.id },
    });

    // ── ToolHook: permission check ──
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
      void emitter.emit({
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
        result: extractText(deniedMsg.content),
        isError: true,
      });
      return deniedMsg;
    }

    // Get tool definition for subsequent checks
    const toolDef = ctx.tools.get(tc.name);

    // ── HITL PermissionController: primary gate (A2 iron law) ──
    // Inserted between ToolHook (secondary check) and SecurityGuard.
    // Uses evaluatePermission() for policy-based routing:
    //   deny → block immediately
    //   allow → proceed
    //   ask  → human-in-the-loop via PermissionController (with rejection isolation)
    if (toolDef && ctx.permissionController && ctx.permissionPolicy) {
      const policyDecision = evaluatePermission(toolDef, ctx.permissionPolicy);

      if (policyDecision === 'deny') {
        const deniedMsg: Message = {
          role: 'tool',
          content: `Permission denied for tool: ${tc.name} (policy: deny)`,
          toolCallId: tc.id,
          name: tc.name,
        };
        void emitter.emit({
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: extractText(deniedMsg.content),
          isError: true,
        });
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
          type: 'permission.prompt',
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

        // ── Isolate permission ask from batch abort ──
        // Treat controller rejection as per-tool deny, not loop crash.
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
          // Permission system failure → deny the tool, don't crash the loop
          permDecision = 'deny';
        }

        void emitter.emit({
          type: 'permission.decision',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          promptId,
          decision: permDecision,
        });

        // Audit the HITL decision regardless of outcome
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
          void emitter.emit({
            type: 'tool.result',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            result: extractText(deniedMsg.content),
            isError: true,
          });
          return deniedMsg;
        }
        // 'allow' or 'allow_always' → proceed to SecurityGuard
      }
      // policyDecision === 'allow' → proceed to SecurityGuard
    }

    // ── MPU M6: Security check before tool execution ──

    // Check command/path/network blocklist
    if (toolDef && ctx.securityGuard) {
      const cmdCheck = ctx.securityGuard.checkCommand(tc.name);
      if (!cmdCheck.allowed) {
        const blockedMsg: Message = {
          role: 'tool',
          content: `Tool "${tc.name}" blocked by security guard: ${cmdCheck.reason}`,
          toolCallId: tc.id,
          name: tc.name,
        };
        void emitter.emit({
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: `Blocked: ${cmdCheck.reason}`,
          isError: true,
        });
        // ── MPU M5: Audit blocked tool call ──
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
      const sbResultStr = sandboxResult.success
        ? (sandboxResult.result ?? '')
        : `Sandbox error: ${sandboxResult.error?.message ?? 'Unknown error'}`;
      void emitter.emit({
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
        result: sbResultStr,
        isError: !sandboxResult.success,
      });
      return {
        role: 'tool',
        content: sbResultStr,
        toolCallId: tc.id,
        name: tc.name,
      };
    }

    // ── Execute tool ──
    await runLifecycleHook(
      'tool.execute.before',
      {
        sessionId: ctx.sessionId,
        toolName: tc.name,
        callId: tc.id,
        args: tc.args,
      },
      {}
    );

    // ── MPU M5: Audit tool execution ──
    ctx.auditLogger?.append({
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      eventType: 'tool.call',
      action: 'tool.call',
      resource: tc.name,
      result: 'success',
      details: { toolCallId: tc.id },
    });

    try {
      const result = await ctx.tools.execute(tc.name, tc.args, {
        toolCallId: tc.id,
        parentSessionId: ctx.sessionId,
      });

      await runLifecycleHook(
        'tool.execute.after',
        {
          sessionId: ctx.sessionId,
          toolName: tc.name,
          callId: tc.id,
          args: tc.args,
        },
        { result }
      );

      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      void emitter.emit({
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
        result: resultStr,
        isError: false,
      });

      // ── MPU M5: Audit tool result (success) ──
      ctx.auditLogger?.append({
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        eventType: 'tool.result',
        action: 'tool.result',
        resource: tc.name,
        result: 'success',
        details: { toolCallId: tc.id },
      });

      // ── MPU M10: Result validation ──
      if (ctx.services.resultValidator) {
        try {
          const validation = ctx.services.resultValidator.validate(tc.name, resultStr);
          if (!validation.valid) {
            ctx.logger?.warn(`Tool result validation failed for ${tc.name}:`, {
              errors: validation.errors,
            });
          }
        } catch {
          /* isolate */
        }
      }

      return {
        role: 'tool',
        content: resultStr,
        toolCallId: tc.id,
        name: tc.name,
      };
    } catch (err) {
      const errStr = err instanceof Error ? err.message : String(err);

      await runLifecycleHook(
        'tool.execute.error',
        {
          sessionId: ctx.sessionId,
          toolName: tc.name,
          callId: tc.id,
          error: err,
        },
        { retry: false }
      );

      void emitter.emit({
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
        result: errStr,
        isError: true,
      });

      // ── MPU M5 + M4: Audit + circuit breaker on tool error ──
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
        } catch {
          /* isolate */
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

  /**
   * Execute a batch of concurrency-safe tools in parallel via Promise.all.
   * Emits tool.batch.start/tool.batch.complete events for observability.
   */
  async function executeToolBatchParallel(
    batch: { calls: ToolCall[]; isConcurrencySafe: boolean },
    signal: AbortSignal
  ): Promise<Message[]> {
    const batchId = generateId('batch');
    const startedAt = Date.now();

    // Emit batch start event
    void emitter.emit({
      type: 'tool.batch.start',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      batchId,
      totalCalls: batch.calls.length,
    });

    // Execute all tools in parallel — each tool emits its own tool.call via executeSingleTool
    const settled = await Promise.all(batch.calls.map(tc => executeSingleTool(tc, signal)));

    // Count results
    const successCount = settled.filter(
      m => !m.content?.toString().includes('Permission denied')
    ).length;
    const errorCount = settled.length - successCount;

    // Emit batch complete event
    void emitter.emit({
      type: 'tool.batch.complete',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      batchId,
      totalCalls: batch.calls.length,
      successCount,
      errorCount,
      durationMs: Date.now() - startedAt,
    });

    return settled;
  }

  async function executeToolBatch(
    batch: { calls: ToolCall[]; isConcurrencySafe: boolean },
    signal: AbortSignal
  ): Promise<Message[]> {
    // Parallel path for concurrency-safe batches
    if (batch.isConcurrencySafe && config.parallelToolCalls && batch.calls.length > 1) {
      return executeToolBatchParallel(batch, signal);
    }

    // Serial path (unchanged behavior)
    const results: Message[] = [];
    for (const tc of batch.calls) {
      if (signal.aborted) break;
      const result = await executeSingleTool(tc, signal);
      results.push(result);
    }
    return results;
  }

  // ============================================================
  // Main Run Function
  // ============================================================

  async function run(input: string): Promise<string> {
    // ── Re-entry guard ──
    if (isRunning) {
      const errEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        error: { name: 'AgentAlreadyRunningError', message: 'Agent is already running' },
      };
      void emitter.emit(errEvent);
      void emitter.emit({
        type: 'done',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        reason: 'error',
      });
      return '';
    }
    isRunning = true;

    // ── State Machine: pending → running ──
    stateMachine.transition('running');

    // ── Cancel previous run, create new AbortController ──
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    // ── Wire external abort signal ──
    if (ctx.abortSignal) {
      if (ctx.abortSignal.aborted) {
        isRunning = false;
        return '';
      }
      onExternalAbort = () => abortController?.abort();
      ctx.abortSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    paused = false;
    resumePromise = null;
    resumeResolve = null;

    // ── Initialize state ──
    const messages: Message[] = [];
    if (config.systemPrompt) {
      messages.push({ role: 'system', content: config.systemPrompt });
    }
    if (config.history?.length) {
      messages.push(...config.history);
    }

    // ── MPU M6: Sanitize user input for prompt injection ──
    const sanitizedInput = ctx.inputSanitizer ? ctx.inputSanitizer.sanitize(input) : input;
    messages.push({ role: 'user', content: sanitizedInput });

    state = createInitialState({
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      model: config.model,
      initialMessages: messages,
      maxSteps: config.maxSteps ?? 10,
    });

    const maxSteps = state.maxSteps;
    const tokenBudget = config.tokenBudget ?? 200_000;
    const budgetTracker = createBudgetTracker();

    // ── Emit agent.start ──
    void emitter.emit({
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      input,
      agentName: ctx.agentName,
      model: config.model,
    });

    await runLifecycleHook(
      'session.start',
      {
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        input,
        model: config.model,
      },
      {}
    );

    // ====================================================================
    // Plan-Then-Execute (LLM-driven planning, controlled by executionMode)
    // ====================================================================
    const execMode = config.executionMode ?? 'react';
    let plannerSucceeded = false;

    const cleanupRun: () => void = (): void => {
      if (onExternalAbort) {
        ctx.abortSignal?.removeEventListener('abort', onExternalAbort);
        onExternalAbort = null;
      }
      isRunning = false;
      abortController = null;
    };

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
    };

    if (execMode !== 'react' && ctx.planner) {
      try {
        const toolNames = ctx.tools?.getFunctionDefs().map((f: { name: string }) => f.name) ?? [];
        const plan = await ctx.planner.plan(input, {
          availableTools: toolNames,
          maxSteps: config.maxSteps ?? 10,
        });

        if (!plan || plan.steps.length === 0) {
          if (execMode === 'plan-then-execute-strict') {
            strictFail(
              ctx.planner.lastDiagnostic ?? 'Planner produced an empty plan (no steps generated)'
            );
            return '';
          }
        } else {
          const validation = await ctx.planner.validate(plan, {
            availableTools: toolNames,
            maxSteps: config.maxSteps ?? 10,
          });

          if (!validation.valid) {
            if (execMode === 'plan-then-execute-strict') {
              const errorDetail = validation.errors.map(e => `${e.path}: ${e.message}`).join('; ');
              strictFail(`Plan validation failed: ${errorDetail}`);
              return '';
            }
          } else if (ctx.tools) {
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
                input,
                { availableTools: toolNames, maxSteps: config.maxSteps ?? 10 },
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
              plannerSucceeded = true;
              const finalOutput = outputs.join('\n');
              stateMachine.transition('completed');
              void emitter.emit({
                type: 'agent.complete',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
                output: finalOutput,
                steps: state?.step ?? 0,
              } as AgentEvent);
              void emitter.emit({
                type: 'done',
                reason: 'stop',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
              });
              state.output = finalOutput;
              cleanupRun();
            } else if (execMode === 'plan-then-execute-strict') {
              strictFail(
                'Plan execution produced no output (all steps completed but returned empty)'
              );
              return '';
            }
          }
        }
      } catch (planningError) {
        if (execMode === 'plan-then-execute-strict') {
          strictFail(ctx.planner.lastDiagnostic ?? 'Planner threw an exception', planningError);
          return '';
        }

        // Plan-then-execute (non-strict): fall through to ReAct loop
        if (ctx.logger) {
          ctx.logger.warn('Plan-then-execute failed, falling back to ReAct loop');
        }
      }
    }

    // ====================================================================
    // MAIN LOOP (ReAct — fallback or default)
    // ====================================================================
    if (!plannerSucceeded) {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // ── Guard: abort ──
          if (signal.aborted) break;

          // ── Guard: pause ──
          if (paused) {
            // eslint-disable-next-line @typescript-eslint/await-thenable
            await resumePromise;
            if (signal.aborted) break;
          }

          // ── Guard: max steps ──
          if (state.step >= maxSteps) {
            stateMachine.transition('completed');
            void emitter.emit({
              type: 'agent.complete',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              output: state.output,
              steps: state.step,
            });
            void emitter.emit({
              type: 'done',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              reason: 'length',
            });
            await runLifecycleHook(
              'session.end',
              {
                sessionId: ctx.sessionId,
                reason: 'max_steps',
                steps: state.step,
                tokens: state.tokens,
              },
              {}
            );
            return state.output;
          }

          // ── Lifecycle: step.begin ──
          await runLifecycleHook(
            'step.begin',
            {
              sessionId: ctx.sessionId,
              step: state.step,
              maxSteps,
              messageCount: state.messages.length,
            },
            {}
          );

          // ── Emit agent.step for backward compat ──
          void emitter.emit({
            type: 'agent.step',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            step: state.step,
            maxSteps,
          } as AgentEvent);

          // ── 1. Request Hooks: transform messages ──
          let msgs = [...state.messages];
          for (const h of hooks.getRequestHooks()) {
            msgs = await h.apply(msgs, state);
          }

          await runLifecycleHook(
            'llm.request.before',
            {
              sessionId: ctx.sessionId,
              messages: msgs,
              model: config.model,
            },
            {}
          );

          // ── MPU M8: Auto-compaction check ──
          if (ctx.compactionManager) {
            const needsCompact = ctx.compactionManager.needsCompaction({
              sessionId: ctx.sessionId,
              messages: state.messages,
              currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
              maxTokens: config.tokenBudget ?? 200_000,
            });
            if (needsCompact) {
              const result = await ctx.compactionManager.compact({
                sessionId: ctx.sessionId,
                messages: state.messages,
                currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
                maxTokens: config.tokenBudget ?? 200_000,
              });
              state.messages = result.messages as Message[];
            }
          }

          // ── Checkpoint Registry: pre-llm phase (R6) ──
          // ── Pre-LLM Checkpoints (R6 — plugin-based) ──
          let blocked = false;
          let blockReason = '';
          for (const fn of preLlmCheckpoints) {
            const result = await fn(ctx, state, msgs);
            if (result.action === 'block') {
              blocked = true;
              blockReason = result.reason;
              break;
            }
          }
          if (blocked) {
            // R1: errors-as-events
            const errMsg =
              blockReason === 'quota_exceeded'
                ? 'Token/cost quota exceeded'
                : 'LLM rate limit exceeded';
            stateMachine.transition('error');
            void emitter.emit({
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              error: {
                name:
                  blockReason === 'quota_exceeded'
                    ? 'QuotaExceededError'
                    : 'RateLimitExceededError',
                message: errMsg,
              },
            });
            void emitter.emit({
              type: 'done',
              reason: 'error',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
            });
            return state.output;
          }

          // ── 2. LLM Call ──
          // ── MPU M5: Audit LLM request ──
          ctx.auditLogger?.append({
            sessionId: ctx.sessionId,
            agentName: ctx.agentName,
            eventType: 'llm.request',
            action: 'llm.request',
            resource: config.model.model,
            result: 'success',
            details: { messages: msgs.length, model: config.model },
          });

          // ── Emit llm.request for backward compat ──
          void emitter.emit({
            type: 'llm.request',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            messages: msgs,
            model: config.model,
          } as AgentEvent);

          // ── ToolProvider Hooks: per-call dynamic tool injection ──
          let toolDefs = ctx.tools?.getFunctionDefs() ?? [];
          for (const h of hooks.getToolProviderHooks()) {
            toolDefs = await h.filter(toolDefs, state);
          }

          let response;
          try {
            const llmOpts: LLMOptions = { signal, tools: toolDefs as LLMOptions['tools'] };
            if (recoveryState.escalatedMaxTokens) {
              llmOpts.maxTokens = recoveryState.escalatedMaxTokens;
            }
            response = await ctx.llm.chat(msgs, llmOpts);
            state.tokens.prompt += response.usage?.promptTokens ?? 0;
            state.tokens.completion += response.usage?.completionTokens ?? 0;

            // ── MPU M7: Quota consumption tracking ──
            if (ctx.quota && response.usage) {
              ctx.quota.consume(ctx.sessionId, {
                promptTokens: response.usage.promptTokens ?? 0,
                completionTokens: response.usage.completionTokens ?? 0,
              });
            }
          } catch (error) {
            await runLifecycleHook('llm.error', { error, messages: msgs }, {});
            const recovery = await handleLLMError(error, signal);
            if (recovery === 'continue') {
              state.step++;
              continue;
            }
            // R1: errors-as-events, never throw — handle LLM errors inline
            const err = serializeError(error);
            stateMachine.transition('error');
            void emitter.emit({
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              error: err,
            });
            void emitter.emit({
              type: 'done',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              reason: 'error',
            });
            ctx.auditLogger?.append({
              sessionId: ctx.sessionId,
              agentName: ctx.agentName,
              eventType: 'agent.error',
              action: 'agent.error',
              resource: config.model.model,
              result: 'error',
              details: { error: err },
            });
            return state?.output ?? '';
          }

          // ── Emit llm.response ──
          void emitter.emit({
            type: 'llm.response',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            content: response.content,
            toolCalls: response.toolCalls,
            finishReason: response.finishReason,
            usage: response.usage,
          } as AgentEvent);

          await runLifecycleHook(
            'llm.response.after',
            {
              sessionId: ctx.sessionId,
              step: state.step,
              response,
              usage: response.usage,
            },
            {}
          );

          // ── Post-LLM Checkpoints (R6 — plugin-based) ──
          let postBlocked = false;
          let postBlockReason = '';
          for (const fn of postLlmCheckpoints) {
            const result = await fn(ctx, state, response);
            if (result.action === 'block') {
              postBlocked = true;
              postBlockReason = result.reason;
              break;
            }
          }
          if (postBlocked) {
            // Quality gate failures are non-fatal — the checkpoint already
            // injected the correction message, so just continue the loop.
            if (postBlockReason === 'quality_gate_retry') {
              continue;
            }
            // All other post-llm blocks are fatal
            stateMachine.transition('error');
            void emitter.emit({
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              error: { name: 'CheckpointBlockedError', message: postBlockReason },
            });
            void emitter.emit({
              type: 'done',
              reason: 'error',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
            });
            return state.output;
          }

          // ── MPU M5: Audit LLM response ──
          ctx.auditLogger?.append({
            sessionId: ctx.sessionId,
            agentName: ctx.agentName,
            eventType: 'llm.response',
            action: 'llm.response',
            resource: config.model.model,
            result: 'success',
            details: { finishReason: response.finishReason, usage: response.usage },
          });

          // ── Emit checkpoint after LLM response ──
          const cpEnabled = config.checkpoint?.enabled !== false;
          if (cpEnabled) {
            const cpId = generateId('cp');
            void emitter.emit({
              type: 'checkpoint',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              checkpointId: cpId,
              position: 'after_llm',
              state: state,
            } as AgentEvent);
            // Fire-and-forget: never block the loop on checkpoint save
            ctx.checkpoint
              ?.save({
                id: cpId,
                sessionId: ctx.sessionId,
                position: 'after_llm',
                state,
                timestamp: Date.now(),
                pendingA2A: [],
                executedTools: [],
                recoveryMetadata: { recoveryCount: 0 },
                compactionHistory: [],
              })
              .catch(() => {});
          }
          if (ctx.services.costTracker && response.usage) {
            ctx.services.costTracker
              .record(ctx.sessionId, config.model.model, response.usage)
              .catch(() => {});
          }

          // ── 3. Completion check + Token Budget ──
          if (response.finishReason === 'stop' || !response.toolCalls?.length) {
            const decision = checkTokenBudget(budgetTracker, tokenBudget, state.tokens);
            if (decision === 'continue') {
              // Nudge the LLM to continue with more output
              state.messages = [
                ...state.messages,
                { role: 'assistant', content: response.content },
                {
                  role: 'user',
                  content: 'Continue from where you left off. Do not repeat or summarize.',
                },
              ];
              state.step++;
              continue;
            }
            // Budget exhausted — diminishing returns detected
            state.output = response.content;
            await runLifecycleHook(
              'session.end',
              {
                sessionId: ctx.sessionId,
                reason: 'token_budget',
                steps: state.step,
                tokens: state.tokens,
              },
              {}
            );
            stateMachine.transition('completed');
            void emitter.emit({
              type: 'agent.complete',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              output: state.output,
              steps: state.step,
              tokens: { input: state.tokens.prompt, output: state.tokens.completion },
            });
            void emitter.emit({
              type: 'done',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              reason: 'length',
            });
            break;
          }

          // ── 4. Tool Execution ──
          // Add assistant response to messages
          state.messages = [
            ...state.messages,
            ...msgs.slice(state.messages.length), // RequestHook-injected messages
            { role: 'assistant', content: response.content ?? '' } as Message,
          ];

          const toolCalls = response.toolCalls;
          const batches = partitionToolCalls(
            toolCalls,
            ctx.tools as unknown as { isConcurrencySafe?: (name: string) => boolean } | null
          );
          const toolResults: Message[] = [];

          for (const batch of batches) {
            if (signal.aborted) break;

            const results = await executeToolBatch(batch, signal);
            toolResults.push(...results);
          }

          // ── 5. Append tool results, increment step ──
          state.messages = [...state.messages, ...toolResults];
          state.step++;

          await runLifecycleHook(
            'step.end',
            {
              sessionId: ctx.sessionId,
              step: state.step,
              toolCallsExecuted: toolCalls.length,
            },
            {}
          );

          // ── Emit checkpoint after tool execution ──
          const cpEnabled2 = config.checkpoint?.enabled !== false;
          if (cpEnabled2) {
            const cpId2 = generateId('cp');
            void emitter.emit({
              type: 'checkpoint',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              checkpointId: cpId2,
              position: 'after_tool',
              state: state,
            } as AgentEvent);
            ctx.checkpoint
              ?.save({
                id: cpId2,
                sessionId: ctx.sessionId,
                position: 'after_tool',
                state,
                timestamp: Date.now(),
                pendingA2A: [],
                executedTools: [],
                recoveryMetadata: { recoveryCount: 0 },
                compactionHistory: [],
              })
              .catch(() => {});
          }

          // ── Compaction check ──
          if (shouldCompact(state.messages, state.tokens)) {
            await runLifecycleHook(
              'compaction.before',
              {
                sessionId: ctx.sessionId,
                messages: state.messages,
                tokenCount: state.tokens.prompt + state.tokens.completion,
              },
              {}
            );
            if (ctx.compactionManager) {
              const result = await ctx.compactionManager.compact({
                sessionId: ctx.sessionId,
                messages: state.messages,
                maxTokens: config.tokenBudget ?? 200_000,
                currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
              });
              state.messages = result.messages as Message[];
            }
            await runLifecycleHook(
              'compaction.after',
              {
                sessionId: ctx.sessionId,
                messages: state.messages,
              },
              {}
            );
          }
        }
      } catch (error) {
        // ── Errors-as-events ──
        const err: SerializedError = serializeError(error);
        stateMachine.transition('error');
        const errEvent: AgentEvent = {
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          error: err,
        };
        void emitter.emit(errEvent);
        void emitter.emit({
          type: 'done',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          reason: 'error',
        });

        // ── MPU M5: Audit error ──
        ctx.auditLogger?.append({
          sessionId: ctx.sessionId,
          agentName: ctx.agentName,
          eventType: 'agent.error',
          action: 'agent.error',
          resource: ctx.agentName,
          result: 'error',
          details: { error: err },
        });

        // ── MPU M4: Auto-repairer attempt before circuit breaker ──
        if (ctx.autoRepairer) {
          try {
            const repairCtx: import('../contracts/mpu-interfaces.js').RepairContext = {
              error: err,
              retryCount: 0,
              sessionId: ctx.sessionId,
              llm: ctx.llm,
              ...(ctx.compactionManager ? { compactionManager: ctx.compactionManager } : {}),
              messages: state?.messages ?? [],
              currentTokenEstimate: state ? state.tokens.prompt + state.tokens.completion : 0,
              config: {
                ...(config.fallbackModel
                  ? {
                      fallbackModel: `${config.fallbackModel.provider}/${config.fallbackModel.model}`,
                    }
                  : {}),
              },
            };
            const repairResult = await ctx.autoRepairer.attemptRepair(repairCtx);
            if (repairResult.success) {
              // Repair succeeded — don't trip circuit breaker, let loop retry
              ctx.logger?.info('Auto-repair succeeded', { description: repairResult.description });
            }
          } catch {
            /* isolate */
          }
        }

        // ── MPU M4: Circuit breaker ──
        if (ctx.errorClassifier && ctx.circuitBreaker) {
          try {
            const severity = ctx.errorClassifier.classify(err);
            if (severity === 'moderate' || severity === 'severe') {
              ctx.circuitBreaker.recordFailure(severity);
            }
          } catch {
            /* isolate */
          }
        }

        // ── Notify error handler ──
        const errorObj = error instanceof Error ? error : new Error(String(error));
        ctx.onError?.(errorObj, errEvent, 'unknown');
        ctx.logger?.error('Agent loop unexpected error', errorObj);

        return state?.output ?? ''; // R1: errors-as-events, never throw
      } finally {
        if (onExternalAbort) {
          ctx.abortSignal?.removeEventListener('abort', onExternalAbort);
          onExternalAbort = null;
        }
        isRunning = false;
        abortController = null;
      }

      return state?.output ?? '';
    } // end if (!plannerSucceeded)

    return state?.output ?? '';
  }

  // ============================================================
  // AsyncGenerator Iteration (bridges emitter to generator yields)
  // ============================================================

  let iterationActive = false;

  async function* iterate(input: string): AsyncGenerator<AgentEvent, string, void> {
    // Re-entrancy guard — run() also checks isRunning, but iterate()
    // replaces emitter.emit globally. Concurrent iterate() calls produce
    // stacked overrides that leak events between generators.
    // Must use a synchronous flag because isRunning is set inside run()
    // which fires via microtask (Promise.resolve().then).
    if (iterationActive || isRunning) {
      const now = Date.now();
      yield {
        type: 'agent.error',
        timestamp: now,
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        error: { name: 'AgentAlreadyRunningError', message: 'Agent is already running' },
      } as AgentEvent;
      yield {
        type: 'done',
        timestamp: now,
        sessionId: ctx.sessionId,
        reason: 'error',
        agentName: ctx.agentName,
      } as AgentEvent;
      return '';
    }

    const eventQueue: AgentEvent[] = [];
    let eventPushResolve: (() => void) | null = null;

    const origEmit = emitter.emit.bind(emitter);
    emitter.emit = async (event: AgentEvent): Promise<void> => {
      eventQueue.push(event);
      if (eventPushResolve) {
        eventPushResolve();
        eventPushResolve = null;
      }
      await origEmit(event);
    };

    iterationActive = true;
    let runDone = false;
    try {
      let runResult: string;
      const runPromise = Promise.resolve()
        .then(() => run(input))
        .then(v => {
          runResult = v;
          runDone = true;
          // Wake the generator if it is waiting for events.
          // Without this, paths that return without emitting a final event
          // (maxSteps, cancel) cause a deadlock.
          if (eventPushResolve) {
            eventPushResolve();
            eventPushResolve = null;
          }
          return v;
        });

      while (!runDone || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        } else if (!runDone) {
          await new Promise<void>(resolve => {
            eventPushResolve = resolve;
          });
        }
      }

      await runPromise;
      return runResult!;
    } finally {
      emitter.emit = origEmit;
      iterationActive = false;
      if (!runDone) {
        cancelLoop();
      }
    }
  }

  function cancelLoop(): void {
    abortController?.abort();
    isRunning = false;
    stateMachine.transition('cancelled');
  }

  // ============================================================
  // Return
  // ============================================================

  return {
    run,
    iterate,
    on: emitter.on.bind(emitter),
    onAny: emitter.onAny.bind(emitter),
    emit: (event: AgentEvent): Promise<void> => emitter.emit(event),
    cancel: cancelLoop,
    pause: (): void => {
      paused = true;
      stateMachine.transition('paused');
      resumePromise = new Promise<void>(r => {
        resumeResolve = r;
      });
    },
    resume: (): void => {
      paused = false;
      stateMachine.transition('running');
      resumeResolve?.();
      resumeResolve = null;
      resumePromise = null;
    },
    getState: (): AgentState | null => state,
    getStatus: (): string => stateMachine.state,
    onStateChange: (fn: (from: string, to: string) => void): (() => void) =>
      stateMachine.onChange((from, to) => fn(from, to)),
    destroy: (): void => {
      ctx.circuitBreaker?.destroy();
      abortController?.abort();
      emitter.clear();
      hooks.clear();
      isRunning = false;
      state = null;
    },
  };
}
