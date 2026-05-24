import { describe, it, expect } from 'vitest';
import { serialize, deserialize, SerializationVersionError, migrate_v1_to_v2 } from '../src/serialize.js';
import type { SerializableContext } from '../src/serialize.js';
import type { PipelineContext } from '@primo-ai/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    agent: {
      config: { model: 'test/model' },
      systemPrompt: 'You are helpful',
      toolDeclarations: [{ name: 'echo', description: 'echo tool' }],
      promptFragments: ['fragment-1'],
    },
    iteration: {
      step: 3,
      loopDirective: { action: 'stop' },
      response: 'done',
      tokenUsage: { input: 100, output: 50 },
      reasoningContent: 'thinking...',
      toolResults: [{ toolCallId: 'c1', name: 'echo', output: 'hello' }],
      pendingToolCalls: [{ id: 'c2', name: 'read', args: { path: '/tmp' } }],
    },
    session: {
      input: 'hello',
      sessionId: 'sess-1',
      messageHistory: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', toolCalls: [{ id: 'c1', name: 'echo', args: {} }] },
      ],
      totalTokenUsage: { input: 200, output: 100 },
      custom: { pluginX: { data: 42 } },
    },
    ...overrides,
  };
}

describe('serialize', () => {
  it('strips non-serializable fields (fullStream, usagePromise, reasoningPromise, span)', () => {
    const ctx = makeContext();

    const serialized = serialize(ctx);
    const iter = serialized.iteration as unknown as Record<string, unknown>;

    expect(iter['fullStream']).toBeUndefined();
    expect(iter['usagePromise']).toBeUndefined();
    expect(iter['reasoningPromise']).toBeUndefined();
    expect(iter['span']).toBeUndefined();
  });

  it('preserves all serializable fields', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);

    expect(serialized.agent.config).toEqual({ model: 'test/model' });
    expect(serialized.agent.promptFragments).toEqual(['fragment-1']);
    expect(serialized.iteration.step).toBe(3);
    expect(serialized.iteration.response).toBe('done');
    expect(serialized.session.messageHistory).toHaveLength(2);
    expect(serialized.session.custom).toEqual({ pluginX: { data: 42 } });
  });

  it('produces JSON-serializable output', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const json = JSON.stringify(serialized);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('deserialize', () => {
  it('reconstructs a valid PipelineContext', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const restored = deserialize(serialized);

    expect(restored.session.input).toBe('hello');
    expect(restored.agent.config).toEqual(ctx.agent.config);
    expect(restored.agent.promptFragments).toEqual(ctx.agent.promptFragments);
    expect(restored.iteration.step).toBe(3);
    expect(restored.session.messageHistory).toEqual(ctx.session.messageHistory);
  });

  it('round-trip preserves data through serialize then deserialize', () => {
    const ctx = makeContext();
    const json = JSON.stringify(serialize(ctx));
    const restored = deserialize(JSON.parse(json));

    expect(restored.session.input).toBe('hello');
    expect(restored.agent.toolDeclarations).toEqual([{ name: 'echo', description: 'echo tool' }]);
    expect(restored.iteration.loopDirective).toEqual({ action: 'stop' });
    expect(restored.session.totalTokenUsage).toEqual({ input: 200, output: 100 });
  });
});

// ============================================================
// C4: Serialization Versioning
// ============================================================

describe('serialize versioning', () => {
  it('includes version: 2 in serialized output', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);

    expect(serialized).toHaveProperty('version');
    expect(serialized.version).toBe(2);
  });

  it('version 2 round-trips through deserialize', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const restored = deserialize(serialized);

    expect(restored.session.input).toBe('hello');
    expect(restored.iteration.response).toBe('done');
  });

  it('treats missing version field as v1 (backward compat)', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    // Simulate legacy data — strip version
    const { version, ...legacyData } = serialized as SerializableContext & { version: number };

    // Should not throw
    const restored = deserialize(legacyData);
    expect(restored.session.input).toBe('hello');
  });

  it('throws SerializationVersionError for unknown future version (e.g. 42)', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const futureData = { ...serialized, version: 42 };

    expect(() => deserialize(futureData)).toThrow(SerializationVersionError);
  });

  it('SerializationVersionError extends AgentForgeError', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const futureData = { ...serialized, version: 99 };

    try {
      deserialize(futureData);
      // Force fail if no error was thrown
      expect.fail('Expected SerializationVersionError to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).toBe('SerializationVersionError');
      // Check message includes the unsupported version
      expect((e as Error).message).toContain('99');
    }
  });

  it('version field survives JSON round-trip', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(2);
  });
});

describe('migrate_v1_to_v2', () => {
  it('is a function', () => {
    expect(typeof migrate_v1_to_v2).toBe('function');
  });

  it('accepts and returns a SerializableContext unchanged', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const result = migrate_v1_to_v2(serialized);
    expect(result).toBe(serialized);
  });
});
