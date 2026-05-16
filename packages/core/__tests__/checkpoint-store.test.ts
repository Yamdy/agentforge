import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryCheckpointStore, JsonlCheckpointStore } from '../src/checkpoint-store.js';
import { serialize, deserialize } from '../src/serialize.js';
import type { PipelineContext } from '@agentforge/sdk';

type Serialized = ReturnType<typeof serialize>;

function makeContext(overrides?: Partial<PipelineContext['iteration']>): PipelineContext {
  return {
    request: { input: 'hello', sessionId: 'test' },
    agent: { config: { model: 'test' }, toolDeclarations: [], promptFragments: [] },
    iteration: { step: 0, loopDirective: undefined, ...overrides },
    session: { messageHistory: [], custom: {} },
  };
}

describe('InMemoryCheckpointStore', () => {
  it('save and load round-trip', async () => {
    const store = new InMemoryCheckpointStore<Serialized>();
    const ctx = makeContext();
    const serialized = serialize(ctx);

    await store.save('s1', serialized);
    const loaded = await store.load('s1');

    expect(loaded).toEqual(serialized);
  });

  it('load returns undefined for missing session', async () => {
    const store = new InMemoryCheckpointStore<Serialized>();
    expect(await store.load('nonexistent')).toBeUndefined();
  });

  it('delete removes saved checkpoint', async () => {
    const store = new InMemoryCheckpointStore<Serialized>();
    await store.save('s1', serialize(makeContext()));
    await store.delete('s1');
    expect(await store.load('s1')).toBeUndefined();
  });

  it('list returns all session IDs', async () => {
    const store = new InMemoryCheckpointStore<Serialized>();
    await store.save('s1', serialize(makeContext()));
    await store.save('s2', serialize(makeContext()));
    const ids = await store.list();
    expect(ids.sort()).toEqual(['s1', 's2']);
  });

  it('save overwrites existing checkpoint', async () => {
    const store = new InMemoryCheckpointStore<Serialized>();
    await store.save('s1', serialize(makeContext({ step: 1 })));
    await store.save('s1', serialize(makeContext({ step: 2 })));
    const loaded = await store.load('s1');
    const deserialized = deserialize(loaded!);
    expect(deserialized.iteration.step).toBe(2);
  });
});

describe('JsonlCheckpointStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'checkpoint-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('save and load round-trip', async () => {
    const store = new JsonlCheckpointStore<Serialized>(dir);
    const ctx = makeContext();
    const serialized = serialize(ctx);

    await store.save('s1', serialized);
    const loaded = await store.load('s1');

    expect(loaded).toEqual(serialized);
  });

  it('load returns undefined for missing session', async () => {
    const store = new JsonlCheckpointStore<Serialized>(dir);
    expect(await store.load('nonexistent')).toBeUndefined();
  });

  it('delete removes file', async () => {
    const store = new JsonlCheckpointStore<Serialized>(dir);
    await store.save('s1', serialize(makeContext()));
    await store.delete('s1');
    expect(await store.load('s1')).toBeUndefined();
  });

  it('list returns session IDs', async () => {
    const store = new JsonlCheckpointStore<Serialized>(dir);
    await store.save('s1', serialize(makeContext()));
    await store.save('s2', serialize(makeContext()));
    const ids = await store.list();
    expect(ids.sort()).toEqual(['s1', 's2']);
  });

  it('survives process restart (re-read from disk)', async () => {
    const store1 = new JsonlCheckpointStore<Serialized>(dir);
    const ctx = makeContext({ step: 5, response: 'mid-response' });
    await store1.save('s1', serialize(ctx));

    // Simulate restart: new store instance pointing to same directory
    const store2 = new JsonlCheckpointStore<Serialized>(dir);
    const loaded = await store2.load('s1');
    const deserialized = deserialize(loaded!);

    expect(deserialized.iteration.step).toBe(5);
    expect(deserialized.iteration.response).toBe('mid-response');
    expect(deserialized.request.input).toBe('hello');
  });
});

describe('CheckpointStore integration — crash recovery', () => {
  it('InMemory: save → deserialize → runLoop-compatible context', async () => {
    const store = new InMemoryCheckpointStore<Serialized>();
    const ctx = makeContext({
      step: 3,
      response: 'partial work',
      loopDirective: { action: 'continue' },
    });

    // Simulate saving checkpoint mid-run
    await store.save('crash-session', serialize(ctx));

    // Simulate crash recovery: load and deserialize
    const loaded = await store.load('crash-session');
    expect(loaded).toBeDefined();
    const recovered = deserialize(loaded!);

    expect(recovered.iteration.step).toBe(3);
    expect(recovered.iteration.response).toBe('partial work');
    expect(recovered.request.input).toBe('hello');
    expect(recovered.session.messageHistory).toEqual([]);
  });

  it('Jsonl: full save → crash → load → resume flow', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'checkpoint-crash-'));
    try {
      // Phase 1: Original process saves checkpoint
      const store = new JsonlCheckpointStore<Serialized>(dir);
      const ctx = makeContext({
        step: 7,
        response: 'step 7 done',
      });
      await store.save('session-abc', serialize(ctx));

      // Phase 2: Simulate crash — new store instance from same dir
      const recoveredStore = new JsonlCheckpointStore<Serialized>(dir);
      const checkpoint = await recoveredStore.load('session-abc');
      expect(checkpoint).toBeDefined();

      const recoveredCtx = deserialize(checkpoint!);
      expect(recoveredCtx.iteration.step).toBe(7);

      // Phase 3: Delete after successful resume (prevents double-resume)
      await recoveredStore.delete('session-abc');
      expect(await recoveredStore.load('session-abc')).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects path traversal in sessionId', async () => {
    const store = new JsonlCheckpointStore('/tmp/safe-dir');
    await expect(store.save('../etc/passwd', {} as unknown as Serialized)).rejects.toThrow('Invalid sessionId');
    await expect(store.load('../../secret')).rejects.toThrow('Invalid sessionId');
    await expect(store.delete('foo/bar')).rejects.toThrow('Invalid sessionId');
  });
});
