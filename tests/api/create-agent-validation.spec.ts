/**
 * Tests for createAgent configuration validation.
 *
 * Verifies that createAgent() throws AgentConfigError when
 * permissionPolicy is set without permissionController.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionPolicy, PermissionController } from '../../src/core/interfaces.js';

// Track calls to loop.on for mock verification
const onCalls: Array<[string, (...args: unknown[]) => void]> = [];

// Mock the loop module
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
import { AgentConfigError } from '../../src/api/types.js';

// ============================================================
// Minimal mocks
// ============================================================

const mockPermissionPolicy: PermissionPolicy = {
  riskPolicies: {} as PermissionPolicy['riskPolicies'],
  defaultPolicy: 'allow' as PermissionPolicy['defaultPolicy'],
  toolPolicies: {} as PermissionPolicy['toolPolicies'],
  enforceApprovalFlag: false,
};

const mockPermissionController: PermissionController = {
  ask: async () => 'allow',
  onAsk: () => () => {},
  answer: () => {},
  isAutoAllowed: () => false,
};

// ============================================================
// Helpers
// ============================================================

function makeConfig() {
  return {
    name: 'test-agent',
    model: { provider: 'mock', model: 'mock-model' } as const,
    maxSteps: 1,
  };
}

// ============================================================
// Tests
// ============================================================

describe('createAgent — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onCalls.length = 0;
  });

  it('throws AgentConfigError when permissionPolicy is set without permissionController', () => {
    expect(() =>
      createAgent(makeConfig(), {
        permissionPolicy: mockPermissionPolicy,
      } as Record<string, unknown>)
    ).toThrow(AgentConfigError);

    expect(() =>
      createAgent(makeConfig(), {
        permissionPolicy: mockPermissionPolicy,
      } as Record<string, unknown>)
    ).toThrow(/permissionPolicy requires permissionController/);
  });

  it('succeeds when permissionPolicy is set with permissionController', () => {
    expect(() =>
      createAgent(makeConfig(), {
        permissionPolicy: mockPermissionPolicy,
        permissionController: mockPermissionController,
      } as Record<string, unknown>)
    ).not.toThrow();
  });

  it('succeeds when no permission config is set (backward compat)', () => {
    expect(() => createAgent(makeConfig())).not.toThrow();
  });
});
