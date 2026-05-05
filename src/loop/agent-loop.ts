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
  serializeError,
  generateId,
} from '../core/events.js';
import type { AgentContext } from '../core/context.js';
import type { AgentState } from '../core/state.js';
import { AgentStateMachine, type AgentStateEnum } from '../core/state-machine.js';
import { extractText } from '../core/content-utils.js';
import {
  HookRegistry,
  type LifecyclePhase,
  RequestHookPriority,
  type CheckpointFn,
} from '../core/hooks.js';
import { createInitialState } from '../core/state.js';
import { checkTokenBudget, createBudgetTracker, shouldCompact } from './token-budget.js';
import { type ErrorRecoveryDeps } from './error-recovery-handler.js';
import { runPlanThenExecute } from './plan-executor.js';
import { performLLMCall, type LLMCallDeps, performStreamingLLMCall } from './llm-caller.js';
import { partitionToolCalls } from './tool-partition.js';
import { evaluatePermission } from '../security/permission/permission-policy.js';
import { createDoomLoopDetector, type DoomLoopDetector } from './doom-loop-detector.js';
import { createFileTracker, extractPathsFromArgs, type FileTracker } from './file-snapshot.js';

// ============================================================
// Types
// ============================================================

/** Structured result returned by AgentLoop.run() and AgentLoop.iterate() */
export interface RunResult {
  output: string;
  status: 'success' | 'error' | 'aborted' | 'max_steps' | 'cancelled';
  error?: SerializedError;
}

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
  /** Run the agent loop with user input. Returns structured result with status. */
  run(input: string): Promise<RunResult>;
  /**
   * AsyncGenerator-based iteration. Captures all emitted events and yields them
   * to the caller. Returns structured result. Subscribe via on()/onAny()
   * for events outside the generator context.
   */
  iterate(input: string): AsyncGenerator<AgentEvent, RunResult, void>;
  /** Subscribe to typed events */
  on<T extends AgentEvent['type']>(
    type: T,
    fn: (e: Extract<AgentEvent, { type: T }>) => void
  ): () => void;
  /** Subscribe to all events */
  onAny(fn: (e: AgentEvent) => void): () => void;
  /** Emit an external event through this loop's emitter (e.g., from subsystems) */
  emit(event: AgentEvent): Promise<void>;
  /** Direct access to the underlying event emitter (for Plugin wiring) */
  readonly emitter: AgentEventEmitter;
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
  const emitter = new AgentEventEmitter(ctx.logger);
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
  // Priority 20 — sits between MEMORY (10) and SKILL (30).
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

  // ── File Snapshot Tracker (P2-15) ──
  const fileTracker: FileTracker = createFileTracker();

  // ── Error recovery mutable state (shared with handleLLMError) ──
  const recoveryState = {
    escalatedMaxTokens: undefined as number | undefined,
  };

  // ============================================================
  // Lifecycle Hook Runner (error-isolated)
  // ============================================================

  async function runLifecycleHook(
    phase: LifecyclePhase,
    input: unknown,
    output: unknown
  ): Promise<void> {
    for (const h of hooks.getLifecycleHooks(phase)) {
      try {
        await h(input, output);
      } catch (err) {
        ctx.logger?.warn('Lifecycle hook error', {
          hookName: phase,
          error: serializeError(err),
        });
      }
    }
  }

  // ============================================================
  // Error Recovery
  // ============================================================

  // ============================================================
  // Tool Execution
  // ============================================================

  /**
   * Execute a single tool call with full safety pipeline:
   * ToolHook → PermissionController → SecurityGuard → Sandbox/Tool execution.
   * Extracted from the serial loop so both serial and parallel paths reuse it.
   */
  async function executeSingleTool(
    tc: ToolCall,
    signal: AbortSignal,
    batchId?: string
  ): Promise<Message> {
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
      emitToolResult(extractText(deniedMsg.content), true);
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
        } as AgentEvent);

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
          type: 'permission',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          promptId,
          permission: tc.name,
          decision: permDecision,
        } as AgentEvent);

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
          emitToolResult(extractText(deniedMsg.content), true);
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
        emitToolResult(`Blocked: ${cmdCheck.reason}`, true);
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
      emitToolResult(sbResultStr, !sandboxResult.success);
      return {
        role: 'tool',
        content: sbResultStr,
        toolCallId: tc.id,
        name: tc.name,
      };
    }

    // ── Execute tool ──
    await runLifecycleHook(
      'tool.before',
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

    // ── File Snapshot: take before-snapshot for tools that modify files ──
    const filePaths = extractPathsFromArgs(tc.args);
    let beforeSnapshot = null;
    if (filePaths.length > 0) {
      beforeSnapshot = await fileTracker.takeSnapshotOf(filePaths);
    }

    try {
      const result = await ctx.tools.execute(tc.name, tc.args, {
        toolCallId: tc.id,
        parentSessionId: ctx.sessionId,
      });

      // ── File Snapshot: notify tracker of changes ──
      if (beforeSnapshot && filePaths.length > 0) {
        const afterSnapshot = await fileTracker.takeSnapshotOf(filePaths);
        const changes = fileTracker.diff(beforeSnapshot, afterSnapshot);
        if (changes.length > 0) {
          fileTracker.notify(changes, ctx.sessionId);
        }
      }

      await runLifecycleHook(
        'tool.after',
        {
          sessionId: ctx.sessionId,
          toolName: tc.name,
          callId: tc.id,
          args: tc.args,
        },
        { result }
      );

      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      emitToolResult(resultStr, false);

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
        } catch (err) {
          ctx.logger?.warn('Tool result validation error', {
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
      const errStr = err instanceof Error ? err.message : String(err);

      await runLifecycleHook(
        'tool.error',
        {
          sessionId: ctx.sessionId,
          toolName: tc.name,
          callId: tc.id,
          error: err,
        },
        { retry: false }
      );

      emitToolResult(errStr, true);

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
        } catch (err) {
          ctx.logger?.warn('Error classification / circuit breaker error', {
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

  /**
   * Execute a batch of concurrency-safe tools in parallel via Promise.all.
   * Passes batchId to each tool.call/tool.result for observability.
   */
  async function executeToolBatchParallel(
    batch: { calls: ToolCall[]; isConcurrencySafe: boolean },
    signal: AbortSignal
  ): Promise<Message[]> {
    const batchId = generateId('batch');

    // Execute all tools in parallel — each tool emits its own tool.call/tool.result with batchId
    const settled = await Promise.all(
      batch.calls.map(tc => executeSingleTool(tc, signal, batchId))
    );

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
  // Auto-Repair Helper
  // ============================================================

  const MAX_AUTO_REPAIR_ATTEMPTS = 3;

  async function attemptAutoRepair(error: unknown, state: AgentState): Promise<boolean> {
    if (!ctx.autoRepairer) return false;
    if (state.autoRepairAttempts >= MAX_AUTO_REPAIR_ATTEMPTS) return false;

    try {
      const err = serializeError(error);
      const repairCtx: import('../contracts/mpu-interfaces.js').RepairContext = {
        error: err,
        retryCount: state.autoRepairAttempts,
        sessionId: ctx.sessionId,
        llm: ctx.llm,
        ...(ctx.compactionManager ? { compactionManager: ctx.compactionManager } : {}),
        messages: state.messages,
        currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
        config: {
          ...(config.fallbackModel
            ? { fallbackModel: `${config.fallbackModel.provider}/${config.fallbackModel.model}` }
            : {}),
        },
      };
      const result = await ctx.autoRepairer.attemptRepair(repairCtx);
      if (result.success) {
        ctx.logger?.info('Auto-repair succeeded, retrying', {
          description: result.description,
          attempt: state.autoRepairAttempts + 1,
        });
        return true;
      }
      ctx.logger?.warn('Auto-repair failed', {
        description: result.description,
      });
      return false;
    } catch (repairErr) {
      ctx.logger?.warn('Auto-repair attempt error', {
        error: serializeError(repairErr),
      });
      return false;
    }
  }

  // ============================================================
  // Main Run Function
  // ============================================================

  async function run(input: string): Promise<RunResult> {
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
      return {
        output: '',
        status: 'error',
        error: { name: 'AgentAlreadyRunningError', message: 'Agent is already running' },
      };
    }
    isRunning = true;

    // ── State Machine: pending → running ──
    stateMachine.transition('running');

    // ── Doom loop detector ──
    const doomLoop: DoomLoopDetector = createDoomLoopDetector();

    // ── Cancel previous run, create new AbortController ──
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    // ── Wire external abort signal ──
    if (ctx.abortSignal) {
      if (ctx.abortSignal.aborted) {
        isRunning = false;
        return { output: '', status: 'aborted' };
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

    // ── Deps for extracted loop modules (must be after state init) ──
    const errorRecoveryDeps: ErrorRecoveryDeps = {
      ctx,
      config,
      state,
      recoveryState,
      emitter,
      runLifecycleHook,
    };
    const llmCallDeps: LLMCallDeps = {
      ctx,
      config,
      hooks,
      emitter,
      state,
      recoveryState,
      errorRecoveryDeps,
      runLifecycleHook,
      // onChunk is intentionally undefined here; streaming consumers
      // subscribe via onChunk through the AgentLoop API surface
    };

    // ── Emit agent.start (awaited — plugins load memory/skills here) ──
    await emitter.emit({
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
    // Plan-Then-Execute (delegated to plan-executor.ts)
    // ====================================================================
    const execMode = config.executionMode ?? 'react';

    const cleanupRun: () => void = (): void => {
      if (onExternalAbort) {
        ctx.abortSignal?.removeEventListener('abort', onExternalAbort);
        onExternalAbort = null;
      }
      isRunning = false;
      abortController = null;
    };

    const planResult = await runPlanThenExecute({
      ctx,
      state,
      input,
      emitter,
      stateMachine,
      executionMode: execMode,
      maxSteps: config.maxSteps ?? 10,
      cleanupRun,
    });

    if (planResult.shouldTerminate) {
      return { output: state?.output ?? '', status: 'success' };
    }
    if (planResult.finalOutput !== undefined) {
      state.output = planResult.finalOutput;
    }
    const plannerSucceeded = planResult.plannerSucceeded;

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
              stepCount: state.step,
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
            return { output: state.output, status: 'max_steps' };
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
              void emitter.emit({
                type: 'compaction.start',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
                strategy: ctx.compactionManager.getConfig().strategy,
                tokensBefore: state.tokens.prompt + state.tokens.completion,
              } as AgentEvent);
              const result = await ctx.compactionManager.compact({
                sessionId: ctx.sessionId,
                messages: state.messages,
                currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
                maxTokens: config.tokenBudget ?? 200_000,
              });
              state.messages = result.messages as Message[];
              void emitter.emit({
                type: 'compaction.complete',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
                tokensAfter: result.tokensAfter,
                removedMessages: result.removedCount,
              } as AgentEvent);
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
            return {
              output: state.output,
              status: 'error',
              error: {
                name:
                  blockReason === 'quota_exceeded'
                    ? 'QuotaExceededError'
                    : 'RateLimitExceededError',
                message: errMsg,
              },
            };
          }

          // ── 2. LLM Call (streaming or non-streaming, same result type) ──
          const llmResult = config.streaming
            ? await performStreamingLLMCall(msgs, signal, llmCallDeps)
            : await performLLMCall(msgs, signal, llmCallDeps);

          if (llmResult.status === 'recoverable') {
            state.step++;
            continue;
          }
          if (llmResult.status === 'fatal') {
            // Try auto-repair before giving up (P0-4 fix)
            const repaired = await attemptAutoRepair(llmResult.error, state);
            if (repaired) {
              state.autoRepairAttempts++;
              state.step++;
              continue;
            }

            const err = serializeError(llmResult.error);
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
            return { output: state?.output ?? '', status: 'error', error: err };
          }
          const response = llmResult.response;

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
            return {
              output: state.output,
              status: 'error',
              error: { name: 'CheckpointBlockedError', message: postBlockReason },
            };
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

          // ── Emit state.change with checkpoint after LLM response ──
          const cpEnabled = config.checkpoint?.enabled !== false;
          if (cpEnabled) {
            const cpId = generateId('cp');
            void emitter.emit({
              type: 'state.change',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              from: stateMachine.state,
              to: stateMachine.state,
              checkpoint: { id: cpId, position: 'after_llm' },
            });
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
            doomLoop.reset();
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
              stepCount: state.step,
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

          // Doom loop detection: record each tool call and check for infinite loop
          for (const tc of response.toolCalls) {
            doomLoop.record(tc.name, tc.args);
          }
          if (doomLoop.isDoomLoop()) {
            const details = doomLoop.getDetails();
            stateMachine.transition('error');
            void emitter.emit({
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              error: {
                name: 'DoomLoopDetectedError',
                message: `Doom loop detected: ${details?.repeatCount ?? 3} consecutive identical calls to tool "${details?.toolName ?? 'unknown'}"`,
              },
            });
            void emitter.emit({
              type: 'done',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              reason: 'error',
            });
            return {
              output: state.output,
              status: 'error',
              error: {
                name: 'DoomLoopDetectedError',
                message: `Doom loop detected: ${details?.repeatCount ?? 3} consecutive identical calls to tool "${details?.toolName ?? 'unknown'}"`,
              },
            };
          }

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

          // Reset doom loop detector on tool errors (normal error recovery)
          const hasToolError = toolResults.some(
            m => typeof m.content === 'string' && m.content.startsWith('Error:')
          );
          if (hasToolError) {
            doomLoop.reset();
          }

          await runLifecycleHook(
            'step.end',
            {
              sessionId: ctx.sessionId,
              step: state.step,
              toolCallsExecuted: toolCalls.length,
            },
            {}
          );

          // ── Emit state.change with checkpoint after tool execution ──
          const cpEnabled2 = config.checkpoint?.enabled !== false;
          if (cpEnabled2) {
            const cpId2 = generateId('cp');
            void emitter.emit({
              type: 'state.change',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              from: stateMachine.state,
              to: stateMachine.state,
              checkpoint: { id: cpId2, position: 'after_tool' },
            });
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
              void emitter.emit({
                type: 'compaction.start',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
                strategy: ctx.compactionManager.getConfig().strategy,
                tokensBefore: state.tokens.prompt + state.tokens.completion,
              } as AgentEvent);
              const result = await ctx.compactionManager.compact({
                sessionId: ctx.sessionId,
                messages: state.messages,
                maxTokens: config.tokenBudget ?? 200_000,
                currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
              });
              state.messages = result.messages as Message[];
              void emitter.emit({
                type: 'compaction.complete',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
                tokensAfter: result.tokensAfter,
                removedMessages: result.removedCount,
              } as AgentEvent);
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

        // ── MPU M4: Circuit breaker ──
        if (ctx.errorClassifier && ctx.circuitBreaker) {
          try {
            const severity = ctx.errorClassifier.classify(err);
            if (severity === 'moderate' || severity === 'severe') {
              ctx.circuitBreaker.recordFailure(severity);
            }
          } catch (err) {
            ctx.logger?.warn('Error classifier / circuit breaker error', {
              error: serializeError(err),
            });
          }
        }

        // ── Notify error handler ──
        const errorObj = error instanceof Error ? error : new Error(String(error));
        ctx.onError?.(errorObj, errEvent, 'unknown');
        ctx.logger?.error('Agent loop unexpected error', errorObj);

        return { output: state?.output ?? '', status: 'error', error: err }; // R1: errors-as-events, never throw
      } finally {
        if (onExternalAbort) {
          ctx.abortSignal?.removeEventListener('abort', onExternalAbort);
          onExternalAbort = null;
        }
        isRunning = false;
        abortController = null;
      }

      return { output: state?.output ?? '', status: 'success' };
    } // end if (!plannerSucceeded)

    return { output: state?.output ?? '', status: 'success' };
  }

  // ============================================================
  // AsyncGenerator Iteration (bridges emitter to generator yields)
  // ============================================================

  let iterationActive = false;

  async function* iterate(input: string): AsyncGenerator<AgentEvent, RunResult, void> {
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
      return {
        output: '',
        status: 'error',
        error: { name: 'AgentAlreadyRunningError', message: 'Agent is already running' },
      };
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
      let runResult: RunResult;
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
    emitter,
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
