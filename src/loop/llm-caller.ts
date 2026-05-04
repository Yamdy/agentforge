/**
 * LLM Caller — extracted from agent-loop.ts
 *
 * Wraps a single LLM chat call with audit logging, event emission,
 * tool provider hooks, token tracking, quota consumption, and
 * error recovery. Returns a discriminated union so the caller
 * handles control-flow decisions without the callee reaching
 * into loop state.
 */

import type { AgentEvent, Message } from '../core/index.js';
import type { AgentContext, AgentState } from '../core/index.js';
import type { LLMOptions, LLMResponse } from '../core/interfaces.js';
import type { AgentEventEmitter } from '../core/events.js';
import type { HookName, HookRegistry } from '../core/hooks.js';
import type { AgentLoopConfig } from './agent-loop.js';
import { handleLLMError } from './error-recovery-handler.js';
import type { ErrorRecoveryDeps } from './error-recovery-handler.js';

// ============================================================
// Types
// ============================================================

export interface LLMCallDeps {
  ctx: AgentContext;
  config: AgentLoopConfig;
  hooks: HookRegistry;
  emitter: AgentEventEmitter;
  state: AgentState;
  recoveryState: { escalatedMaxTokens: number | undefined };
  errorRecoveryDeps: ErrorRecoveryDeps;
  runLifecycleHook: (name: HookName, input: unknown, output: unknown) => Promise<void>;
}

export type LLMCallResult =
  | { status: 'ok'; response: LLMResponse }
  | { status: 'recoverable' }
  | { status: 'fatal'; error: unknown };

// ============================================================
// Call
// ============================================================

export async function performLLMCall(
  msgs: Message[],
  signal: AbortSignal,
  deps: LLMCallDeps
): Promise<LLMCallResult> {
  const { ctx, config, hooks, emitter, state, recoveryState, errorRecoveryDeps, runLifecycleHook } =
    deps;

  // Audit LLM request
  ctx.security.auditLogger?.append({
    sessionId: ctx.identity.sessionId,
    agentName: ctx.identity.agentName,
    eventType: 'llm.request',
    action: 'llm.request',
    resource: config.model.model,
    result: 'success',
    details: { messages: msgs.length, model: config.model },
  });

  // Emit llm.request
  void emitter.emit({
    type: 'llm.request',
    timestamp: Date.now(),
    sessionId: ctx.identity.sessionId,
    messages: msgs,
    model: config.model,
  } as AgentEvent);

  // ToolProvider Hooks: per-call dynamic tool injection
  let toolDefs = ctx.core.tools?.getFunctionDefs() ?? [];
  for (const h of hooks.getToolProviderHooks()) {
    toolDefs = await h.filter(toolDefs, state);
  }

  try {
    const llmOpts: LLMOptions = { signal, tools: toolDefs as LLMOptions['tools'] };
    if (recoveryState.escalatedMaxTokens) {
      llmOpts.maxTokens = recoveryState.escalatedMaxTokens;
    }
    const response = await ctx.core.llm.chat(msgs, llmOpts);
    state.tokens.prompt += response.usage?.promptTokens ?? 0;
    state.tokens.completion += response.usage?.completionTokens ?? 0;

    // Quota consumption tracking
    if (ctx.controls.quota && response.usage) {
      ctx.controls.quota.consume(ctx.identity.sessionId, {
        promptTokens: response.usage.promptTokens ?? 0,
        completionTokens: response.usage.completionTokens ?? 0,
      });
    }

    return { status: 'ok', response };
  } catch (error) {
    await runLifecycleHook('llm.error', { error, messages: msgs }, {});
    const recovery = await handleLLMError(error, signal, errorRecoveryDeps);
    if (recovery === 'continue') {
      return { status: 'recoverable' };
    }
    return { status: 'fatal', error };
  }
}
