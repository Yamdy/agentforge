/**
 * Unit tests for metrics-plugin.ts — factory-based metrics collection.
 *
 * Tests: factory isolation, init/destroy, all 6 event handlers.
 * Uses a mock Metrics collector with vi.fn() spies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import type { AgentEvent } from '../../src/core/events.js';
import { createMetricsPlugin } from '../../src/plugins/metrics-plugin.js';

// ============================================================
// Helpers
// ============================================================

function createMockMetrics() {
  return {
    increment: vi.fn(),
    histogram: vi.fn(),
    gauge: vi.fn(),
  };
}

function makeCtx(overrides?: Partial<PluginContext>): PluginContext {
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    ...overrides,
  };
}

function makeEvent(type: AgentEvent['type'], overrides?: Partial<AgentEvent>): AgentEvent {
  return { type, timestamp: Date.now(), sessionId: 'test-session', ...overrides } as AgentEvent;
}

// ============================================================
// Identity & Lifecycle
// ============================================================

describe('createMetricsPlugin', () => {
  it('creates a plugin with name "metrics"', () => {
    const plugin = createMetricsPlugin();
    expect(plugin.name).toBe('metrics');
    expect(plugin.enabled).toBe(true);
  });

  it('factory isolation — two instances have independent state', () => {
    const p1 = createMetricsPlugin();
    const p2 = createMetricsPlugin();
    expect(p1).not.toBe(p2);
  });

  it('subscribes to 6 event types', () => {
    const plugin = createMetricsPlugin();
    const events = plugin.eventSubscriptions?.map(s => s.event).sort();
    expect(events).toEqual([
      'agent.complete',
      'agent.error',
      'evaluation.complete',
      'llm.first_token',
      'llm.response',
      'tool.result',
    ]);
  });

  it('init captures metrics and agentName from context', () => {
    const plugin = createMetricsPlugin();
    const metrics = createMockMetrics();
    plugin.init!(makeCtx({ metrics, agentName: 'my-agent' }));

    // Emit an event — handler should use captured metrics
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'tool.result')!.handler;
    handler(
      makeEvent('tool.result', {
        toolCallId: 'tc-1',
        toolName: 'test_tool',
        result: 'ok',
        isError: false,
      }),
    );

    expect(metrics.increment).toHaveBeenCalledWith('tool.executions', 1, {
      agent: 'my-agent',
      tool: 'test_tool',
      isError: 'false',
    });
  });

  it('destroy clears captured state', () => {
    const plugin = createMetricsPlugin();
    const metrics = createMockMetrics();
    plugin.init!(makeCtx({ metrics }));
    plugin.destroy!();

    // Emit after destroy — should be no-op
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.error')!.handler;
    handler(
      makeEvent('agent.error', {
        error: { name: 'TestError', message: 'test' },
      }),
    );

    expect(metrics.increment).not.toHaveBeenCalled();
  });
});

// ============================================================
// Event Handlers
// ============================================================

describe('event handlers', () => {
  let plugin: Plugin;
  let metrics: ReturnType<typeof createMockMetrics>;

  beforeEach(() => {
    plugin = createMetricsPlugin();
    metrics = createMockMetrics();
    plugin.init!(makeCtx({ metrics, agentName: 'test-agent' }));
  });

  // ---- llm.response ----

  describe('llm.response', () => {
    let handler: (event: AgentEvent) => void;

    beforeEach(() => {
      handler = plugin.eventSubscriptions!.find(s => s.event === 'llm.response')!.handler;
    });

    it('records prompt and completion token increments', () => {
      handler(
        makeEvent('llm.response', {
          content: 'hello',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 50 },
        }),
      );

      expect(metrics.increment).toHaveBeenCalledWith('llm.tokens.prompt', 100, {
        agent: 'test-agent',
      });
      expect(metrics.increment).toHaveBeenCalledWith('llm.tokens.completion', 50, {
        agent: 'test-agent',
      });
    });

    it('records cache read tokens when present', () => {
      handler(
        makeEvent('llm.response', {
          content: 'hello',
          finishReason: 'stop',
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            cacheReadTokens: 200,
          },
        }),
      );

      expect(metrics.increment).toHaveBeenCalledWith('llm.tokens.cache_read', 200, {
        agent: 'test-agent',
      });
    });

    it('skips cache tokens when undefined', () => {
      handler(
        makeEvent('llm.response', {
          content: 'hello',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 50 },
        }),
      );

      // cacheReadTokens was never emitted
      const cacheReadCalls = metrics.increment.mock.calls.filter(
        (c: string[]) => c[0] === 'llm.tokens.cache_read',
      );
      expect(cacheReadCalls).toHaveLength(0);
    });

    it('records TTFT histogram when present', () => {
      handler(
        makeEvent('llm.response', {
          content: 'hello',
          finishReason: 'stop',
          ttftMs: 250,
          usage: { promptTokens: 100, completionTokens: 50 },
        }),
      );

      expect(metrics.histogram).toHaveBeenCalledWith('llm.ttft_ms', 250, {
        agent: 'test-agent',
      });
    });
  });

  // ---- llm.first_token ----

  describe('llm.first_token', () => {
    it('records TTFT histogram', () => {
      const handler = plugin.eventSubscriptions!.find(s => s.event === 'llm.first_token')!.handler;
      handler(makeEvent('llm.first_token', { ttftMs: 180 }));

      expect(metrics.histogram).toHaveBeenCalledWith('llm.ttft_ms', 180, {
        agent: 'test-agent',
      });
    });
  });

  // ---- tool.result ----

  describe('tool.result', () => {
    it('increments tool.executions counter', () => {
      const handler = plugin.eventSubscriptions!.find(s => s.event === 'tool.result')!.handler;
      handler(
        makeEvent('tool.result', {
          toolCallId: 'tc-1',
          toolName: 'read_file',
          result: 'contents here',
          isError: false,
        }),
      );

      expect(metrics.increment).toHaveBeenCalledWith('tool.executions', 1, {
        agent: 'test-agent',
        tool: 'read_file',
        isError: 'false',
      });
    });

    it('marks isError as true string on error', () => {
      const handler = plugin.eventSubscriptions!.find(s => s.event === 'tool.result')!.handler;
      handler(
        makeEvent('tool.result', {
          toolCallId: 'tc-2',
          toolName: 'bash',
          result: 'permission denied',
          isError: true,
        }),
      );

      expect(metrics.increment).toHaveBeenCalledWith('tool.executions', 1, {
        agent: 'test-agent',
        tool: 'bash',
        isError: 'true',
      });
    });
  });

  // ---- agent.complete ----

  describe('agent.complete', () => {
    it('records steps histogram and token gauges', () => {
      const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.complete')!
        .handler;
      handler(
        makeEvent('agent.complete', {
          output: 'done!',
          steps: 5,
          tokens: { input: 1000, output: 500 },
        }),
      );

      expect(metrics.histogram).toHaveBeenCalledWith('agent.steps', 5, {
        agent: 'test-agent',
      });
      expect(metrics.gauge).toHaveBeenCalledWith('agent.tokens.input', 1000, {
        agent: 'test-agent',
      });
      expect(metrics.gauge).toHaveBeenCalledWith('agent.tokens.output', 500, {
        agent: 'test-agent',
      });
    });

    it('skips token gauges when tokens absent', () => {
      const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.complete')!
        .handler;
      handler(
        makeEvent('agent.complete', { output: 'done!', steps: 3 }),
      );

      // histogram was called, gauge was not
      expect(metrics.histogram).toHaveBeenCalledWith('agent.steps', 3, {
        agent: 'test-agent',
      });
      expect(metrics.gauge).not.toHaveBeenCalled();
    });
  });

  // ---- agent.error ----

  describe('agent.error', () => {
    it('increments error counter with error name', () => {
      const handler = plugin.eventSubscriptions!.find(s => s.event === 'agent.error')!.handler;
      handler(
        makeEvent('agent.error', {
          error: { name: 'RateLimitError', message: 'too many requests' },
        }),
      );

      expect(metrics.increment).toHaveBeenCalledWith('agent.errors', 1, {
        agent: 'test-agent',
        errorName: 'RateLimitError',
      });
    });
  });

  // ---- evaluation.complete ----

  describe('evaluation.complete', () => {
    it('records score histogram with runId tag', () => {
      const handler = plugin.eventSubscriptions!.find(s => s.event === 'evaluation.complete')!
        .handler;
      handler(
        makeEvent('evaluation.complete', {
          runId: 'eval-123',
          compositeScore: 0.85,
          scorers: [{ name: 'accuracy', score: 0.9, weight: 1 }],
        }),
      );

      expect(metrics.histogram).toHaveBeenCalledWith('evaluation.score', 0.85, {
        agent: 'test-agent',
        runId: 'eval-123',
      });
    });
  });

  // ---- Error isolation ----

  it('errors in handler are silently caught', () => {
    const handler = plugin.eventSubscriptions!.find(s => s.event === 'llm.response')!.handler;
    const throwingEvent = makeEvent('llm.response', {
      content: 'hello',
      finishReason: 'stop',
      // Passing non-standard data to try to trigger an error — but the handler
      // should catch any error and not propagate
    });

    expect(() => handler(throwingEvent)).not.toThrow();
  });
});
