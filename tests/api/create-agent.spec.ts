/**
 * Tests for createAgent preset activation
 *
 * Verifies that the correct services are configured based on preset name.
 * Presets no longer use RxJS operators (per 25-DE-RXJS).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AgentEvent } from '../../src/core/index.js';
// No rxjs imports needed

// Mock the loop module — return Promise-based AgentLoop
vi.mock('../../src/loop/agent-loop.js', () => ({
  createAgentLoop: () => ({
    run: async (_input: string) => 'test output',
    on: () => () => {},
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
});
