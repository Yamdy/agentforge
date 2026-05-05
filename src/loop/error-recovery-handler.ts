/**
 * LLM Error Recovery Handler — extracted from agent-loop.ts
 *
 * Implements 4-tier error recovery escalation:
 * 1. escalate_output_tokens — bump maxTokens for v1 models
 * 2. inject_recovery_message — nudge LLM to resume
 * 3. switch_fallback_model — swap to fallback model
 * 4. trigger_compaction — aggressive compaction to free context
 *
 * Dependencies are passed via a deps record rather than closure capture,
 * so the recovery logic is testable independently of the agent loop.
 */

import type { Message, AgentEvent } from '../core/index.js';
import type { AgentContext, AgentState } from '../core/index.js';
import type { AgentEventEmitter } from '../core/events.js';
import type { HookName } from '../core/hooks.js';
import type { AgentLoopConfig } from './agent-loop.js';
import { analyzeLLMError, RECOVERY_LIMITS, ESCALATED_MAX_OUTPUT_TOKENS } from './error-analyzer.js';

// ============================================================
// Types
// ============================================================

export interface ErrorRecoveryDeps {
  ctx: AgentContext;
  config: AgentLoopConfig;
  state: AgentState | null;
  recoveryState: { escalatedMaxTokens: number | undefined };
  emitter: AgentEventEmitter;
  runLifecycleHook: (name: HookName, input: unknown, output: unknown) => Promise<void>;
}

// ============================================================
// Handler
// ============================================================

export async function handleLLMError(
  error: unknown,
  signal: AbortSignal,
  deps: ErrorRecoveryDeps
): Promise<'continue' | 'fatal'> {
  if (signal.aborted) return 'fatal';

  const { ctx, config, state, recoveryState, emitter, runLifecycleHook } = deps;

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
          const currentTokens = state.tokens.prompt + state.tokens.completion;
          await runLifecycleHook(
            'compaction.before',
            {
              sessionId: ctx.sessionId,
              messages: state.messages,
              tokenCount: currentTokens,
            },
            {}
          );
          // Use reactive (multi-layer) compaction for error recovery
          const reactiveCtx = {
            sessionId: ctx.sessionId,
            messages: state.messages,
            maxTokens: config.tokenBudget ?? 200_000,
            currentTokenEstimate: currentTokens,
          };
          const result =
            ctx.compactionManager.reactiveCompact(reactiveCtx) ??
            ctx.compactionManager.multiLayerCompact(reactiveCtx);
          state.messages = result.messages as Message[];
          void emitter.emit({
            type: 'compaction.start',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            strategy: result.strategy,
            tokensBefore: currentTokens,
          } as AgentEvent);
          void emitter.emit({
            type: 'compaction.complete',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            tokensAfter: result.tokensAfter,
            removedMessages: result.removedCount,
          } as AgentEvent);
          await runLifecycleHook(
            'compaction.after',
            { sessionId: ctx.sessionId, messages: state.messages },
            {}
          );
          return 'continue';
        }
        break;
    }
  }

  return 'fatal';
}
