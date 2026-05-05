/**
 * LLM Caller — extracted from agent-loop.ts
 *
 * Wraps a single LLM chat call with audit logging, event emission,
 * tool provider hooks, token tracking, quota consumption, and
 * error recovery. Returns a discriminated union so the caller
 * handles control-flow decisions without the callee reaching
 * into loop state.
 */

import type { AgentEvent, Message, ToolCall } from '../core/index.js';
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
  state: AgentState | null;
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

  // state is always non-null when called from run()
  const st = state!;

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
    toolDefs = await h.filter(toolDefs, st);
  }

  try {
    const llmOpts: LLMOptions = { signal, tools: toolDefs as LLMOptions['tools'] };
    if (recoveryState.escalatedMaxTokens) {
      llmOpts.maxTokens = recoveryState.escalatedMaxTokens;
    }
    const response = await ctx.core.llm.chat(msgs, llmOpts);
    st.tokens.prompt += response.usage?.promptTokens ?? 0;
    st.tokens.completion += response.usage?.completionTokens ?? 0;

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

// ============================================================
// Streaming LLM Call
// ============================================================

/**
 * Perform a streaming LLM call, accumulating chunks into a complete response.
 *
 * Uses `ctx.core.llm.stream()` to produce an AsyncGenerator<LLMChunk>.
 * Accumulates text deltas and tool call args as they arrive.
 * Emits `llm.chunk` events for each text delta so UIs can stream output.
 * Once the stream ends, returns the assembled LLMResponse with all tool calls.
 *
 * For true streaming tool execution (execute tools before LLM finishes),
 * the agent loop can consume the AsyncGenerator directly and execute tools
 * on toolCallEnd chunks. This function provides the simpler "stream accumulate"
 * path that still emits per-chunk text events.
 *
 * Returns the same LLMCallResult discriminated union as performLLMCall,
 * so the agent loop can handle streaming and non-streaming uniformly.
 */
export async function performStreamingLLMCall(
  msgs: Message[],
  signal: AbortSignal,
  deps: LLMCallDeps
): Promise<LLMCallResult> {
  const { ctx, config, hooks, emitter, state, recoveryState, errorRecoveryDeps, runLifecycleHook } =
    deps;
  const st = state!;

  // Audit LLM request
  ctx.security.auditLogger?.append({
    sessionId: ctx.identity.sessionId,
    agentName: ctx.identity.agentName,
    eventType: 'llm.request',
    action: 'llm.request',
    resource: config.model.model,
    result: 'success',
    details: { messages: msgs.length, model: config.model, streaming: true },
  });

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
    toolDefs = await h.filter(toolDefs, st);
  }

  try {
    const llmOpts: LLMOptions = { signal, tools: toolDefs as LLMOptions['tools'] };
    if (recoveryState.escalatedMaxTokens) {
      llmOpts.maxTokens = recoveryState.escalatedMaxTokens;
    }

    // Accumulate state from stream chunks
    let textContent = '';
    const toolCallMap = new Map<string, { name: string; argsStr: string }>();
    let finishReason: LLMResponse['finishReason'] = 'stop';
    let usage: LLMResponse['usage'] | undefined;

    const stream = ctx.core.llm.stream(msgs, llmOpts);

    for await (const chunk of stream) {
      if (signal.aborted) break;

      // Text delta
      if (chunk.text) {
        textContent += chunk.text;
        void emitter.emit({
          type: 'llm.chunk',
          timestamp: Date.now(),
          sessionId: ctx.identity.sessionId,
          text: chunk.text,
        } as AgentEvent);
      }

      // Tool call start — allocate accumulator
      if (chunk.toolCallStart && chunk.toolCallId && chunk.toolName) {
        toolCallMap.set(chunk.toolCallId, { name: chunk.toolName, argsStr: '' });
      }

      // Tool call args delta
      if (chunk.argsDelta && chunk.toolCallId) {
        const entry = toolCallMap.get(chunk.toolCallId);
        if (entry) {
          entry.argsStr += chunk.argsDelta;
        }
      }

      // Tool call complete: use full args from tool-call part if we
      // haven't already accumulated more detail through delta chunks
      if (chunk.toolCallEnd && chunk.toolCallId && chunk.argsDelta) {
        const existing = toolCallMap.get(chunk.toolCallId);
        if (existing) {
          // Only overwrite if we never got deltas (argsStr is still empty).
          // If deltas were already accumulated, keep them — they may be
          // more complete than the single-shot partial from tool-call.
          if (!existing.argsStr) {
            existing.argsStr = chunk.argsDelta;
          }
        } else if (chunk.toolName) {
          toolCallMap.set(chunk.toolCallId, { name: chunk.toolName, argsStr: chunk.argsDelta });
        }
      }

      // Finish reason / usage from terminal chunks
      if (chunk.finishReason) {
        finishReason = chunk.finishReason;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }

    // Assemble tool calls from accumulated stream data
    const toolCallsArr: ToolCall[] = [];
    for (const [id, entry] of toolCallMap) {
      let args: Record<string, unknown> = {};
      if (entry.argsStr) {
        try {
          args = JSON.parse(entry.argsStr) as Record<string, unknown>;
        } catch {
          args = { _raw: entry.argsStr };
        }
      }
      toolCallsArr.push({ id, name: entry.name, args });
    }

    // When tool calls are present, use 'tool_calls' as finish reason.
    // Preserve 'length' (truncation) so the loop can react to budget overflow.
    const effectiveFinishReason: LLMResponse['finishReason'] =
      toolCallsArr.length > 0
        ? finishReason === 'length'
          ? 'length'
          : 'tool_calls'
        : finishReason;

    const response: LLMResponse = {
      content: textContent,
      finishReason: effectiveFinishReason,
      ...(toolCallsArr.length > 0 ? { toolCalls: toolCallsArr } : {}),
      ...(usage !== undefined ? { usage } : {}),
    };

    st.tokens.prompt += response.usage?.promptTokens ?? 0;
    st.tokens.completion += response.usage?.completionTokens ?? 0;

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
