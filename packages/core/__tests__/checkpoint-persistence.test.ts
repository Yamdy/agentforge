import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent, type AgentDependencies } from '../src/agent.js';
import { JsonlCheckpointStore } from '../src/checkpoint-store.js';
import { InMemoryCheckpointStore } from '../src/checkpoint-store.js';

describe('Checkpoint persistence (P0)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Agent with checkpointDir uses JsonlCheckpointStore', () => {
    const deps: AgentDependencies = { checkpointDir: dir };
    const agent = new Agent({ model: 'mock/test' }, deps);

    const store = (agent as any).orchestrator.checkpointStore;
    expect(store).toBeInstanceOf(JsonlCheckpointStore);
  });

  it('Agent without checkpointDir defaults to InMemoryCheckpointStore', () => {
    const agent = new Agent({ model: 'mock/test' });

    const store = (agent as any).orchestrator.checkpointStore;
    expect(store).toBeInstanceOf(InMemoryCheckpointStore);
  });

  it('JsonlCheckpointStore persists data across instances', async () => {
    const store1 = new JsonlCheckpointStore(dir);
    await store1.save('session-1', { step: 5, status: 'paused' });

    const store2 = new JsonlCheckpointStore(dir);
    const loaded = await store2.load('session-1');

    expect(loaded).toEqual({ step: 5, status: 'paused' });
  });

  it('explicit checkpointStore overrides checkpointDir', () => {
    const explicit = new InMemoryCheckpointStore<ReturnType<typeof import('../src/serialize.js').serialize>>();
    const deps: AgentDependencies = { checkpointDir: dir, checkpointStore: explicit };
    const agent = new Agent({ model: 'mock/test' }, deps);

    const store = (agent as any).orchestrator.checkpointStore;
    expect(store).toBe(explicit);
  });
});
