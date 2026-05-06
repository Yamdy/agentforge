/**
 * TracingPlugin — Core span lifecycle management via event subscriptions.
 *
 * The ONLY component that understands span hierarchy. It:
 * 1. Subscribes to events → manages OTel span lifecycle (start/end/attribute/event)
 * 2. Maintains `Map<sessionId, SpanStack>` for span parent-child tracking
 * 3. Exposes `TraceContext` API so other plugins can query span IDs
 *
 * Spans are internal to this plugin — span IDs never appear in event schemas.
 * Other plugins that need span correlation query through TraceContext.
 *
 * @module plugins/tracing-plugin
 */

import type { Plugin, PluginContext } from './plugin.js';
import type { AgentEvent, AgentEventType } from '../core/events.js';
import type { Tracer } from '../core/interfaces.js';
import type { TraceContext } from '../observability/trace-context.js';
import type { SensitiveDataFilter } from '../observability/sensitive-data-filter.js';
import {
  ATTR_AGENTFORGE_ERROR_CODE,
  ATTR_AGENTFORGE_TTFT_MS,
} from '../observability/tracers/otel-attributes.js';

// ============================================================
// Types
// ============================================================

export interface SamplerConfig {
  strategy: 'always_on' | 'always_off' | 'ratio';
  value?: number; // 0.0-1.0 for ratio strategy
}

export interface TracingPluginOptions {
  /** Sampling configuration (default: always_on) */
  sampler?: SamplerConfig;
  /** Event types to exclude from span creation */
  excludeEventTypes?: AgentEventType[];
  /** Sensitive data filter applied to span attributes */
  sensitiveDataFilter?: SensitiveDataFilter;
}

type SpanStack = string[];

// ============================================================
// Implementation
// ============================================================

export function createTracingPlugin(options: TracingPluginOptions = {}): Plugin & TraceContext {
  const { sampler = { strategy: 'always_on' }, excludeEventTypes, sensitiveDataFilter } = options;

  let tracer: Tracer | undefined;
  const sessionStacks = new Map<string, SpanStack>();
  const sessionRootSpan = new Map<string, string>();
  const sessionSampled = new Map<string, boolean>();

  // ---- Sampling (per-session stable decision) ----
  function isSampled(sessionId: string): boolean {
    const cached = sessionSampled.get(sessionId);
    if (cached !== undefined) return cached;

    let decision: boolean;
    if (sampler.strategy === 'always_off') decision = false;
    else if (sampler.strategy === 'ratio') {
      const ratio = sampler.value ?? 1.0;
      decision = Math.random() < ratio;
    } else decision = true; // always_on

    sessionSampled.set(sessionId, decision);
    return decision;
  }

  // ---- Span stack helpers ----
  function getStack(sessionId: string): SpanStack {
    let stack = sessionStacks.get(sessionId);
    if (!stack) {
      stack = [];
      sessionStacks.set(sessionId, stack);
    }
    return stack;
  }

  function pushSpan(sessionId: string, spanId: string): void {
    const stack = getStack(sessionId);
    stack.push(spanId);
  }

  function popSpan(sessionId: string): string | undefined {
    const stack = getStack(sessionId);
    return stack.pop();
  }

  function currentSpanId(sessionId: string): string | undefined {
    const stack = sessionStacks.get(sessionId);
    if (!stack || stack.length === 0) return undefined;
    return stack[stack.length - 1];
  }

  function setAttributes(spanId: string, attrs: Record<string, string | number | boolean>): void {
    if (!tracer || !spanId) return;
    const filtered = sensitiveDataFilter ? sensitiveDataFilter.filterObject(attrs) : attrs;
    for (const [key, value] of Object.entries(filtered)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        tracer.setAttribute(spanId, key, value);
      }
    }
  }

  // ---- Plugin definition ----
  const plugin: Plugin & TraceContext = {
    name: 'tracing',
    enabled: true,

    init(ctx: PluginContext): void {
      tracer = ctx.tracer;
    },

    destroy(): void {
      // Force-end all open spans
      for (const stack of sessionStacks.values()) {
        while (stack.length > 0) {
          const spanId = stack.pop()!;
          tracer?.endSpan(spanId, { code: 'error' });
        }
      }
      sessionStacks.clear();
      sessionRootSpan.clear();
      tracer = undefined;
    },

    // ---- TraceContext implementation ----
    getRootSpanId(sessionId: string): string | undefined {
      return sessionRootSpan.get(sessionId);
    },

    getCurrentSpanId(sessionId: string): string | undefined {
      return currentSpanId(sessionId);
    },

    // ---- Event subscriptions ----
    eventSubscriptions: [
      { event: 'agent.start' as const, handler: handleAgentStart },
      { event: 'llm.request' as const, handler: handleLLMRequest },
      { event: 'llm.first_token' as const, handler: handleLLMFirstToken },
      { event: 'llm.response' as const, handler: handleLLMResponse },
      { event: 'tool.call' as const, handler: handleToolCall },
      { event: 'tool.result' as const, handler: handleToolResult },
      { event: 'compaction.start' as const, handler: handleCompactionStart },
      { event: 'compaction.complete' as const, handler: handleCompactionComplete },
      { event: 'agent.complete' as const, handler: handleAgentComplete },
      { event: 'agent.error' as const, handler: handleAgentError },
      { event: 'done' as const, handler: handleDone },
    ].filter(s => !excludeEventTypes?.includes(s.event)),
  };

  // ---- Event handlers ----

  function handleAgentStart(event: AgentEvent): void {
    if (event.type !== 'agent.start') return;
    if (!tracer || !isSampled(event.sessionId)) return;

    const spanId = tracer.startSpan('agent.run', {
      attributes: {
        'gen_ai.agent.name': event.agentName,
        'gen_ai.request.model': event.model.model,
        'gen_ai.provider.name': event.model.provider,
      },
    });

    if (!spanId) return;

    sessionRootSpan.set(event.sessionId, spanId);
    pushSpan(event.sessionId, spanId);
  }

  function handleLLMRequest(event: AgentEvent): void {
    if (event.type !== 'llm.request') return;
    if (!tracer || !isSampled(event.sessionId)) return;
    if (!currentSpanId(event.sessionId)) return;

    const rootParent = sessionRootSpan.get(event.sessionId);
    const llmSpanId = tracer.startSpan('llm.chat', {
      attributes: {
        'gen_ai.request.model': event.model.model,
        'gen_ai.provider.name': event.model.provider,
        'gen_ai.request.messages_count': event.messages.length,
        'gen_ai.request.tools_count': event.tools?.length ?? 0,
      },
      ...(rootParent ? { parent: rootParent } : {}),
    });

    if (llmSpanId) {
      pushSpan(event.sessionId, llmSpanId);
    }
  }

  function handleLLMFirstToken(event: AgentEvent): void {
    if (event.type !== 'llm.first_token') return;
    if (!tracer) return;

    const spanId = currentSpanId(event.sessionId);
    if (!spanId) return;

    tracer.addEvent(spanId, 'gen_ai.first_token', {
      [ATTR_AGENTFORGE_TTFT_MS]: event.ttftMs,
    });
  }

  function handleLLMResponse(event: AgentEvent): void {
    if (event.type !== 'llm.response') return;
    if (!tracer || !isSampled(event.sessionId)) return;

    const spanId = popSpan(event.sessionId);
    if (!spanId) return;

    if (event.usage) {
      const attrs: Record<string, string | number | boolean> = {
        'gen_ai.usage.input_tokens': event.usage.promptTokens,
        'gen_ai.usage.output_tokens': event.usage.completionTokens,
      };
      if (event.usage.cacheReadTokens !== undefined) {
        attrs['agentforge.cache.read_tokens'] = event.usage.cacheReadTokens;
      }
      if (event.usage.cacheWriteTokens !== undefined) {
        attrs['agentforge.cache.write_tokens'] = event.usage.cacheWriteTokens;
      }
      setAttributes(spanId, attrs);
    }

    if (event.ttftMs !== undefined) {
      setAttributes(spanId, { [ATTR_AGENTFORGE_TTFT_MS]: event.ttftMs });
    }

    tracer.endSpan(spanId);
  }

  function handleToolCall(event: AgentEvent): void {
    if (event.type !== 'tool.call') return;
    const rootSpanId = sessionRootSpan.get(event.sessionId);
    if (!tracer || !rootSpanId) return;
    if (!isSampled(event.sessionId)) return;

    const toolSpanId = tracer.startSpan(`tool.${event.toolName}`, {
      parent: rootSpanId,
      attributes: {
        'gen_ai.tool.name': event.toolName,
        'gen_ai.tool.arguments_size': JSON.stringify(event.args).length,
      },
    });

    if (toolSpanId) {
      pushSpan(event.sessionId, toolSpanId);
    }
  }

  function handleToolResult(event: AgentEvent): void {
    if (event.type !== 'tool.result') return;
    if (!tracer || !isSampled(event.sessionId)) return;

    const spanId = popSpan(event.sessionId);
    if (!spanId) return;

    const attrs: Record<string, string | number | boolean> = {};
    if (event.errorType) {
      attrs['agentforge.tool.error_type'] = event.errorType;
    }
    if (Object.keys(attrs).length > 0) {
      setAttributes(spanId, attrs);
    }

    tracer.endSpan(spanId, event.isError ? { code: 'error' } : {});
  }

  function handleCompactionStart(event: AgentEvent): void {
    if (event.type !== 'compaction.start') return;
    const rootSpanId = sessionRootSpan.get(event.sessionId);
    if (!tracer || !rootSpanId) return;
    if (!isSampled(event.sessionId)) return;

    const compSpanId = tracer.startSpan('compaction', {
      parent: rootSpanId,
      attributes: {
        'agentforge.compaction.strategy': event.strategy,
        'agentforge.compaction.tokens_before': event.tokensBefore,
      },
    });

    if (compSpanId) {
      pushSpan(event.sessionId, compSpanId);
    }
  }

  function handleCompactionComplete(event: AgentEvent): void {
    if (event.type !== 'compaction.complete') return;
    if (!tracer || !isSampled(event.sessionId)) return;

    const spanId = popSpan(event.sessionId);
    if (!spanId) return;

    setAttributes(spanId, {
      'agentforge.compaction.tokens_after': event.tokensAfter,
      'agentforge.compaction.removed_messages': event.removedMessages,
    });
    tracer.endSpan(spanId);
  }

  function handleAgentComplete(event: AgentEvent): void {
    if (event.type !== 'agent.complete') return;
    if (!tracer || !isSampled(event.sessionId)) return;

    const rootSpanId = sessionRootSpan.get(event.sessionId);
    if (!rootSpanId) return;

    setAttributes(rootSpanId, {
      'agentforge.steps': event.steps,
      'agentforge.output_length': event.output.length,
    });

    if (event.tokens) {
      setAttributes(rootSpanId, {
        'gen_ai.usage.input_tokens': event.tokens.input,
        'gen_ai.usage.output_tokens': event.tokens.output,
      });
    }

    tracer.endSpan(rootSpanId);
    cleanupSession(event.sessionId);
  }

  function handleAgentError(event: AgentEvent): void {
    if (event.type !== 'agent.error') return;
    if (!tracer || !isSampled(event.sessionId)) return;

    const rootSpanId = sessionRootSpan.get(event.sessionId);
    if (!rootSpanId) return;

    tracer.recordException(rootSpanId, new Error(event.error.message));
    tracer.setAttribute(
      rootSpanId,
      ATTR_AGENTFORGE_ERROR_CODE,
      event.error.code ?? event.error.name
    );
    tracer.endSpan(rootSpanId, { code: 'error' });
    cleanupSession(event.sessionId);
  }

  function handleDone(event: AgentEvent): void {
    if (event.type !== 'done') return;
    if (!tracer || !isSampled(event.sessionId)) return;

    // Force-end all remaining open spans for this session
    const stack = sessionStacks.get(event.sessionId);
    if (stack) {
      while (stack.length > 0) {
        const spanId = stack.pop()!;
        tracer.endSpan(spanId, { code: 'error' });
      }
    }

    // Also end root span if still open
    const rootSpanId = sessionRootSpan.get(event.sessionId);
    if (rootSpanId) {
      tracer.endSpan(rootSpanId, { code: 'error' });
    }

    cleanupSession(event.sessionId);
  }

  function cleanupSession(sessionId: string): void {
    sessionStacks.delete(sessionId);
    sessionRootSpan.delete(sessionId);
    sessionSampled.delete(sessionId);
  }

  return plugin;
}
