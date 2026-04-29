/**
 * Handlers: LLM Request, Response, Output Invalid + callLLM, callLLMStreaming
 * @module
 */

import { Observable, of, from, EMPTY, concat } from 'rxjs';
import { mergeMap, catchError } from 'rxjs/operators';
import {
  type AgentEvent,
  type AgentState,
  type ToolCall,
  type Message,
  type Checkpoint,
  type CheckpointPosition,
  type LLMOptions,
  serializeError,
  generateId,
  createCheckpoint,
} from '../../core/index.js';
import type { QuotaUsage } from '../../quota/quota-controller.js';
import type { CompactionContext } from '../../memory/index.js';
import type { HandlerDeps, StepContext } from '../agent-loop.js';
import type { PromptBuilder, ToolDefinition } from '../../core/interfaces.js';
import { z } from 'zod';
import { executeBatchTools } from './tool-execution.js';

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Build messages for LLM invocation.
 *
 * When a PromptBuilder is available in the context, uses it to construct
 * the full prompt payload (system message from template + tool instructions +
 * history + token budget estimation). Otherwise, passes state.messages
 * through as-is (backward compatible).
 *
 * @param messages - Current message history from agent state
 * @param promptBuilder - Optional PromptBuilder from AgentContext
 * @param systemPrompt - Optional system prompt template
 * @param toolDefs - Available tool definitions (with Zod schemas)
 * @returns Message array to send to the LLM
 */
function buildMessages(
  messages: Message[],
  promptBuilder: PromptBuilder | undefined,
  systemPrompt: string | undefined,
  toolDefs: ToolDefinition<z.ZodTypeAny>[]
): Message[] {
  if (!promptBuilder) {
    // No PromptBuilder — pass messages through as-is (backward compatible)
    return messages;
  }

  // Use PromptBuilder to construct the full prompt payload.
  // history = state.messages (complete history, enabling token budget truncation)
  // input = '' (input is already the last message in state.messages)
  const buildOptions: import('../../core/interfaces.js').PromptBuildOptions = {};
  if (systemPrompt !== undefined) {
    buildOptions.systemTemplate = systemPrompt;
  }
  const result = promptBuilder.build(
    messages,
    '', // input is already in state.messages
    toolDefs,
    buildOptions
  );
  return result.messages;
}

/**
 * 粗略估算消息 token 数。
 * 规则：英文约 4 字符 = 1 token，中文约 1.5 字符 = 1 token。
 * 取 3 字符 = 1 token 作为通用估算。
 * 生产环境可用 tiktoken 精确计算，此处仅做前置估算。
 */
export function estimateTokenCount(messages: Message[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    }
    // ToolMessage 的 content 可能是 string | ToolResultContent[]
    // 简化：只计算 string 部分
  }
  return Math.ceil(totalChars / 3);
}

/**
 * 判断是否需要压缩上下文。
 * 触发条件：消息数量 > 50 或估算 token > maxSteps * 4000。
 */
export function shouldCompact(state: AgentState): boolean {
  const messageCount = state.messages.length;
  const estimatedTokens = estimateTokenCount(state.messages);
  const threshold = (state.maxSteps ?? 10) * 4000;
  return messageCount > 50 || estimatedTokens > threshold;
}

/**
 * Emit a checkpoint event and save to storage (fire-and-forget).
 *
 * Does NOT block the event flow. The save is async and errors are
 * logged but never crash the loop. Returns an Observable that
 * emits a single StepContext with the checkpoint event.
 */
export function emitCheckpoint(
  deps: HandlerDeps,
  position: CheckpointPosition,
  state: AgentState
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;

  // Only emit if checkpoint is enabled and storage is configured
  if (!config.checkpoint?.enabled || !ctx.checkpoint) {
    return EMPTY;
  }

  // 🔴 P0 修复：try/catch 包裹 createCheckpoint（Zod parse 可抛出）
  let cp: Checkpoint;
  try {
    cp = createCheckpoint({
      id: `cp-${generateId()}`,
      sessionId,
      position,
      state,
    });
  } catch (err) {
    // Zod validation failed - emit agent.error event instead of crashing
    const errorEvent: AgentEvent = {
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId,
      error: {
        name: 'CheckpointCreationError',
        message: err instanceof Error ? err.message : 'Failed to create checkpoint',
      },
    };
    // Don't crash the loop - just log and continue
    ctx.logger?.error(
      'Checkpoint creation failed',
      err instanceof Error ? err : new Error(String(err))
    );
    return of({ event: errorEvent, state } as StepContext);
  }

  // Fire-and-forget save — don't block the event flow
  ctx.checkpoint.save(cp).catch(err => {
    ctx.logger?.error(
      'Checkpoint save failed',
      err instanceof Error ? err : new Error(String(err))
    );
  });

  const checkpointEvent: AgentEvent = {
    type: 'checkpoint',
    timestamp: Date.now(),
    sessionId,
    checkpointId: cp.id,
    position,
    state,
  };

  return of({ event: checkpointEvent, state } as StepContext);
}

// ============================================================
// Handler: llm.request → Call LLM
// ============================================================

export function handleLLMRequest(deps: HandlerDeps, state: AgentState): Observable<StepContext> {
  const { ctx, sessionId } = deps;

  // MPU M4: Circuit breaker — block LLM call if circuit is open
  if (ctx.circuitBreaker?.shouldTrip()) {
    const errorEvent: AgentEvent = {
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId,
      error: {
        name: 'CircuitBreakerOpenError',
        message: 'Circuit breaker is open — LLM calls blocked due to repeated failures',
      },
    };
    const doneEv: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId,
      reason: 'error',
    };
    return from([
      { event: errorEvent, state },
      { event: doneEv, state },
    ] as StepContext[]);
  }

  // MPU M6: Rate limiter — block LLM call if rate limit exceeded
  if (ctx.rateLimiter) {
    const key = `llm:${sessionId}`;
    if (!ctx.rateLimiter.check(key, { maxRequests: 100, windowMs: 60000 })) {
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: {
          name: 'RateLimitExceededError',
          message: 'LLM rate limit exceeded',
        },
      };
      const doneEv: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'error',
      };
      return from([
        { event: errorEvent, state },
        { event: doneEv, state },
      ] as StepContext[]);
    }
    ctx.rateLimiter.consume(key, { maxRequests: 100, windowMs: 60000 });
  }

  // MPU M7: Cost pre-check before LLM call
  if (ctx.services.costTracker) {
    return from(ctx.services.costTracker.checkLimit(sessionId)).pipe(
      mergeMap(limitCheck => {
        if (!limitCheck.withinLimit) {
          const errorEvent: AgentEvent = {
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId,
            error: {
              name: 'CostLimitExceededError',
              message: `Cost limit exceeded: ${limitCheck.exceeded?.join(', ')}`,
            },
            step: state.step,
          };
          const doneEv: AgentEvent = {
            type: 'done',
            timestamp: Date.now(),
            sessionId,
            reason: 'error',
          };
          return from([
            { event: errorEvent, state },
            { event: doneEv, state },
          ] as StepContext[]);
        }
        return doLLMRequest(deps, state);
      }),
      catchError(() => {
        // Cost check failure must never crash the loop
        deps.ctx.logger?.warn('Cost check failed, allowing request');
        return doLLMRequest(deps, state);
      })
    );
  }
  return doLLMRequest(deps, state);
}

function doLLMRequest(deps: HandlerDeps, state: AgentState): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;

  // MPU M6: Input sanitizer — detect injection patterns
  if (ctx.inputSanitizer) {
    const lastMessage = state.messages[state.messages.length - 1];
    const inputText = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
    const detection = ctx.inputSanitizer.detectInjection(inputText);
    if (detection.isMalicious && detection.confidence >= 0.8) {
      // High confidence: block the LLM call
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: {
          name: 'InjectionDetectedError',
          message: `Potential prompt injection detected: ${detection.patterns.join(', ')}`,
        },
      };
      const doneEv: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'error',
      };
      return from([
        { event: errorEvent, state },
        { event: doneEv, state },
      ] as StepContext[]);
    }
    if (detection.isMalicious) {
      // Low confidence: log but don't block (observability event)
      ctx.auditLogger?.append({
        sessionId,
        agentName: state.agentName,
        eventType: 'injection.detected',
        action: 'llm.request',
        resource: 'user_input',
        result: 'success',
        details: { confidence: detection.confidence, patterns: detection.patterns },
      });
    }
  }

  // Compaction auto-trigger: compress messages before LLM call
  if (ctx.compactionManager && shouldCompact(state)) {
    const compactionCtx: CompactionContext = {
      sessionId,
      messages: state.messages,
      maxTokens: state.contextManagement?.totalTokens ?? 8000,
      currentTokenEstimate: estimateTokenCount(state.messages),
    };
    return from(ctx.compactionManager.compact(compactionCtx)).pipe(
      mergeMap(result => {
        const compactedState: AgentState = {
          ...state,
          messages: result.messages as Message[],
          contextManagement: {
            ...state.contextManagement,
            totalTokens: result.tokensAfter,
            compactionCount: (state.contextManagement?.compactionCount ?? 0) + 1,
            lastCompactionAt: Date.now(),
          },
        };
        return config.streaming
          ? callLLMStreaming(deps, compactedState)
          : callLLM(deps, compactedState);
      })
    );
  }

  return config.streaming ? callLLMStreaming(deps, state) : callLLM(deps, state);
}

// ============================================================
// Handler: llm.response → Complete or Execute Tools
// ============================================================

export function handleLLMResponse(
  deps: HandlerDeps,
  state: AgentState,
  event: Extract<AgentEvent, { type: 'llm.response' }>,
  _repairAttempt?: number
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;
  const { content, toolCalls, finishReason } = event;

  // Record token consumption (fire-and-forget)
  if (ctx.quota && event.usage) {
    ctx.quota.consume(sessionId, {
      promptTokens: event.usage.promptTokens,
      completionTokens: event.usage.completionTokens,
    });
  }

  // Emit checkpoint after LLM response (before tool execution or completion)
  // Only when interval is 'llm_response' or 'step' (both fire at this position)
  const checkpoint$ = emitCheckpoint(deps, 'after_llm', state);

  // No tool calls - complete
  if (finishReason === 'stop' || !toolCalls?.length) {
    const completeEvent: AgentEvent = {
      type: 'agent.complete',
      timestamp: Date.now(),
      sessionId,
      output: content,
      steps: state.step,
    };

    const doneEvent: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId,
      reason: 'stop',
    };

    const mainFlow$ = from([
      { event: completeEvent, state },
      { event: doneEvent, state },
    ] as StepContext[]);

    return concat(checkpoint$, mainFlow$);
  }

  // Validate tool existence
  const invalidTools = toolCalls.filter(tc => !ctx.tools.has(tc.name));
  if (invalidTools.length > 0) {
    const invalidEvent: AgentEvent = {
      type: 'llm.output.invalid',
      timestamp: Date.now(),
      sessionId,
      reason: `Unknown tool(s): ${invalidTools.map(t => t.name).join(', ')}`,
      originalResponse: event,
      attempt: (_repairAttempt ?? 0) + 1,
    };

    // Emit invalid event - will be picked up by handleLLMOutputInvalid
    const mainFlow$ = of({
      event: invalidEvent,
      state,
      repairAttempt: (_repairAttempt ?? 0) + 1,
    } as StepContext);

    return concat(checkpoint$, mainFlow$);
  }

  // Single tool or non-parallel mode — emit tool.call, handler will execute
  if (toolCalls.length === 1 || !config.parallelToolCalls) {
    const firstCall = toolCalls[0]!;

    const callEvent: AgentEvent = {
      type: 'tool.call',
      timestamp: Date.now(),
      sessionId,
      toolCallId: firstCall.id,
      toolName: firstCall.name,
      args: firstCall.args,
    };

    const mainFlow$ = of({ event: callEvent, state } as StepContext);

    return concat(checkpoint$, mainFlow$);
  }

  // Parallel tool execution
  const mainFlow$ = executeBatchTools(deps, toolCalls, state);

  return concat(checkpoint$, mainFlow$);
}

// ============================================================
// Handler: llm.output.invalid → Retry or Error
// ============================================================

/**
 * LLM output invalidation handler with repair loop.
 *
 * When LLM output fails validation (e.g., calls unknown tool),
 * retry the LLM call with a repair prompt up to maxLLMRepairAttempts.
 * If max attempts reached, emit agent.error and terminate.
 */
export function handleLLMOutputInvalid(
  deps: HandlerDeps,
  state: AgentState,
  event: Extract<AgentEvent, { type: 'llm.output.invalid' }>,
  repairAttempt: number
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;

  // Check if we've exhausted repair attempts
  if (repairAttempt >= config.maxLLMRepairAttempts) {
    const errorEvent: AgentEvent = {
      type: 'agent.error',
      timestamp: Date.now(),
      sessionId,
      error: {
        name: 'LLMOutputInvalid',
        message: `LLM output invalid after ${repairAttempt} repair attempt(s): ${event.reason}`,
      },
      step: state.step,
    };

    const doneEvent: AgentEvent = {
      type: 'done',
      timestamp: Date.now(),
      sessionId,
      reason: 'error',
    };

    return from([
      { event: errorEvent, state },
      { event: doneEvent, state },
    ] as StepContext[]);
  }

  // Retry LLM with repair prompt appended
  const repairMessage: Message = {
    role: 'user',
    content: `Your previous response was invalid: ${event.reason}. Please correct and try again. Only use tools that are available: ${ctx.tools.list().join(', ')}`,
  };

  const repairedMessages = [...state.messages, repairMessage];
  const newState = { ...state, messages: repairedMessages };

  if (config.streaming) {
    return callLLMStreaming(deps, newState, repairAttempt);
  }
  return callLLM(deps, newState, repairAttempt);
}

// ============================================================
// LLM Call
// ============================================================

export function callLLM(
  deps: HandlerDeps,
  state: AgentState,
  repairAttempt: number = 0
): Observable<StepContext> {
  const { ctx, sessionId } = deps;

  // Quota pre-check
  if (ctx.quota) {
    const projected: QuotaUsage = {
      promptTokens: estimateTokenCount(state.messages),
      completionTokens: 0,
    };
    return from(ctx.quota.check(sessionId, projected)).pipe(
      mergeMap(allowed => {
        if (!allowed) {
          const errorEvent: AgentEvent = {
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId,
            error: {
              name: 'QuotaExceededError',
              message: 'Token quota exceeded. Increase limits or check usage.',
            },
            step: state.step,
          };
          const doneEv: AgentEvent = {
            type: 'done',
            timestamp: Date.now(),
            sessionId,
            reason: 'error',
          };
          return from([
            { event: errorEvent, state },
            { event: doneEv, state },
          ] as StepContext[]);
        }
        return callLLMInner(deps, state, repairAttempt);
      }),
      catchError(() => {
        deps.ctx.logger?.warn('Quota check failed, allowing request');
        return callLLMInner(deps, state, repairAttempt);
      })
    );
  }
  return callLLMInner(deps, state, repairAttempt);
}

function callLLMInner(
  deps: HandlerDeps,
  state: AgentState,
  repairAttempt: number = 0
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;

  // Build messages: use PromptBuilder if available, otherwise pass through as-is
  const toolDefs = ctx.tools
    .list()
    .map(name => ctx.tools.get(name)!)
    .filter((t): t is ToolDefinition<z.ZodTypeAny> => t !== undefined);
  const messages = buildMessages(state.messages, ctx.promptBuilder, config.systemPrompt, toolDefs);

  const llmOptions: LLMOptions = {
    tools: ctx.tools.getFunctionDefs(),
  };

  return from(ctx.llm.chat(messages, llmOptions)).pipe(
    mergeMap(response => {
      const responseEvent: AgentEvent = {
        type: 'llm.response',
        timestamp: Date.now(),
        sessionId,
        content: response.content,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason,
        usage: response.usage,
        // P1: Capture reasoning if provided by LLM adapter
        reasoning: response.reasoning,
      };
      return of({ event: responseEvent, state, repairAttempt } as StepContext);
    }),
    catchError(error => {
      // Notify error handler
      const err = error instanceof Error ? error : new Error(String(error));
      const llmErrorEvent: AgentEvent = {
        type: 'llm.request',
        timestamp: Date.now(),
        sessionId,
        messages: state.messages,
        model: config.model,
        tools: ctx.tools.list(),
      };
      ctx.onError?.(err, llmErrorEvent, 'llm_server_error');
      // MPU M4: Error classification (fire-and-forget)
      if (ctx.errorClassifier && ctx.circuitBreaker) {
        try {
          const severity = ctx.errorClassifier.classify(serializeError(error));
          ctx.circuitBreaker.recordFailure(severity);
        } catch {
          // Error classifier must never crash the loop
        }
      }
      const errorEvent: AgentEvent = {
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId,
        error: serializeError(error),
        step: state.step,
      };
      const doneEv: AgentEvent = {
        type: 'done',
        timestamp: Date.now(),
        sessionId,
        reason: 'error',
      };
      return from([
        { event: errorEvent, state },
        { event: doneEv, state },
      ] as StepContext[]);
    })
  );
}

// ============================================================
// Streaming LLM Call
// ============================================================

/**
 * Streaming LLM call - emits llm.stream.* events then llm.response
 *
 * Event sequence:
 * - llm.stream.start
 * - llm.stream.text (multiple)
 * - llm.stream.tool_call (multiple, for tool calls)
 * - llm.stream.end
 * - llm.response (with accumulated content)
 *
 * Implementation uses a manual Observable to properly sequence events:
 * - mergeMap(() => ...) discards source values, so we can't use it for start event
 * - finalize() doesn't emit values, so we parse tool calls in complete handler
 */
export function callLLMStreaming(
  deps: HandlerDeps,
  state: AgentState,
  repairAttempt: number = 0
): Observable<StepContext> {
  const { ctx, sessionId } = deps;

  // Quota pre-check
  if (ctx.quota) {
    const projected: QuotaUsage = {
      promptTokens: estimateTokenCount(state.messages),
      completionTokens: 0,
    };
    return from(ctx.quota.check(sessionId, projected)).pipe(
      mergeMap(allowed => {
        if (!allowed) {
          const errorEvent: AgentEvent = {
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId,
            error: {
              name: 'QuotaExceededError',
              message: 'Token quota exceeded. Increase limits or check usage.',
            },
            step: state.step,
          };
          const doneEv: AgentEvent = {
            type: 'done',
            timestamp: Date.now(),
            sessionId,
            reason: 'error',
          };
          return from([
            { event: errorEvent, state },
            { event: doneEv, state },
          ] as StepContext[]);
        }
        return callLLMStreamingInner(deps, state, repairAttempt);
      }),
      catchError(() => {
        deps.ctx.logger?.warn('Quota check failed, allowing request');
        return callLLMStreamingInner(deps, state, repairAttempt);
      })
    );
  }
  return callLLMStreamingInner(deps, state, repairAttempt);
}

function callLLMStreamingInner(
  deps: HandlerDeps,
  state: AgentState,
  repairAttempt: number = 0
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps;

  // Build messages: use PromptBuilder if available, otherwise pass through as-is
  const toolDefs = ctx.tools
    .list()
    .map(name => ctx.tools.get(name)!)
    .filter((t): t is ToolDefinition<z.ZodTypeAny> => t !== undefined);
  const messages = buildMessages(state.messages, ctx.promptBuilder, config.systemPrompt, toolDefs);

  return new Observable<StepContext>(subscriber => {
    // Emit stream start first
    const streamStartEvent: AgentEvent = {
      type: 'llm.stream.start',
      timestamp: Date.now(),
      sessionId,
    };
    subscriber.next({ event: streamStartEvent, state });

    // Accumulators for content and tool calls
    let accumulatedContent = '';
    const accumulatedToolCalls: ToolCall[] = [];
    const toolCallBuffers: Map<string, { name: string; argsDelta: string }> = new Map();

    // Subscribe to the LLM stream
    // Build LLM options with tools
    const llmOptions: LLMOptions = {
      tools: ctx.tools.getFunctionDefs(),
    };

    const subscription = ctx.llm.stream(messages, llmOptions).subscribe({
      next(chunk) {
        // Handle text chunks
        if (chunk.text) {
          accumulatedContent += chunk.text;
          subscriber.next({
            event: {
              type: 'llm.stream.text',
              timestamp: Date.now(),
              sessionId,
              delta: chunk.text,
            },
            state,
          });
        }

        // Handle tool call chunks
        if (chunk.toolCallId && chunk.toolName) {
          // New or continued tool call
          if (!toolCallBuffers.has(chunk.toolCallId)) {
            toolCallBuffers.set(chunk.toolCallId, {
              name: chunk.toolName,
              argsDelta: chunk.argsDelta ?? '',
            });
          } else {
            const existing = toolCallBuffers.get(chunk.toolCallId)!;
            existing.argsDelta += chunk.argsDelta ?? '';
          }

          subscriber.next({
            event: {
              type: 'llm.stream.tool_call',
              timestamp: Date.now(),
              sessionId,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              argsDelta: chunk.argsDelta ?? '',
            },
            state,
          });
        }
      },
      error(error) {
        // Notify error handler
        const err = error instanceof Error ? error : new Error(String(error));
        const streamErrorEvent: AgentEvent = {
          type: 'llm.request',
          timestamp: Date.now(),
          sessionId,
          messages: state.messages,
          model: config.model,
          tools: ctx.tools.list(),
        };
        ctx.onError?.(err, streamErrorEvent, 'llm_server_error');
        // MPU M4: Error classification (fire-and-forget)
        if (ctx.errorClassifier && ctx.circuitBreaker) {
          try {
            const severity = ctx.errorClassifier.classify(serializeError(error));
            ctx.circuitBreaker.recordFailure(severity);
          } catch {
            // Error classifier must never crash the loop
          }
        }
        // Errors-as-events: convert to agent.error + done
        const errorEvent: AgentEvent = {
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId,
          error: serializeError(error),
          step: state.step,
        };
        const doneEvent: AgentEvent = {
          type: 'done',
          timestamp: Date.now(),
          sessionId,
          reason: 'error',
        };
        subscriber.next({ event: errorEvent, state });
        subscriber.next({ event: doneEvent, state });
        subscriber.complete();
      },
      complete() {
        // Parse accumulated tool calls from buffers
        for (const [id, buffer] of toolCallBuffers) {
          try {
            const args: unknown = JSON.parse(buffer.argsDelta);
            if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
              accumulatedToolCalls.push({
                id,
                name: buffer.name,
                args: args as Record<string, unknown>,
              });
            }
          } catch {
            // Invalid JSON - skip this tool call
          }
        }

        // Emit stream end
        const streamEndEvent: AgentEvent = {
          type: 'llm.stream.end',
          timestamp: Date.now(),
          sessionId,
        };
        subscriber.next({ event: streamEndEvent, state });

        // Emit final response
        const finishReason = accumulatedToolCalls.length > 0 ? 'tool_calls' : 'stop';
        const responseEvent: AgentEvent = {
          type: 'llm.response',
          timestamp: Date.now(),
          sessionId,
          content: accumulatedContent,
          toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          finishReason,
          // Note: Streaming doesn't provide reasoning capture
          // Reasoning is only available in non-streaming mode
        };
        subscriber.next({ event: responseEvent, state, repairAttempt });
        subscriber.complete();
      },
    });

    // Return cleanup function
    return () => {
      subscription.unsubscribe();
    };
  });
}
