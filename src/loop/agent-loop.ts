/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * AgentForge Agent Loop — Imperative Implementation
 *
 * Replaces the RxJS expand() recursion with an imperative while(true) loop.
 * All control flow (token budget, error recovery, tool partitioning, compaction)
 * is inline in a single closure — no event-type switch, no handler delegation.
 *
 * Design principles:
 * - while(true) + await (not expand + switch)
 * - HookRegistry for plugin cut-points (not event-stream interception)
 * - AgentEventEmitter for observability (not RxJS Observable)
 * - AbortController for cancellation (not takeUntil)
 * - Errors-as-events for error reporting (not RxJS error channel)
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 * @see docs/design/25-DE-RXJS.md
 */

import {
  type AgentEvent,
  type Message,
  type ToolCall,
  type SerializedError,
  AgentEventEmitter,
  serializeError,
  generateId,
} from '../core/index.js';
import type { AgentContext, AgentLoopState } from '../core/index.js';
import { HookRegistry } from '../core/hooks.js';
import { createInitialLoopState } from '../core/state.js';
import { checkTokenBudget, createBudgetTracker, shouldCompact } from './token-budget.js';
import { analyzeLLMError, RECOVERY_LIMITS } from './error-analyzer.js';
import { partitionToolCalls } from './tool-partition.js';

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
}

/**
 * Agent Loop instance returned by createAgentLoop()
 */
export interface AgentLoop {
  /** Run the agent loop with user input. Returns final output text. */
  run(input: string): Promise<string>;
  /** Subscribe to typed events */
  on<E extends AgentEvent>(type: E['type'], fn: (e: E) => void): () => void;
  /** Subscribe to all events */
  onAny(fn: (e: AgentEvent) => void): () => void;
  /** Cancel current execution */
  cancel(): void;
  /** Pause execution (blocks the loop) */
  pause(): void;
  /** Resume execution */
  resume(): void;
  /** Get current loop state (null if not started) */
  getState(): AgentLoopState | null;
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
  let state: AgentLoopState | null = null;
  let isRunning = false;

  // ── Pause/Resume ──
  let paused = false;
  let resumePromise: Promise<void> | null = null;
  let resumeResolve: (() => void) | null = null;

  // ── Streaming ──

  // ============================================================
  // Lifecycle Hook Runner (error-isolated)
  // ============================================================

  async function runLifecycleHook(name: string, input: unknown, output: unknown): Promise<void> {
    for (const h of hooks.getLifecycleHooks(name as any)) {
      try { await h(input, output); } catch { /* isolate */ }
    }
  }

  // ============================================================
  // Error Recovery
  // ============================================================

  async function handleLLMError(error: unknown, signal: AbortSignal): Promise<'continue' | 'throw'> {
    if (signal.aborted) return 'throw';

    const analysis = analyzeLLMError(error as Error, config.model.model, (error as any).status);

    if (analysis.recoverable && state) {
      switch (analysis.recovery) {
        case 'escalate_output_tokens':
          if (state.recovery.outputTokenEscalationCount < RECOVERY_LIMITS.outputTokenEscalation) {
            state.recovery.outputTokenEscalationCount++;
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
          if (config.fallbackModel && state.recovery.fallbackSwitchCount < RECOVERY_LIMITS.fallbackSwitch) {
            state.recovery.fallbackSwitchCount++;
            config.model = config.fallbackModel;
            await runLifecycleHook('recovery.fallback', { error: analysis.message }, { model: config.fallbackModel });
            return 'continue';
          }
          break;

        case 'trigger_compaction':
          if (ctx.compactionManager && state.recovery.compactionRetryCount < RECOVERY_LIMITS.compactionRetry) {
            state.recovery.compactionRetryCount++;
            if (state) {
              await runLifecycleHook('compaction.before', {
                sessionId: ctx.sessionId,
                messages: state.messages,
                tokenCount: state.tokens.prompt + state.tokens.completion,
              }, {});
              const result = await ctx.compactionManager.compact({
                sessionId: ctx.sessionId,
                messages: state.messages,
                maxTokens: 8000,
                currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
              });
              state.messages = result.messages as Message[];
              await runLifecycleHook('compaction.after', {
                sessionId: ctx.sessionId,
                messages: state.messages,
              }, {});
            }
            return 'continue';
          }
          break;
      }
    }

    return 'throw';
  }

  // ============================================================
  // Tool Execution
  // ============================================================

  async function executeToolBatch(
    batch: { calls: ToolCall[]; isConcurrencySafe: boolean },
    signal: AbortSignal
  ): Promise<Message[]> {
    const results: Message[] = [];

    for (const tc of batch.calls) {
      if (signal.aborted) break;

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
        results.push(deniedMsg);
        void emitter.emit({
          type: 'tool.result',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          toolCallId: tc.id,
          toolName: tc.name,
          result: deniedMsg.content,
          isError: true,
        });
        continue;
      }

      // ── Execute tool ──
      await runLifecycleHook('tool.execute.before', {
        sessionId: ctx.sessionId,
        toolName: tc.name,
        callId: tc.id,
        args: tc.args,
      }, {});

      void emitter.emit({
        type: 'tool.execute',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        toolCallId: tc.id,
        toolName: tc.name,
      });

      // ── MPU M5: Audit tool execution ──
      ctx.auditLogger?.append({
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        eventType: 'tool.execute',
        action: 'tool.execute',
        resource: tc.name,
        result: 'success',
        details: { toolCallId: tc.id },
      });

      try {
        const result = await ctx.tools.execute(tc.name, tc.args, { toolCallId: tc.id, parentSessionId: ctx.sessionId });

        await runLifecycleHook('tool.execute.after', {
          sessionId: ctx.sessionId,
          toolName: tc.name,
          callId: tc.id,
          args: tc.args,
        }, { result });

        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        results.push({
          role: 'tool',
          content: resultStr,
          toolCallId: tc.id,
          name: tc.name,
        });

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
              ctx.logger?.warn(`Tool result validation failed for ${tc.name}:`, { errors: validation.errors });
            }
          } catch { /* isolate */ }
        }
      } catch (err) {
        const errStr = err instanceof Error ? err.message : String(err);

        await runLifecycleHook('tool.execute.error', {
          sessionId: ctx.sessionId,
          toolName: tc.name,
          callId: tc.id,
          error: err,
        }, { retry: false });

        results.push({
          role: 'tool',
          content: `Error: ${errStr}`,
          toolCallId: tc.id,
          name: tc.name,
        });

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
          } catch { /* isolate */ }
        }
      }
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
      ctx.abortSignal.addEventListener('abort', () => abortController?.abort(), { once: true });
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
    messages.push({ role: 'user', content: input });

    state = createInitialLoopState({
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      model: config.model,
      messages,
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

    await runLifecycleHook('session.start', {
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      input,
      model: config.model,
    }, {});

    // ====================================================================
    // MAIN LOOP
    // ====================================================================
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
          await runLifecycleHook('session.end', {
            sessionId: ctx.sessionId,
            reason: 'max_steps',
            steps: state.step,
            tokens: state.tokens,
          }, {});
          return state.output;
        }

        // ── Lifecycle: step.begin ──
        await runLifecycleHook('step.begin', {
          sessionId: ctx.sessionId,
          step: state.step,
          maxSteps,
          messageCount: state.messages.length,
        }, {});

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

        await runLifecycleHook('llm.request.before', {
          sessionId: ctx.sessionId,
          messages: msgs,
          model: config.model,
        }, {});

        // ── MPU M7: Quota check ──
        if (ctx.quota) {
          const usage = ctx.quota.getUsage(ctx.sessionId);
          const limits = ctx.quota.getLimits();
          const ok = (usage as any).usedTokens < (limits as any).maxTokensPerSession;
          if (!ok) {
            const err: SerializedError = { name: 'QuotaExceededError', message: 'Token/cost quota exceeded' };
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
            return state.output;
          }
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
          response = await ctx.llm.chat(msgs, { signal, tools: toolDefs } as any);
          state.tokens.prompt += response.usage?.promptTokens ?? 0;
          state.tokens.completion += response.usage?.completionTokens ?? 0;
        } catch (error) {
          await runLifecycleHook('llm.error', { error, messages: msgs }, {});
          const recovery = await handleLLMError(error, signal);
          if (recovery === 'continue') {
            state.step++;
            continue;
          }
          throw error;
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

        await runLifecycleHook('llm.response.after', {
          sessionId: ctx.sessionId,
          step: state.step,
          response,
          usage: response.usage,
        }, {});

        // ── Quality Gate: validate LLM output before acting on it ──
        if (ctx.qualityGate && response.content) {
          const gateResult = ctx.qualityGate.check(response.content, state);
          if (!gateResult.passed) {
            // Inject correction message so LLM retries with guidance
            state.messages.push({
              role: 'user',
              content:
                `[System] ${gateResult.feedback ?? 'Your last response had quality issues. Please try again with a different approach.'}`,
            });
            state.step++;
            continue;
          }
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
          ctx.checkpoint?.save({
            checkpointId: cpId,
            sessionId: ctx.sessionId,
            position: 'after_llm',
            state: state as any,
            timestamp: Date.now(),
          } as any).catch(() => {});
        }
        if (ctx.services.costTracker && response.usage) {
          ctx.services.costTracker.record(ctx.sessionId, config.model.model, response.usage).catch(() => {});
        }

        // ── 3. Completion check + Token Budget ──
        if (response.finishReason === 'stop' || !response.toolCalls?.length) {
          const decision = checkTokenBudget(budgetTracker, tokenBudget, state.tokens);
          if (decision === 'continue') {
            // Nudge the LLM to continue with more output
            state.messages = [
              ...state.messages,
              { role: 'assistant', content: response.content },
              { role: 'user', content: 'Continue from where you left off. Do not repeat or summarize.' },
            ];
            state.step++;
            continue;
          }
          state.output = response.content;
          await runLifecycleHook('session.end', {
            sessionId: ctx.sessionId,
            reason: 'completed',
            steps: state.step,
            tokens: state.tokens,
          }, {});
          void emitter.emit({
            type: 'agent.complete',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            output: response.content,
            steps: state.step,
            tokens: { input: state.tokens.prompt, output: state.tokens.completion },
          });
          void emitter.emit({
            type: 'done',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            reason: 'stop',
          });
          return response.content;
        }

        // ── 4. Tool Execution ──
        // Add assistant response to messages
        state.messages = [
          ...state.messages,
          ...msgs.slice(state.messages.length), // RequestHook-injected messages
          { role: 'assistant', content: response.content ?? '' } as Message,
        ];

        const toolCalls = response.toolCalls;
        const batches = partitionToolCalls(toolCalls, ctx.tools as unknown as { isConcurrencySafe?: (name: string) => boolean } | null);
        const toolResults: Message[] = [];

        for (const batch of batches) {
          if (signal.aborted) break;

          const results = await executeToolBatch(batch, signal);
          toolResults.push(...results);
        }

        // ── 5. Append tool results, increment step ──
        state.messages = [...state.messages, ...toolResults];
        state.step++;

        await runLifecycleHook('step.end', {
          sessionId: ctx.sessionId,
          step: state.step,
          toolCallsExecuted: toolCalls.length,
        }, {});

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
          ctx.checkpoint?.save({
            checkpointId: cpId2,
            sessionId: ctx.sessionId,
            position: 'after_tool',
            state: state as any,
            timestamp: Date.now(),
          } as any).catch(() => {});
        }

        // ── Compaction check ──
        if (shouldCompact(state.messages, state.tokens)) {
          await runLifecycleHook('compaction.before', {
            sessionId: ctx.sessionId,
            messages: state.messages,
            tokenCount: state.tokens.prompt + state.tokens.completion,
          }, {});
          if (ctx.compactionManager) {
            const result = await ctx.compactionManager.compact({
              sessionId: ctx.sessionId,
              messages: state.messages,
              maxTokens: 8000,
              currentTokenEstimate: state.tokens.prompt + state.tokens.completion,
            });
            state.messages = result.messages as Message[];
          }
          await runLifecycleHook('compaction.after', {
            sessionId: ctx.sessionId,
            messages: state.messages,
          }, {});
        }
      }
    } catch (error) {
      // ── Errors-as-events ──
      const err: SerializedError = serializeError(error);
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
        } catch { /* isolate */ }
      }

      // ── Notify error handler ──
      const errorObj = error instanceof Error ? error : new Error(String(error));
      ctx.onError?.(errorObj, errEvent, 'unknown');
      ctx.logger?.error('Agent loop unexpected error', errorObj);

      throw error;
    } finally {
      isRunning = false;
      abortController = null;
    }

    return state?.output ?? '';
  }

  // ============================================================
  // Return
  // ============================================================

  return {
    run,
    on: emitter.on.bind(emitter),
    onAny: emitter.onAny.bind(emitter),
    cancel: (): void => {
      abortController?.abort();
      isRunning = false;
    },
    pause: (): void => {
      paused = true;
      resumePromise = new Promise<void>((r) => { resumeResolve = r; });
    },
    resume: (): void => {
      paused = false;
      resumeResolve?.();
      resumeResolve = null;
      resumePromise = null;
    },
    getState: (): AgentLoopState | null => state,
    destroy: (): void => {
      abortController?.abort();
      emitter.clear();
      hooks.clear();
      isRunning = false;
      state = null;
    },
  };
}
