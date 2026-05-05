/**
 * ContextBuilder Unit Tests
 *
 * Tests for AgentContextBuilder.with() API and ContextBuilder.with() API.
 */

import { describe, it, expect } from 'vitest';

import type { LLMAdapter, ToolDefinition, MemoryStore } from '../../src/core/interfaces.js';
import { AgentContextBuilder, type ModelConfig } from '../../src/api/context-builder.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { InMemoryStore, DefaultPauseController } from '../../src/core/context.js';
import type { AgentContext } from '../../src/core/context.js';
import type { CompactionManager } from '../../src/memory/index.js';

// ============================================================
// Mock LLM Adapter
// ============================================================

function mockLLMAdapter(): LLMAdapter {
  return {
    provider: 'mock',
    name: 'mock-model',
    chat: async () => ({ role: 'assistant', content: 'ok' }),
    stream: async function* () { yield { content: 'ok' }; },
  };
}

const mockTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes input',
  parameters: { type: 'object', properties: {} },
  execute: async (args) => JSON.stringify(args ?? {}),
};

// ============================================================
// AgentContextBuilder.with() API Tests (L3)
// ============================================================

describe('AgentContextBuilder.with()', () => {
  it('sets required fields and builds successfully', () => {
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [mockTool] })
      .build();

    expect(ctx.llm.provider).toBe('mock');
    expect(ctx.tools.list()).toContain('echo');
  });

  it('sets identity fields', () => {
    const ctx = AgentContextBuilder.create()
      .with({ sessionId: 'my-session', agentName: 'my-agent', llm: mockLLMAdapter(), tools: [] })
      .build();

    expect(ctx.sessionId).toBe('my-session');
    expect(ctx.agentName).toBe('my-agent');
  });

  it('sets model config', () => {
    const builder = AgentContextBuilder.create()
      .with({ model: { provider: 'openai', model: 'gpt-4o' } as ModelConfig, llm: mockLLMAdapter(), tools: [] });

    // model is stored in state but not mapped to AgentContext
    // Just verify it doesn't throw
    expect(() => builder.build()).not.toThrow();
  });

  it('sets optional security fields', () => {
    const mockAudit = { append: () => {} } as unknown as AgentContext['security']['auditLogger'];
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [], auditLogger: mockAudit })
      .build();

    expect(ctx.auditLogger).toBe(mockAudit);
  });

  it('sets optional resilience fields', () => {
    const mockQuota = { check: () => true, consume: () => {}, getUsage: () => ({ tokenCount: 0, limit: 100 }) } as unknown as AgentContext['controls']['quota'];
    const mockBreaker = { recordSuccess: () => {}, recordFailure: () => {}, destroy: () => {} } as unknown as AgentContext['resilience']['circuitBreaker'];
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [], quota: mockQuota, circuitBreaker: mockBreaker })
      .build();

    expect(ctx.quota).toBe(mockQuota);
    expect(ctx.circuitBreaker).toBe(mockBreaker);
  });

  it('maps onError correctly', () => {
    const handler = () => {};
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [], onError: handler })
      .build();

    expect(ctx.onError).toBe(handler);
  });

  it('multiple with() calls merge incrementally (last wins)', () => {
    const ctx = AgentContextBuilder.create()
      .with({ sessionId: 'first', llm: mockLLMAdapter(), tools: [] })
      .with({ sessionId: 'second' })
      .build();

    expect(ctx.sessionId).toBe('second');
  });

  it('chaining with() and withTool() works', () => {
    const toolA: ToolDefinition = { name: 'a', description: 'A', parameters: {}, execute: async () => 'a' };
    const toolB: ToolDefinition = { name: 'b', description: 'B', parameters: {}, execute: async () => 'b' };

    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [toolA] })
      .withTool(toolB)
      .build();

    expect(ctx.tools.list()).toContain('a');
    expect(ctx.tools.list()).toContain('b');
  });

  it('throws when LLM is not set', () => {
    expect(() => AgentContextBuilder.create().with({ tools: [] }).build())
      .toThrow(/LLM adapter/i);
  });

  it('throws when tools are not set', () => {
    expect(() => AgentContextBuilder.create().with({ llm: mockLLMAdapter() }).build())
      .toThrow(/tools/i);
  });

  it('withDefaultHITL() sets a default controller', () => {
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [] })
      .withDefaultHITL()
      .build();

    expect(ctx.hitl).toBeDefined();
  });

  it('withAbortController() extracts signal', () => {
    const controller = new AbortController();
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [] })
      .withAbortController(controller)
      .build();

    expect(ctx.abortSignal).toBe(controller.signal);
  });

  it('tracer and metrics override appServices defaults', () => {
    const mockTracer = { recordException: () => {}, recordEvent: () => {} } as unknown as AgentContext['core']['services']['tracer'];
    const mockMetrics = { increment: () => {}, gauge: () => {} } as unknown as AgentContext['core']['services']['metrics'];

    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [], tracer: mockTracer, metrics: mockMetrics })
      .build();

    expect(ctx.services.tracer).toBe(mockTracer);
    expect(ctx.services.metrics).toBe(mockMetrics);
  });

  it('healthChecker is placed into services', () => {
    const checker = { check: () => Promise.resolve(true), ready: () => true, registerCheck: () => {} } as unknown as AgentContext['services']['healthChecker'];

    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [], healthChecker: checker })
      .build();

    expect(ctx.services.healthChecker).toBe(checker);
  });

  it('empty with({}) is safe and does not overwrite defaults', () => {
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [] })
      .with({})
      .build();

    expect(ctx.sessionId).toBeDefined();
    expect(ctx.agentName).toBe('agent');
    expect(ctx.memory).toBeDefined();
    expect(ctx.pauseController).toBeDefined();
  });

  it('provides a default compactionManager when none is specified', () => {
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [] })
      .build();

    expect(ctx.compactionManager).toBeDefined();
    const cfg = ctx.compactionManager?.getConfig();
    expect(cfg?.enabled).toBe(true);
    expect(cfg?.strategy).toBe('truncate-oldest');
  });

  it('allows overriding the default compactionManager', () => {
    const custom = { getConfig: () => ({ enabled: false, strategy: 'none' }), needsCompaction: () => false, compact: async () => ({ messages: [], removedCount: 0, tokensBefore: 0, tokensAfter: 0, strategy: 'truncate-oldest' as const }) } as unknown as CompactionManager;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const ctx = AgentContextBuilder.create()
      .with({ llm: mockLLMAdapter(), tools: [], compactionManager: custom })
      .build();

    expect(ctx.compactionManager).toBe(custom);
  });
});

// ============================================================
// ContextBuilder.with() API Tests (L2)
// ============================================================

describe('ContextBuilder.with()', () => {
  it('sets required fields and builds successfully', () => {
    const ctx = ContextBuilder.create()
      .with({ llm: mockLLMAdapter() })
      .withTools([mockTool])
      .build();

    expect(ctx.llm.provider).toBe('mock');
    expect(ctx.tools.list()).toContain('echo');
  });

  it('sets identity and optional fields', () => {
    const mem = new InMemoryStore();
    const pause = new DefaultPauseController();
    const ctx = ContextBuilder.create()
      .with({ sessionId: 'test', agentName: 'test-agent', llm: mockLLMAdapter(), memory: mem, pauseController: pause })
      .withTools([mockTool])
      .build();

    expect(ctx.sessionId).toBe('test');
    expect(ctx.agentName).toBe('test-agent');
    expect(ctx.memory).toBe(mem);
    expect(ctx.pauseController).toBe(pause);
  });

  it('sets onError directly (not errorHandler)', () => {
    const handler = () => {};
    const ctx = ContextBuilder.create()
      .with({ llm: mockLLMAdapter(), onError: handler })
      .withTools([mockTool])
      .build();

    expect(ctx.onError).toBe(handler);
  });

  it('multiple with() calls merge (last wins)', () => {
    const ctx = ContextBuilder.create()
      .with({ sessionId: 'first', llm: mockLLMAdapter() })
      .with({ sessionId: 'second' })
      .withTools([mockTool])
      .build();

    expect(ctx.sessionId).toBe('second');
  });

  it('withAppServices() sets services', () => {
    const schemaReg = { register: () => {}, validate: () => ({ success: true, data: {} }) } as unknown as AgentContext['services']['schemaRegistry'];
    const factory = { create: () => mockLLMAdapter(), listProviders: () => [], hasProvider: () => false } as unknown as AgentContext['services']['llmFactory'];
    const toolReg = { register: () => {}, list: () => [], get: () => undefined, getFunctionDefs: () => [], execute: async () => '' } as unknown as AgentContext['tools'];

    const appServices = { schemaRegistry: schemaReg, llmFactory: factory, toolRegistry: toolReg };
    const ctx = ContextBuilder.create()
      .withAppServices(appServices)
      .with({ llm: mockLLMAdapter() })
      .withTools([mockTool])
      .build();

    expect(ctx.services).toBe(appServices);
  });

  it('throws when LLM is missing', () => {
    expect(() => ContextBuilder.create().with({ tools: undefined as any }).build())
      .toThrow(/LLM/i);
  });

  it('throws when tools are missing', () => {
    expect(() => ContextBuilder.create().with({ llm: mockLLMAdapter() }).build())
      .toThrow(/ToolRegistry/i);
  });
});
