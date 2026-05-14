import { describe, it, expect } from 'vitest';
import { InMemoryTaskStore } from '../../src/a2a/task-store.js';
import type {
  A2ATask,
  A2AMessage,
  A2ATaskState,
  A2APart,
} from '../../src/a2a/types.js';

function textPart(text: string): A2APart {
  return { kind: 'text', text };
}

function userMessage(parts: A2APart[]): A2AMessage {
  return {
    kind: 'message',
    messageId: `msg-${Date.now()}`,
    role: 'user',
    parts,
    contextId: 'ctx-1',
  };
}

describe('InMemoryTaskStore', () => {
  it('creates a task with submitted state', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    expect(task.id).toBeDefined();
    expect(task.contextId).toBe('ctx-1');
    expect(task.status.state).toBe('submitted');
    expect(task.history).toEqual([]);
    expect(task.artifacts).toEqual([]);
  });

  it('retrieves a task by id', async () => {
    const store = new InMemoryTaskStore();
    const created = await store.create('ctx-1');

    const retrieved = await store.get(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
  });

  it('returns undefined for non-existent task', async () => {
    const store = new InMemoryTaskStore();
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('updates task state with valid transition', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    await store.updateStatus(task.id, 'working');
    const updated = await store.get(task.id);
    expect(updated!.status.state).toBe('working');
  });

  it('rejects invalid state transition', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    await expect(store.updateStatus(task.id, 'completed')).rejects.toThrow(
      /invalid transition/i,
    );
  });

  it('allows terminal states from working', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    await store.updateStatus(task.id, 'working');
    await store.updateStatus(task.id, 'completed');

    const updated = await store.get(task.id);
    expect(updated!.status.state).toBe('completed');
  });

  it('allows input-required from working', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    await store.updateStatus(task.id, 'working');
    await store.updateStatus(task.id, 'input-required');

    const updated = await store.get(task.id);
    expect(updated!.status.state).toBe('input-required');
  });

  it('resumes from input-required to working', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    await store.updateStatus(task.id, 'working');
    await store.updateStatus(task.id, 'input-required');
    await store.updateStatus(task.id, 'working');

    const updated = await store.get(task.id);
    expect(updated!.status.state).toBe('working');
  });

  it('adds message to task history', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');
    const msg = userMessage([textPart('hello')]);

    await store.addMessage(task.id, msg);
    const updated = await store.get(task.id);
    expect(updated!.history).toHaveLength(1);
    expect(updated!.history![0].messageId).toBe(msg.messageId);
  });

  it('adds artifact to task', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    const artifact = {
      artifactId: 'art-1',
      parts: [textPart('result')],
    };
    await store.addArtifact(task.id, artifact);

    const updated = await store.get(task.id);
    expect(updated!.artifacts).toHaveLength(1);
    expect(updated!.artifacts![0].artifactId).toBe('art-1');
  });

  it('cancels a working task', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    await store.updateStatus(task.id, 'working');
    await store.cancel(task.id);

    const updated = await store.get(task.id);
    expect(updated!.status.state).toBe('canceled');
  });

  it('rejects cancel on terminal task', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    await store.updateStatus(task.id, 'working');
    await store.updateStatus(task.id, 'completed');

    await expect(store.cancel(task.id)).rejects.toThrow(/cannot cancel/i);
  });

  it('lists tasks by context', async () => {
    const store = new InMemoryTaskStore();
    const t1 = await store.create('ctx-a');
    const t2 = await store.create('ctx-a');
    await store.create('ctx-b');

    const tasks = await store.listByContext('ctx-a');
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.id)).toContain(t1.id);
    expect(tasks.map((t) => t.id)).toContain(t2.id);
  });
});

describe('Task state machine', () => {
  const validTransitions: Array<[A2ATaskState, A2ATaskState]> = [
    ['submitted', 'working'],
    ['submitted', 'rejected'],
    ['working', 'completed'],
    ['working', 'failed'],
    ['working', 'canceled'],
    ['working', 'input-required'],
    ['working', 'auth-required'],
    ['input-required', 'working'],
    ['auth-required', 'working'],
  ];

  it.each(validTransitions)('allows %s → %s', async (from, to) => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    if (from !== 'submitted') {
      await store.updateStatus(task.id, 'working');
      if (from !== 'working') {
        await store.updateStatus(task.id, from);
      }
    }

    await expect(store.updateStatus(task.id, to)).resolves.toBeDefined();
  });

  const invalidFromTerminal: A2ATaskState[] = ['completed', 'failed', 'canceled', 'rejected'];
  it.each(invalidFromTerminal)('blocks any transition from terminal %s', async (terminal) => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');

    // rejected is only reachable from submitted, not from working
    if (terminal === 'rejected') {
      await store.updateStatus(task.id, 'rejected');
    } else {
      await store.updateStatus(task.id, 'working');
      await store.updateStatus(task.id, terminal);
    }

    await expect(store.updateStatus(task.id, 'working')).rejects.toThrow(/invalid transition/i);
  });
});
