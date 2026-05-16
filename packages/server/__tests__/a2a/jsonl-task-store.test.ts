import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonlTaskStore } from '../../src/a2a/jsonl-task-store.js';
import type { A2AArtifact } from '../../src/a2a/types.js';

describe('JsonlTaskStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'a2a-task-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('create() writes task and returns it', async () => {
    const store = new JsonlTaskStore(dir);
    const task = await store.create('ctx-1');

    expect(task.id).toBeDefined();
    expect(task.contextId).toBe('ctx-1');
    expect(task.status.state).toBe('submitted');
  });

  it('get() retrieves a created task', async () => {
    const store = new JsonlTaskStore(dir);
    const created = await store.create('ctx-1');
    const loaded = await store.get(created.id);

    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(created.id);
    expect(loaded!.contextId).toBe('ctx-1');
  });

  it('get() returns undefined for nonexistent task', async () => {
    const store = new JsonlTaskStore(dir);
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('updateStatus() transitions state and persists', async () => {
    const store = new JsonlTaskStore(dir);
    const task = await store.create('ctx-1');
    const updated = await store.updateStatus(task.id, 'working');

    expect(updated.status.state).toBe('working');
  });

  it('addArtifact() persists artifact on task', async () => {
    const store = new JsonlTaskStore(dir);
    const task = await store.create('ctx-1');
    await store.updateStatus(task.id, 'working');

    const artifact: A2AArtifact = {
      artifactId: 'art-1',
      parts: [{ kind: 'text', text: 'result' }],
    };
    await store.addArtifact(task.id, artifact);

    const loaded = await store.get(task.id);
    expect(loaded!.artifacts).toHaveLength(1);
    expect(loaded!.artifacts![0].artifactId).toBe('art-1');
  });

  it('cancel() transitions to canceled state', async () => {
    const store = new JsonlTaskStore(dir);
    const task = await store.create('ctx-1');
    await store.updateStatus(task.id, 'working');

    const canceled = await store.cancel(task.id);
    expect(canceled.status.state).toBe('canceled');
  });

  it('listByContext() filters by contextId', async () => {
    const store = new JsonlTaskStore(dir);
    await store.create('ctx-a');
    await store.create('ctx-a');
    await store.create('ctx-b');

    const list = await store.listByContext('ctx-a');
    expect(list).toHaveLength(2);
  });

  it('persists across restart — new store instance reads existing data', async () => {
    const store1 = new JsonlTaskStore(dir);
    const task = await store1.create('ctx-1');
    await store1.updateStatus(task.id, 'working');
    await store1.addArtifact(task.id, {
      artifactId: 'art-1',
      parts: [{ kind: 'text', text: 'hello' }],
    });

    const store2 = new JsonlTaskStore(dir);
    await store2.restore();

    const loaded = await store2.get(task.id);
    expect(loaded).toBeDefined();
    expect(loaded!.status.state).toBe('working');
    expect(loaded!.artifacts).toHaveLength(1);
    expect(loaded!.artifacts![0].artifactId).toBe('art-1');
  });

  it('rejects invalid state transition', async () => {
    const store = new JsonlTaskStore(dir);
    const task = await store.create('ctx-1');
    await store.updateStatus(task.id, 'working');
    await store.updateStatus(task.id, 'completed');

    await expect(store.updateStatus(task.id, 'working')).rejects.toThrow(/Invalid transition/);
  });

  // --- Path safety ---

  it('rejects taskId with path traversal ../ in get()', async () => {
    const store = new JsonlTaskStore(dir);
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/invalid/i);
  });

  it('rejects taskId with path traversal ..\\ in updateStatus()', async () => {
    const store = new JsonlTaskStore(dir);
    await expect(store.updateStatus('..\\etc\\passwd', 'working')).rejects.toThrow(/invalid/i);
  });

  it('rejects taskId with special characters in cancel()', async () => {
    const store = new JsonlTaskStore(dir);
    await expect(store.cancel('task|evil')).rejects.toThrow(/invalid/i);
  });

  it('rejects taskId with null bytes in addArtifact()', async () => {
    const store = new JsonlTaskStore(dir);
    await expect(
      store.addArtifact('task\x00evil', { artifactId: 'a', parts: [] }),
    ).rejects.toThrow(/invalid/i);
  });

  // --- Atomic write verification ---

  it('uses atomic write (no .tmp files left after operations)', async () => {
    const store = new JsonlTaskStore(dir);
    const task = await store.create('ctx-1');
    await store.updateStatus(task.id, 'working');

    const { readdirSync } = await import('node:fs');
    const files = readdirSync(dir);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  // --- addMessage persistence ---

  it('addMessage() persists message across restore', async () => {
    const store1 = new JsonlTaskStore(dir);
    const task = await store1.create('ctx-1');
    await store1.updateStatus(task.id, 'working');
    await store1.addMessage(task.id, {
      kind: 'message',
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'hello' }],
    });

    const store2 = new JsonlTaskStore(dir);
    await store2.restore();

    const loaded = await store2.get(task.id);
    expect(loaded!.history).toHaveLength(1);
    expect(loaded!.history![0].messageId).toBe('msg-1');
  });

  // --- cancel persistence ---

  it('cancel() persists across restore', async () => {
    const store1 = new JsonlTaskStore(dir);
    const task = await store1.create('ctx-1');
    await store1.updateStatus(task.id, 'working');
    await store1.cancel(task.id);

    const store2 = new JsonlTaskStore(dir);
    await store2.restore();

    const loaded = await store2.get(task.id);
    expect(loaded!.status.state).toBe('canceled');
  });
});
