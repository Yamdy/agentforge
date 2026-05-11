import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManagerImpl } from '../src/task-manager.js';
import { EventBus } from '../src/event-bus.js';
import { ConcurrencyController } from '../src/concurrency-controller.js';
import type {
  AsyncTaskHandle,
  SubAgentResult,
  AsyncTaskConfig,
} from '@agentforge/sdk';

function createMockRunAgent() {
  return vi.fn(
    async (
      _config: unknown,
      input: string,
      _signal?: AbortSignal,
    ): Promise<SubAgentResult> => ({
      response: `Result for: ${input}`,
      tokenUsage: { input: 10, output: 20 },
      sessionId: crypto.randomUUID(),
    }),
  );
}

function createFailingRunAgent(error: Error) {
  return vi.fn(
    async (
      _config: unknown,
      _input: string,
      _signal?: AbortSignal,
    ): Promise<SubAgentResult> => {
      throw error;
    },
  );
}

describe('TaskManager', () => {
  it('launch returns handle with taskId and pending status', async () => {
    const manager = new TaskManagerImpl({
      runAgentFn: createMockRunAgent(),
    });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'do something',
    );

    expect(handle.taskId).toBeDefined();
    expect(typeof handle.taskId).toBe('string');
    // Status transitions quickly to running, but initially it was pending
    expect(['pending', 'running', 'completed']).toContain(handle.status);
  });

  it('tracer bullet: launch runs sub-agent, emits task:start/task:end, on_complete fires', async () => {
    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('task:start', (data) =>
      events.push({ type: 'task:start', data }),
    );
    eventBus.subscribe('task:end', (data) =>
      events.push({ type: 'task:end', data }),
    );

    const mockRunAgent = createMockRunAgent();
    const manager = new TaskManagerImpl({
      eventBus,
      runAgentFn: mockRunAgent,
    });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'do something',
    );

    // Wait for completion via on_complete
    const result = await new Promise<SubAgentResult>((resolve) =>
      handle.on_complete(resolve),
    );

    expect(result.response).toBe('Result for: do something');
    expect(events.map((e) => e.type)).toEqual(['task:start', 'task:end']);

    // Verify event data
    expect((events[0].data as any).taskId).toBe(handle.taskId);
    expect((events[1].data as any).taskId).toBe(handle.taskId);
    expect((events[1].data as any).result.response).toBe(
      'Result for: do something',
    );
  });

  it('handle transitions to completed with result', async () => {
    const manager = new TaskManagerImpl({
      runAgentFn: createMockRunAgent(),
    });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'hello',
    );

    // Wait for completion
    await new Promise<SubAgentResult>((resolve) =>
      handle.on_complete(resolve),
    );

    expect(handle.status).toBe('completed');
    expect(handle.result).toBeDefined();
    expect(handle.result!.response).toBe('Result for: hello');
    expect(handle.result!.tokenUsage).toEqual({ input: 10, output: 20 });
  });

  it('handle transitions to failed on error', async () => {
    const manager = new TaskManagerImpl({
      runAgentFn: createFailingRunAgent(new Error('Agent exploded')),
    });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'fail please',
    );

    // Wait for failure via a small delay or polling
    await new Promise<void>((resolve) => {
      const check = () => {
        if (handle.status === 'failed' || handle.status === 'completed') {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    expect(handle.status).toBe('failed');
    expect(handle.error).toBeInstanceOf(Error);
    expect(handle.error!.message).toBe('Agent exploded');
  });

  it('cancel sets status to cancelled', async () => {
    // Create a runAgentFn that delays, giving us time to cancel
    const mockRunAgent = vi.fn(
      async (
        _config: unknown,
        _input: string,
        signal?: AbortSignal,
      ): Promise<SubAgentResult> => {
        return new Promise<SubAgentResult>((_resolve, reject) => {
          const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener('abort', onAbort, { once: true });
          // Also resolve after long delay in case abort never fires
          setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            _resolve({
              response: 'done',
              tokenUsage: { input: 0, output: 0 },
              sessionId: crypto.randomUUID(),
            });
          }, 5000);
        });
      },
    );

    const manager = new TaskManagerImpl({ runAgentFn: mockRunAgent });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'long task',
    );

    expect(['pending', 'running']).toContain(handle.status);
    handle.cancel();

    // Wait a tick for async handling
    await new Promise((r) => setTimeout(r, 50));

    expect(handle.status).toBe('cancelled');
  });

  it('get returns handle by taskId, undefined for unknown', async () => {
    const manager = new TaskManagerImpl({
      runAgentFn: createMockRunAgent(),
    });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'test',
    );

    // Wait for completion
    await new Promise<SubAgentResult>((resolve) =>
      handle.on_complete(resolve),
    );

    expect(manager.get(handle.taskId)).toBe(handle);
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  it('list returns all handles', async () => {
    const manager = new TaskManagerImpl({
      runAgentFn: createMockRunAgent(),
    });

    const h1 = await manager.launch(
      { name: 'a', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'task a',
    );
    const h2 = await manager.launch(
      { name: 'b', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'task b',
    );

    // Wait for both to complete
    await Promise.all([
      new Promise<SubAgentResult>((resolve) => h1.on_complete(resolve)),
      new Promise<SubAgentResult>((resolve) => h2.on_complete(resolve)),
    ]);

    const handles = manager.list();
    expect(handles).toHaveLength(2);
    const ids = handles.map((h) => h.taskId);
    expect(ids).toContain(h1.taskId);
    expect(ids).toContain(h2.taskId);
  });

  it('multiple on_complete handlers all fire', async () => {
    const manager = new TaskManagerImpl({
      runAgentFn: createMockRunAgent(),
    });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'multi handler',
    );

    const results: SubAgentResult[] = [];
    handle.on_complete((r) => results.push(r));
    handle.on_complete((r) => results.push(r));

    // Wait for all
    await new Promise<void>((resolve) => {
      const check = () => {
        if (results.length === 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(results).toHaveLength(2);
    expect(results[0].response).toBe('Result for: multi handler');
    expect(results[1].response).toBe('Result for: multi handler');
  });

  it('emits task:error on failure', async () => {
    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('task:error', (data) =>
      events.push({ type: 'task:error', data }),
    );

    const manager = new TaskManagerImpl({
      eventBus,
      runAgentFn: createFailingRunAgent(new Error('boom')),
    });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'fail',
    );

    // Wait for failure
    await new Promise<void>((resolve) => {
      const check = () => {
        if (handle.status === 'failed') resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(events).toHaveLength(1);
    expect((events[0].data as any).taskId).toBe(handle.taskId);
    expect((events[0].data as any).error.message).toBe('boom');
  });

  it('concurrencySlot limits parallel execution', async () => {
    const concurrencyController = new ConcurrencyController([
      { key: 'limited', maxConcurrent: 1 },
    ]);

    let activeCount = 0;
    let maxActive = 0;

    const slowRunAgent = vi.fn(
      async (
        _config: unknown,
        input: string,
        _signal?: AbortSignal,
      ): Promise<SubAgentResult> => {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        // Small delay to ensure overlap detection
        await new Promise((r) => setTimeout(r, 50));
        activeCount--;
        return {
          response: `Done: ${input}`,
          tokenUsage: { input: 1, output: 1 },
          sessionId: crypto.randomUUID(),
        };
      },
    );

    const manager = new TaskManagerImpl({
      runAgentFn: slowRunAgent,
      concurrencyController,
    });

    const config: AsyncTaskConfig = {
      name: 'test',
      contextPolicy: 'isolated',
      concurrencySlot: { key: 'limited', maxConcurrent: 1 },
    };

    const h1 = await manager.launch(config, 'task 1');
    const h2 = await manager.launch(config, 'task 2');

    await Promise.all([
      new Promise<SubAgentResult>((resolve) => h1.on_complete(resolve)),
      new Promise<SubAgentResult>((resolve) => h2.on_complete(resolve)),
    ]);

    expect(maxActive).toBe(1);
    expect(h1.status).toBe('completed');
    expect(h2.status).toBe('completed');
  });

  it('list with filter by parentSessionId', async () => {
    const manager = new TaskManagerImpl({
      runAgentFn: createMockRunAgent(),
    });

    const h1 = await manager.launch(
      {
        name: 'a',
        contextPolicy: 'isolated',
        parentSessionId: 'session-1',
      } as AsyncTaskConfig & { parentSessionId: string },
      'task a',
    );
    const h2 = await manager.launch(
      {
        name: 'b',
        contextPolicy: 'isolated',
        parentSessionId: 'session-2',
      } as AsyncTaskConfig & { parentSessionId: string },
      'task b',
    );

    // Wait for both to complete
    await Promise.all([
      new Promise<SubAgentResult>((resolve) => h1.on_complete(resolve)),
      new Promise<SubAgentResult>((resolve) => h2.on_complete(resolve)),
    ]);

    const filtered = manager.list({ parentSessionId: 'session-1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].taskId).toBe(h1.taskId);
  });

  it('cancel via manager.cancel(taskId)', async () => {
    const mockRunAgent = vi.fn(
      async (
        _config: unknown,
        _input: string,
        signal?: AbortSignal,
      ): Promise<SubAgentResult> => {
        return new Promise<SubAgentResult>((_resolve, reject) => {
          const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener('abort', onAbort, { once: true });
          setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            _resolve({
              response: 'done',
              tokenUsage: { input: 0, output: 0 },
              sessionId: crypto.randomUUID(),
            });
          }, 5000);
        });
      },
    );

    const manager = new TaskManagerImpl({ runAgentFn: mockRunAgent });

    const handle = await manager.launch(
      { name: 'test', contextPolicy: 'isolated' } as AsyncTaskConfig,
      'task',
    );

    manager.cancel(handle.taskId);

    await new Promise((r) => setTimeout(r, 50));

    expect(handle.status).toBe('cancelled');
  });
});
