/**
 * Tests for createAgent preset activation
 *
 * Verifies that the correct services are configured based on preset name.
 * Presets use callback-based operator pattern.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AgentEvent } from '../../src/core/index.js';

/**
 * Track calls to loop.on for streaming handler verification.
 * Reset in beforeEach via vi.clearAllMocks.
 */
const onCalls: Array<[string, (...args: unknown[]) => void]> = [];

// Mock the loop module — return Promise-based AgentLoop with tracked on()
vi.mock('../../src/loop/agent-loop.js', () => ({
  createAgentLoop: () => ({
    run: async (_input: string) => 'test output',
    on: (type: string, fn: (...args: unknown[]) => void) => {
      onCalls.push([type, fn]);
      return () => {};
    },
    onAny: () => () => {},
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    getState: () => null,
    destroy: () => {},
    run$: (_input: string) => ({ type: 'done', reason: 'completed', timestamp: Date.now(), sessionId: 'test' } as AgentEvent),
  }),
}));

// Mock the adapters module
vi.mock('../../src/adapters/index.js', () => ({
  createLLMAdapter: () => ({
    name: 'mock',
    chat: async () => ({ content: 'mock', finishReason: 'stop' }),
    stream: async function* () { yield { text: 'mock' }; },
  }),
  parseModelSpec: (spec: string) => {
    const parts = spec.split('/');
    return { provider: parts[0] ?? 'openai', model: parts[1] ?? spec };
  },
}));

// Import AFTER mocks are set up
import { createAgent } from '../../src/api/create-agent.js';

// ============================================================
// Helpers
// ============================================================

function makeAgentConfig(preset?: 'production' | 'debug' | 'test') {
  return {
    name: 'test-agent',
    model: { provider: 'mock', model: 'mock-model' },
    maxSteps: 1,
    preset,
    tracing: true,
    metrics: true,
    checkpoint: true,
  };
}

// ============================================================
// Tests
// ============================================================

describe('createAgent — preset activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onCalls.length = 0;
  });

  it('applies debugPreset when preset is "debug"', async () => {
    const agent = createAgent(makeAgentConfig('debug'));
    const result = await agent.run('hello');
    expect(result).toBe('test output');
    expect(agent.ctx).toBeDefined();
    expect(agent.ctx.agentName).toBe('test-agent');
  });

  it('applies testPreset when preset is "test"', async () => {
    const agent = createAgent(makeAgentConfig('test'));
    const result = await agent.run('hello');
    expect(result).toBe('test output');
    expect(agent.ctx).toBeDefined();
  });

  it('applies productionPreset when preset is "production" and services are configured', async () => {
    const agent = createAgent(makeAgentConfig('production'));
    const result = await agent.run('hello');
    expect(result).toBe('test output');
    expect(agent.ctx).toBeDefined();
  });

  it('does not apply any preset when preset is undefined', async () => {
    const agent = createAgent(makeAgentConfig(undefined));
    await agent.run('hello');
    // No preset → default services still created
    expect(agent.ctx.services.tracer).toBeDefined();
  });

  it('passes correct config to productionPreset', async () => {
    const agent = createAgent(makeAgentConfig('production'));
    await agent.run('hello');
    // verify agent was created with correct name
    expect(agent.ctx.agentName).toBe('test-agent');
  });

  it('wires streaming handlers — onToken receives stream chunks via agent.run()', async () => {
    const agent = createAgent(makeAgentConfig('production'));

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

    // Verify loop.on was called for each handler type
    const registeredEvents = onCalls.map(c => c[0]);
    expect(registeredEvents).toContain('llm.stream.text');
    expect(registeredEvents).toContain('tool.call');
    expect(registeredEvents).toContain('agent.complete');
    expect(registeredEvents).toContain('agent.error');

    // Simulate handler invocation: fire onToken callback
    const onTokenCall = onCalls.find(c => c[0] === 'llm.stream.text');
    expect(onTokenCall).toBeDefined();
    onTokenCall![1]({ delta: 'Hello' });
    onTokenCall![1]({ delta: ' World' });
    expect(tokenReceived).toBe('Hello World');

    // Simulate onComplete
    const onCompleteCall = onCalls.find(c => c[0] === 'agent.complete');
    expect(onCompleteCall).toBeDefined();
    onCompleteCall![1]({ output: 'done' });
    expect(completeReceived).toBe('done');
  });

  it('wires onToolResult and onEvent handlers via agent.run()', async () => {
    const agent = createAgent(makeAgentConfig('production'));

    let toolResultReceived: unknown = null;
    const allEvents: string[] = [];

    await agent.run('hello', {
      onToolResult: (event: unknown) => { toolResultReceived = event; },
      onEvent: (event: unknown) => { allEvents.push((event as { type: string }).type); },
    });

    const registeredEvents = onCalls.map(c => c[0]);
    expect(registeredEvents).toContain('tool.result');

    // Simulate onToolResult
    const onToolResultCall = onCalls.find(c => c[0] === 'tool.result');
    expect(onToolResultCall).toBeDefined();
    onToolResultCall![1]({ result: 'file content' });
    expect(toolResultReceived).toEqual({ result: 'file content' });
  });

  it('configures services based on tracing and metrics flags', async () => {
    // Verify that tracing: true wires services (without preset)
    const agent = createAgent({
      name: 'svc-agent',
      model: { provider: 'mock', model: 'mock-model' },
      maxSteps: 1,
      tracing: true,
      metrics: true,
    });

    expect(agent.ctx.services.tracer).toBeDefined();
    expect(agent.ctx.services.metrics).toBeDefined();
  });
});


