/**
 * Tests for createAgent preset activation
 *
 * Verifies that the correct preset operator is applied
 * when config.preset is set to 'debug', 'test', or 'production'.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { of, type Observable } from 'rxjs';
import type { AgentEvent, MonoTypeOperatorFunction } from 'rxjs';
import type { AgentContext } from '../../src/core/index.js';

// Mock the operators module — we spy on preset functions
const mockDebugPreset = vi.fn(
  (): MonoTypeOperatorFunction<AgentEvent> => source => source
);
const mockTestPreset = vi.fn(
  (): MonoTypeOperatorFunction<AgentEvent> => source => source
);
const mockProductionPreset = vi.fn(
  (): MonoTypeOperatorFunction<AgentEvent> => source => source
);

vi.mock('../../src/operators/index.js', () => ({
  debugPreset: (...args: unknown[]) => mockDebugPreset(...args),
  testPreset: (...args: unknown[]) => mockTestPreset(...args),
  productionPreset: (...args: unknown[]) => mockProductionPreset(...args),
  timeoutOnEventType: () => (source: Observable<AgentEvent>) => source,
  retryOnEventType: () => (source: Observable<AgentEvent>) => source,
}));

// Mock the loop module — return a minimal observable
vi.mock('../../src/loop/index.js', () => ({
  createAgentLoop: () => ({
    run: (_input: string) =>
      of({ type: 'done', reason: 'completed', timestamp: Date.now(), sessionId: 'test' } as AgentEvent),
    getCurrentState: () => null,
    destroy$: of(void 0),
  }),
}));

// Mock the adapters module
vi.mock('../../src/adapters/index.js', () => ({
  createLLMAdapter: () => ({
    name: 'mock',
    provider: 'mock',
    chat: async () => ({ content: 'ok', finishReason: 'stop' }),
    stream: () => of({ type: 'text', delta: 'ok' }),
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
    // Provide tracer/metrics/checkpoint so production preset can activate
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
    await agent.run$('hello').toPromise();

    expect(mockDebugPreset).toHaveBeenCalledOnce();
    expect(mockTestPreset).not.toHaveBeenCalled();
    expect(mockProductionPreset).not.toHaveBeenCalled();
  });

  it('applies testPreset when preset is "test"', async () => {
    const agent = createAgent(makeAgentConfig('test'));
    await agent.run$('hello').toPromise();

    expect(mockTestPreset).toHaveBeenCalledOnce();
    expect(mockDebugPreset).not.toHaveBeenCalled();
    expect(mockProductionPreset).not.toHaveBeenCalled();
  });

  it('applies productionPreset when preset is "production" and services are configured', async () => {
    const agent = createAgent(makeAgentConfig('production'));
    await agent.run$('hello').toPromise();

    expect(mockProductionPreset).toHaveBeenCalledOnce();
    expect(mockDebugPreset).not.toHaveBeenCalled();
    expect(mockTestPreset).not.toHaveBeenCalled();
  });

  it('does not apply any preset when preset is undefined', async () => {
    const agent = createAgent(makeAgentConfig(undefined));
    await agent.run$('hello').toPromise();

    expect(mockDebugPreset).not.toHaveBeenCalled();
    expect(mockTestPreset).not.toHaveBeenCalled();
    expect(mockProductionPreset).not.toHaveBeenCalled();
  });

  it('passes correct config to productionPreset', async () => {
    const agent = createAgent(makeAgentConfig('production'));
    await agent.run$('hello').toPromise();

    expect(mockProductionPreset).toHaveBeenCalledOnce();
    const callArg = mockProductionPreset.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    expect(callArg).toHaveProperty('tracer');
    expect(callArg).toHaveProperty('metrics');
    expect(callArg).toHaveProperty('checkpointStorage');
    expect(callArg).toHaveProperty('sessionId');
  });
});
