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
  type SerializedError,
  AgentEventEmitter,
  serializeError,
  generateId,
} from '../core/events.js';
import { ErrorCode } from '../core/error-codes.js';
import type { AgentContext } from '../core/context.js';
import type { AgentState } from '../core/state.js';
import { AgentStateMachine, type AgentStateEnum } from '../core/state-machine.js';
import { extractText } from '../core/content-utils.js';
import {
  HookRegistry,
  type LifecyclePhase,
  type RecoveryPhase,
  RequestHookPriority,
  type CheckpointFn,
  CheckpointBlockReason,
} from '../core/hooks.js';
import { createInitialState } from '../core/state.js';
import {
  checkTokenBudget,
  createBudgetTracker,
  shouldCompact,
  DEFAULT_TOKEN_BUDGET,
} from './token-budget.js';
import { type ErrorRecoveryDeps } from './error-recovery-handler.js';
import { runPlanThenExecute } from './plan-executor.js';
import { performLLMCall, type LLMCallDeps, performStreamingLLMCall } from './llm-caller.js';
import { partitionToolCalls } from './tool-partition.js';
import { executeToolBatch, type ToolExecutorDeps } from './tool-executor.js';
import { createDoomLoopDetector, type DoomLoopDetector } from './doom-loop-detector.js';
import { createFileTracker, type FileTracker } from './file-snapshot.js';
import { attemptAutoRepair } from './auto-repairer.js';
import { bridgeEmitterToGenerator } from './event-iterator.js';
import { type PromptTemplates, DEFAULT_PROMPT_TEMPLATES } from './prompt-templates.js';

// ============================================================
// Types
// ============================================================

/** Structured result returned by AgentLoop.run() and AgentLoop.iterate() */
export interface RunResult {
  output: string;
  status: 'success' | 'error' | 'aborted' | 'max_steps' | 'cancelled';
  error?: SerializedError;
}

export type ExecutionMode = 'react' | 'plan-then-execute' | 'plan-then-execute-strict';

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
  executionMode?: ExecutionMode;
  /** Checkpoint functions to execute before each LLM call (quota, rate-limit) */
  preLlmCheckpoints?: CheckpointFn[];
  /** Checkpoint functions to execute after each LLM response (quality gate, circuit breaker) */
  postLlmCheckpoints?: CheckpointFn[];
  /** Customizable prompt templates (defaults to English) */
  promptTemplates?: PromptTemplates | undefined;
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

  // ── Prompt Templates: from config or defaults ──
  const promptTemplates: PromptTemplates = config.promptTemplates ?? DEFAULT_PROMPT_TEMPLATES;

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
    phase: LifecyclePhase | RecoveryPhase,
    input: unknown,
    output: unknown
  ): Promise<void> {
    // CheckpointPhase values ('pre-llm', 'post-llm') are handled separately
    // by preLlmCheckpoints/postLlmCheckpoints — this function only runs
    // LifecyclePhase (observational) and RecoveryPhase (error/recovery) hooks.
    const recoveryPhases = new Set<string>([
      'llm.error',
      'tool.error',
      'recovery.escalate',
      'recovery.compact',
      'recovery.fallback',
      'error',
    ]);
    const fns = recoveryPhases.has(phase as string)
      ? hooks.getRecoveryHooks(phase as RecoveryPhase)
      : hooks.getLifecycleHooks(phase as LifecyclePhase);
    for (const fn of fns) {
      try {
        await fn(input, output);
      } catch {
        // Plugin isolation — hook errors never crash the loop
      }
    }
  }

  // ============================================================
  // Tool Executor (delegated to tool-executor.ts)
  // ============================================================

  const toolExecutorDeps: ToolExecutorDeps = {
    ctx,
    hooks,
    emitter,
    getState: () => state,
    runLifecycleHook,
    fileTracker,
  };

  // ============================================================
  // Auto-Repair Helper (delegated to auto-repairer.ts)
  // ============================================================

  const autoRepairDeps = { ctx, config };

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
        error: {
          name: 'AgentAlreadyRunningError',
          message: 'Agent is already running',
          code: ErrorCode.AGENT_ALREADY_RUNNING,
        },
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
        error: {
          name: 'AgentAlreadyRunningError',
          message: 'Agent is already running',
          code: ErrorCode.AGENT_ALREADY_RUNNING,
        },
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
    const tokenBudget = config.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
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
              reason: 'completed',
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
              maxTokens: config.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
            });
            if (needsCompact) {
              void emitter.emit({
                type: 'compaction.start',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
                strategy: ctx.compactionManager.getConfig().strategy,
                tokensBefore: state.tokens.prompt + state.tokens.completion,
              });
              const result = await ctx.compactionManager.compact({
                sessionId: ctx.sessionId,
                messages: state.messages,
                currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
                maxTokens: config.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
              });
              state.messages = result.messages;
              void emitter.emit({
                type: 'compaction.complete',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
                tokensAfter: result.tokensAfter,
                removedMessages: result.removedCount,
              });
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
            const isQuotaExceeded = blockReason === CheckpointBlockReason.QUOTA_EXCEEDED;
            const errMsg = isQuotaExceeded
              ? 'Token/cost quota exceeded'
              : 'LLM rate limit exceeded';
            const errCode = isQuotaExceeded
              ? ErrorCode.QUOTA_EXCEEDED
              : ErrorCode.RATE_LIMIT_EXCEEDED;
            const errName = isQuotaExceeded ? 'QuotaExceededError' : 'RateLimitExceededError';
            stateMachine.transition('error');
            void emitter.emit({
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              error: {
                name: errName,
                message: errMsg,
                code: errCode,
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
                name: errName,
                message: errMsg,
                code: errCode,
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
            const repaired = await attemptAutoRepair(autoRepairDeps, llmResult.error, state);
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
          });

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
            if (postBlockReason === CheckpointBlockReason.QUALITY_GATE_RETRY) {
              continue;
            }
            // All other post-llm blocks are fatal
            stateMachine.transition('error');
            void emitter.emit({
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId: ctx.sessionId,
              error: {
                name: 'CheckpointBlockedError',
                message: postBlockReason,
                code: ErrorCode.CHECKPOINT_BLOCKED,
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
                name: 'CheckpointBlockedError',
                message: postBlockReason,
                code: ErrorCode.CHECKPOINT_BLOCKED,
              },
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
                  content: promptTemplates.continuePrompt,
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
              reason: 'completed',
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
                code: ErrorCode.DOOM_LOOP_DETECTED,
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
                code: ErrorCode.DOOM_LOOP_DETECTED,
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

            const results = await executeToolBatch(
              toolExecutorDeps,
              batch,
              signal,
              config.parallelToolCalls ?? false
            );
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

          // ── Token Budget: absolute check after tool-call path (covers
          // agents that continuously make tool calls without returning text).
          // Uses absolute threshold rather than diminishing-returns logic,
          // which is specific to the text-continuation flow. ──
          const totalTokens = state.tokens.prompt + state.tokens.completion;
          if (totalTokens >= tokenBudget) {
            state.output =
              state.messages
                .filter(m => m.role === 'assistant')
                .map(m => extractText(m.content))
                .join('\n') || state.output;
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
              reason: 'completed',
            });
            break;
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
              });
              const result = await ctx.compactionManager.compact({
                sessionId: ctx.sessionId,
                messages: state.messages,
                maxTokens: config.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
                currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
              });
              state.messages = result.messages;
              void emitter.emit({
                type: 'compaction.complete',
                timestamp: Date.now(),
                sessionId: ctx.sessionId,
                tokensAfter: result.tokensAfter,
                removedMessages: result.removedCount,
              });
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
        // Ensure unexpected errors have a code for programmatic handling
        if (!err.code) {
          err.code = ErrorCode.INTERNAL_ERROR;
        }
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
  // AsyncGenerator Iteration (delegated to event-iterator.ts)
  // ============================================================

  function iterate(input: string): AsyncGenerator<AgentEvent, RunResult, void> {
    return bridgeEmitterToGenerator(
      {
        emitter,
        sessionId: ctx.sessionId,
        isRunning: () => isRunning,
        cancelLoop,
      },
      run,
      input
    );
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
