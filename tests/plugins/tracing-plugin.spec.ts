/**
 * Unit tests for tracing-plugin.ts — span lifecycle management via event subscriptions.
 *
 * Tests: span lifecycle (start/end), span hierarchy, tool span parallel matching,
 * sampling strategies, force-cleanup on done/destroy, TraceContext API.
 * Uses a mock Tracer with vi.fn() spies and a real AgentEventEmitter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import type { AgentEvent } from '../../src/core/events.js';
import type { Tracer } from '../../src/core/interfaces.js';
import { createTracingPlugin } from '../../src/plugins/tracing-plugin.js';
import type { TraceContext } from '../../src/observability/trace-context.js';
import { AgentEventEmitter } from '../../src/core/events.js';

// ============================================================
// Mock Tracer
// ============================================================

let nextSpanId = 0;

function createMockTracer() {
  nextSpanId = 0;
  return {
    startSpan: vi.fn((name: string, _opts?: unknown) => {
      return `${name}-${++nextSpanId}`;
    }),
    endSpan: vi.fn(),
    setAttribute: vi.fn(),
    addEvent: vi.fn(),
    recordException: vi.fn(),
  };
}

// ============================================================
// Helpers
// ============================================================

function makeCtx(overrides?: Partial<PluginContext>): PluginContext {
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    ...overrides,
  };
}

const SID = 'test-session';

function makeEvent(type: AgentEvent['type'], overrides?: Record<string, unknown>): AgentEvent {
  return { type, timestamp: Date.now(), sessionId: SID, ...overrides } as AgentEvent;
}

// ============================================================
// Identity & Lifecycle
// ============================================================

describe('createTracingPlugin', () => {
  it('creates a plugin implementing Plugin & TraceContext', () => {
    const plugin = createTracingPlugin();
    expect(plugin.name).toBe('tracing');
    expect(plugin.enabled).toBe(true);
    // TraceContext methods
    const tc = plugin as unknown as TraceContext;
    expect(typeof tc.getRootSpanId).toBe('function');
    expect(typeof tc.getCurrentSpanId).toBe('function');
  });

  it('subscribes to 11 event types', () => {
    const plugin = createTracingPlugin();
    const events = plugin.eventSubscriptions?.map(s => s.event).sort();
    expect(events).toContain('agent.start');
    expect(events).toContain('agent.complete');
    expect(events).toContain('agent.error');
    expect(events).toContain('llm.request');
    expect(events).toContain('llm.first_token');
    expect(events).toContain('llm.response');
    expect(events).toContain('tool.call');
    expect(events).toContain('tool.result');
    expect(events).toContain('compaction.start');
    expect(events).toContain('compaction.complete');
    expect(events).toContain('done');
  });

  it('init captures tracer from context', () => {
    const plugin = createTracingPlugin();
    const tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));
    // Not directly testable via return value — verified in span lifecycle tests
  });

  it('destroy force-ends all open spans', () => {
    const plugin = createTracingPlugin();
    const tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    // Start a root span
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    expect(tracer.startSpan).toHaveBeenCalledWith('agent.run', expect.anything());

    // Destroy should end all open spans
    plugin.destroy!();
    expect(tracer.endSpan).toHaveBeenCalled();
  });
});

// ============================================================
// Span Lifecycle — agent.run (root span)
// ============================================================

describe('agent.run span lifecycle', () => {
  let plugin: Plugin & TraceContext;
  let tracer: ReturnType<typeof createMockTracer>;

  beforeEach(() => {
    plugin = createTracingPlugin() as Plugin & TraceContext;
    tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));
  });

  it('agent.start creates root span "agent.run"', () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    expect(tracer.startSpan).toHaveBeenCalledWith('agent.run', expect.objectContaining({
      attributes: expect.objectContaining({
        'gen_ai.agent.name': 'test',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.provider.name': 'openai',
      }),
    }));
  });

  it('getRootSpanId returns the root span ID', () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    const rootId = plugin.getRootSpanId(SID);
    expect(rootId).toBeDefined();
    expect(rootId).toBe('agent.run-1');
  });

  it('getCurrentSpanId returns the current span on stack', () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    expect(plugin.getCurrentSpanId(SID)).toBe('agent.run-1');
  });
});

// ============================================================
// Span Lifecycle — llm.chat (child of root)
// ============================================================

describe('llm.chat span lifecycle', () => {
  let plugin: Plugin & TraceContext;
  let tracer: ReturnType<typeof createMockTracer>;

  beforeEach(() => {
    plugin = createTracingPlugin() as Plugin & TraceContext;
    tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));
  });

  function startAgent() {
    const h = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    h(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );
  }

  it('llm.request creates child span of root', () => {
    startAgent();

    const handler = plugin.eventSubscriptions!.find(s => s.event === 'llm.request')!.handler;
    handler(
      makeEvent('llm.request', {
        messages: [{ role: 'user', content: 'hi' }],
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    expect(tracer.startSpan).toHaveBeenCalledTimes(2); // root + llm
    // Second call should be llm.chat
    const lastCall = tracer.startSpan.mock.calls[1];
    expect(lastCall[0]).toBe('llm.chat');
  });

  it('llm.response ends llm span and pops stack', () => {
    startAgent();

    const reqHandler = plugin.eventSubscriptions!.find(s => s.event === 'llm.request')!.handler;
    reqHandler(
      makeEvent('llm.request', {
        messages: [{ role: 'user', content: 'hi' }],
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    // After request, current span is llm.chat
    const llmSpanId = plugin.getCurrentSpanId(SID);

    const resHandler = plugin.eventSubscriptions!.find(s => s.event === 'llm.response')!
      .handler;
    resHandler(
      makeEvent('llm.response', {
        content: 'hello',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
      }),
    );

    expect(tracer.endSpan).toHaveBeenCalledWith(llmSpanId);
    // After response, current span should be back to root
    expect(plugin.getCurrentSpanId(SID)).toBe(plugin.getRootSpanId(SID));
  });

  it('llm.response sets usage attributes', () => {
    startAgent();

    const reqHandler = plugin.eventSubscriptions!.find(s => s.event === 'llm.request')!.handler;
    reqHandler(
      makeEvent('llm.request', {
        messages: [{ role: 'user', content: 'hi' }],
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    const resHandler = plugin.eventSubscriptions!.find(s => s.event === 'llm.response')!
      .handler;
    resHandler(
      makeEvent('llm.response', {
        content: 'hello',
        finishReason: 'stop',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          cacheReadTokens: 25,
          cacheWriteTokens: 10,
        },
      }),
    );

    expect(tracer.setAttribute).toHaveBeenCalled();
  });
});

// ============================================================
// llm.first_token
// ============================================================

describe('llm.first_token event', () => {
  it('adds gen_ai.first_token event to current llm span', () => {
    const plugin = createTracingPlugin() as Plugin & TraceContext;
    const tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    const startH = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    startH(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    const reqH = plugin.eventSubscriptions!.find(s => s.event === 'llm.request')!.handler;
    reqH(
      makeEvent('llm.request', {
        messages: [{ role: 'user', content: 'hi' }],
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    const ftH = plugin.eventSubscriptions!.find(s => s.event === 'llm.first_token')!.handler;
    ftH(makeEvent('llm.first_token', { ttftMs: 120 }));

    expect(tracer.addEvent).toHaveBeenCalledWith(
      expect.stringMatching(/^llm\.chat-/),
      'gen_ai.first_token',
      { 'agentforge.ttft_ms': 120 },
    );
  });
});

// ============================================================
// Tool Span — Parallel Call Matching (Map<toolCallId>)
// ============================================================

describe('tool span lifecycle', () => {
  let plugin: Plugin & TraceContext;
  let tracer: ReturnType<typeof createMockTracer>;

  beforeEach(() => {
    plugin = createTracingPlugin() as Plugin & TraceContext;
    tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    const h = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    h(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );
  });

  it('tool.call creates span keyed by toolCallId', () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'tool.call')!.handler;
    handler(
      makeEvent('tool.call', {
        toolCallId: 'tc-1',
        toolName: 'read_file',
        args: { path: '/x' },
      }),
    );

    expect(tracer.startSpan).toHaveBeenCalledWith('tool.read_file', expect.objectContaining({
      parent: plugin.getRootSpanId(SID),
    }));
  });

  it('tool.result matches correct span for parallel calls', () => {
    const callHandler = plugin.eventSubscriptions!.find(s => s.event === 'tool.call')!.handler;
    const resultHandler = plugin.eventSubscriptions!.find(s => s.event === 'tool.result')!
      .handler;

    // Simulate parallel tool calls: A.call → B.call → A.result → B.result
    callHandler(
      makeEvent('tool.call', {
        toolCallId: 'tc-a',
        toolName: 'read_file',
        args: { path: '/a' },
      }),
    );
    callHandler(
      makeEvent('tool.call', {
        toolCallId: 'tc-b',
        toolName: 'write_file',
        args: { path: '/b' },
      }),
    );

    // Now resolve in reverse order — this would break a stack-based pop
    resultHandler(
      makeEvent('tool.result', {
        toolCallId: 'tc-a',
        toolName: 'read_file',
        result: 'a-contents',
        isError: false,
      }),
    );
    resultHandler(
      makeEvent('tool.result', {
        toolCallId: 'tc-b',
        toolName: 'write_file',
        result: 'b-written',
        isError: false,
      }),
    );

    // Both tool spans should be ended
    expect(tracer.endSpan).toHaveBeenCalledTimes(2);
  });

  it('tool.result with isError ends span with error code', () => {
    const callHandler = plugin.eventSubscriptions!.find(s => s.event === 'tool.call')!.handler;
    const resultHandler = plugin.eventSubscriptions!.find(s => s.event === 'tool.result')!
      .handler;

    callHandler(
      makeEvent('tool.call', {
        toolCallId: 'tc-err',
        toolName: 'bash',
        args: { cmd: 'bad' },
      }),
    );

    resultHandler(
      makeEvent('tool.result', {
        toolCallId: 'tc-err',
        toolName: 'bash',
        result: 'failed',
        isError: true,
      }),
    );

    expect(tracer.endSpan).toHaveBeenCalledWith(expect.any(String), { code: 'error' });
  });

  it('tool.result with errorType sets attribute on span', () => {
    const callHandler = plugin.eventSubscriptions!.find(s => s.event === 'tool.call')!.handler;
    const resultHandler = plugin.eventSubscriptions!.find(s => s.event === 'tool.result')!
      .handler;

    callHandler(
      makeEvent('tool.call', {
        toolCallId: 'tc-timeout',
        toolName: 'web_fetch',
        args: { url: 'https://example.com' },
      }),
    );

    resultHandler(
      makeEvent('tool.result', {
        toolCallId: 'tc-timeout',
        toolName: 'web_fetch',
        result: 'timeout',
        isError: true,
        errorType: 'timeout',
      }),
    );

    expect(tracer.setAttribute).toHaveBeenCalledWith(
      expect.any(String),
      'agentforge.tool.error_type',
      'timeout',
    );
  });
});

// ============================================================
// agent.complete / agent.error
// ============================================================

describe('terminal events', () => {
  let plugin: Plugin & TraceContext;
  let tracer: ReturnType<typeof createMockTracer>;

  beforeEach(() => {
    plugin = createTracingPlugin() as Plugin & TraceContext;
    tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    const h = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    h(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );
  });

  it('agent.complete ends root span and cleans up session', () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.complete')!.handler;
    const rootId = plugin.getRootSpanId(SID);

    handler(
      makeEvent('agent.complete', {
        output: 'result',
        steps: 5,
        tokens: { input: 100, output: 50 },
      }),
    );

    expect(tracer.endSpan).toHaveBeenCalledWith(rootId);
    expect(plugin.getRootSpanId(SID)).toBeUndefined();
    expect(plugin.getCurrentSpanId(SID)).toBeUndefined();
  });

  it('agent.error records exception and ends root with error', () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.error')!.handler;
    const rootId = plugin.getRootSpanId(SID);

    handler(
      makeEvent('agent.error', {
        error: { name: 'TestError', message: 'test error', code: 'E_TEST' },
      }),
    );

    expect(tracer.recordException).toHaveBeenCalledWith(rootId, expect.any(Error));
    expect(tracer.setAttribute).toHaveBeenCalledWith(
      rootId,
      'agentforge.error.code',
      'E_TEST',
    );
    expect(tracer.endSpan).toHaveBeenCalledWith(rootId, { code: 'error' });
  });
});

// ============================================================
// done — force-end all open spans
// ============================================================

describe('done handler', () => {
  it('force-ends all open spans for the session', () => {
    const plugin = createTracingPlugin() as Plugin & TraceContext;
    const tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    const startH = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    startH(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    const callH = plugin.eventSubscriptions!.find(s => s.event === 'tool.call')!.handler;
    callH(
      makeEvent('tool.call', {
        toolCallId: 'tc-done',
        toolName: 'bash',
        args: { cmd: 'ls' },
      }),
    );

    // done should end both the open tool span and the root span
    const doneH = plugin.eventSubscriptions!.find(s => s.event === 'done')!.handler;
    doneH(makeEvent('done', { reason: 'cancelled' }));

    expect(tracer.endSpan).toHaveBeenCalledTimes(3); // tool span + root from stack + root from explicit check
    expect(plugin.getRootSpanId(SID)).toBeUndefined();
  });
});

// ============================================================
// Sampling
// ============================================================

describe('sampling', () => {
  it('always_off produces no spans', () => {
    const plugin = createTracingPlugin({ sampler: { strategy: 'always_off' } }) as Plugin & TraceContext;
    const tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    expect(tracer.startSpan).not.toHaveBeenCalled();
    expect(plugin.getRootSpanId(SID)).toBeUndefined();
  });

  it('ratio: 0 produces no spans', () => {
    const plugin = createTracingPlugin({ sampler: { strategy: 'ratio', value: 0 } }) as Plugin & TraceContext;
    const tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    expect(tracer.startSpan).not.toHaveBeenCalled();
  });

  it('ratio: 1 always produces spans', () => {
    const plugin = createTracingPlugin({ sampler: { strategy: 'ratio', value: 1 } }) as Plugin & TraceContext;
    const tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    expect(tracer.startSpan).toHaveBeenCalled();
  });

  it('sampling decision is stable per session', () => {
    const plugin = createTracingPlugin({ sampler: { strategy: 'ratio', value: 0.5 } }) as Plugin & TraceContext;
    const tracer = createMockTracer();
    plugin.init!(makeCtx({ tracer }));

    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.start')!.handler;
    handler(
      makeEvent('agent.start', {
        input: 'hello',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    const wasSampled = tracer.startSpan.mock.calls.length > 0;
    const startCount = tracer.startSpan.mock.calls.length;

    // Same session should get same decision — call agent.start again
    handler(
      makeEvent('agent.start', {
        input: 'hello again',
        agentName: 'test',
        model: { provider: 'openai', model: 'gpt-4o' },
      }),
    );

    // If sampled, should have more startSpan calls; if not, still 0
    if (wasSampled) {
      expect(tracer.startSpan.mock.calls.length).toBeGreaterThan(startCount);
    } else {
      expect(tracer.startSpan.mock.calls.length).toBe(0);
    }
  });
});

// ============================================================
// excludeEventTypes
// ============================================================

describe('excludeEventTypes', () => {
  it('excludes compaction events when configured', () => {
    const plugin = createTracingPlugin({
      excludeEventTypes: ['compaction.start', 'compaction.complete'],
    });
    const events = plugin.eventSubscriptions?.map(s => s.event);
    expect(events).not.toContain('compaction.start');
    expect(events).not.toContain('compaction.complete');
    expect(events).toContain('agent.start');
  });
});
