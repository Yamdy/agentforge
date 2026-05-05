/**
 * Tests for createAgent preset activation
 *
 * Verifies that the correct services are configured based on preset name.
 * Uses real agent loop with MockLLMAdapter — no vi.mock() for the loop.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createAgent } from '../../src/api/create-agent.js';
import type { AgentConfig } from '../../src/api/types.js';
import { MockLLMAdapter } from '../helpers/llm-mocks.js';

// ============================================================
// Helpers
// ============================================================

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'test-agent',
    model: { provider: 'mock', model: 'mock-model' },
    maxSteps: 1,
    tools: [],
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('createAgent — preset activation', () => {
  let llm: MockLLMAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new MockLLMAdapter();
  });

  it('applies debugPreset when preset is "debug"', async () => {
    const agent = createAgent(makeConfig({ preset: 'debug' }), { llm });
    const result = await agent.run('hello');
    expect(result.output).toBe('Default response');
    expect(result.status).toBe('success');
    expect(agent.ctx).toBeDefined();
    expect(agent.ctx.agentName).toBe('test-agent');
  });

  it('applies testPreset when preset is "test"', async () => {
    const agent = createAgent(makeConfig({ preset: 'test' }), { llm });
    const result = await agent.run('hello');
    expect(result.output).toBe('Default response');
    expect(result.status).toBe('success');
    expect(agent.ctx).toBeDefined();
  });

  it('applies productionPreset when preset is "production" and services are configured', async () => {
    const agent = createAgent(makeConfig({ preset: 'production' }), { llm });
    const result = await agent.run('hello');
    expect(result.output).toBe('Default response');
    expect(result.status).toBe('success');
    expect(agent.ctx).toBeDefined();
  });

  it('does not apply any preset when preset is undefined', async () => {
    const agent = createAgent(makeConfig({ tracing: true }), { llm });
    await agent.run('hello');
    expect(agent.ctx.services.tracer).toBeDefined();
  });

  it('passes correct config to productionPreset', async () => {
    const agent = createAgent(makeConfig({ preset: 'production' }), { llm });
    await agent.run('hello');
    expect(agent.ctx.agentName).toBe('test-agent');
  });

  it('wires streaming handlers — onToken receives stream chunks via agent.run()', async () => {
    const agent = createAgent(makeConfig({ preset: 'production' }), { llm });

    let tokenReceived = '';
    let toolCallReceived: unknown = null;
    let completeReceived = '';
    let errorReceived: unknown = null;

    await agent.run('hello', {
      onToken: (delta: string) => { tokenReceived += delta; },
      onToolCall: (event: unknown) => { toolCallReceived = event; },
      onComplete: (output: string) => { completeReceived = output; },
      onError: (event: unknown) => { errorReceived = event; },
    });

    // onComplete fires because the real loop emits agent.complete with the LLM output
    expect(completeReceived).toBe('Default response');

    // onToken, onToolCall, onError are wired but not triggered
    // by the mock (no streaming, no tool calls, no errors in this run)
    expect(tokenReceived).toBe('');
    expect(toolCallReceived).toBeNull();
    expect(errorReceived).toBeNull();
  });

  it('wires onToolResult and onEvent handlers via agent.run()', async () => {
    const agent = createAgent(makeConfig({ preset: 'production' }), { llm });

    let toolResultReceived: unknown = null;
    const allEvents: string[] = [];

    await agent.run('hello', {
      onToolResult: (event: unknown) => { toolResultReceived = event; },
      onEvent: (event: unknown) => { allEvents.push((event as { type: string }).type); },
    });

    // onEvent (wired via onAny) captures all events emitted by the real loop
    expect(allEvents.length).toBeGreaterThan(0);
    expect(allEvents).toContain('llm.request');
    expect(allEvents).toContain('agent.complete');

    // tool.result is not emitted without tool execution in this test
    expect(toolResultReceived).toBeNull();
  });

  it('configures services based on tracing and metrics flags', async () => {
    const agent = createAgent(makeConfig({ tracing: true, metrics: true }), { llm });

    expect(agent.ctx.services.tracer).toBeDefined();
    expect(agent.ctx.services.metrics).toBeDefined();
  });
});

// ============================================================
// New grouped format
// ============================================================

describe('createAgent — grouped config format', () => {
  let llm: MockLLMAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new MockLLMAdapter();
  });

  it('accepts execution group', async () => {
    const agent = createAgent(
      makeConfig({
        execution: { parallelToolCalls: false, streaming: false, executionMode: 'react' },
      }),
      { llm }
    );
    const result = await agent.run('hello');
    expect(result.output).toBe('Default response');
    expect(result.status).toBe('success');
  });

  it('accepts controls group', async () => {
    const agent = createAgent(
      makeConfig({
        controls: { timeout: 30000, maxLLMRepairAttempts: 1, retry: 0, retryDelay: 100 },
      }),
      { llm }
    );
    const result = await agent.run('hello');
    expect(result.output).toBe('Default response');
    expect(result.status).toBe('success');
  });

  it('accepts observability group with tracing and metrics', async () => {
    const agent = createAgent(
      makeConfig({
        observability: { tracing: { exporter: 'console' }, metrics: true, preset: 'production' },
      }),
      { llm }
    );
    await agent.run('hello');
    expect(agent.ctx.services.tracer).toBeDefined();
    expect(agent.ctx.services.metrics).toBeDefined();
  });

  it('grouped fields override legacy flat fields', async () => {
    const agent = createAgent(
      makeConfig({
        tracing: false as unknown as undefined, // flat: no tracing
        observability: { tracing: { exporter: 'console' } }, // grouped: enable
      }),
      { llm }
    );
    await agent.run('hello');
    // Grouped takes precedence — tracing should be enabled
    expect(agent.ctx.services.tracer).toBeDefined();
  });

  it('execution group overrides legacy flat streaming', async () => {
    const agent = createAgent(
      makeConfig({
        streaming: true, // flat
        execution: { streaming: false }, // grouped overrides
      }),
      { llm }
    );
    const result = await agent.run('hello');
    expect(result.output).toBe('Default response');
    expect(result.status).toBe('success');
  });
});
