import { describe, it, expect, vi } from 'vitest';
import { TaskManagerImpl } from '../src/task-manager.js';
import { EventBus } from '../src/event-bus.js';
import type { SubAgentResult, AsyncTaskConfig } from '@primo-ai/sdk';

describe('TaskManager outer safety net', () => {
  /** Trigger the outer .catch() by making concurrencyController.acquire()
   * reject BEFORE the internal try/catch in executeTask. */
  function makeThrowingController(error: Error) {
    return {
      acquire: vi.fn().mockRejectedValue(error),
    };
  }

  function makeSuccessRunAgent() {
    return vi.fn(
      async (
        _config: unknown,
        _input: string,
        _signal?: AbortSignal,
      ): Promise<SubAgentResult> => ({
        response: 'ok',
        tokenUsage: { input: 10, output: 20 },
        sessionId: crypto.randomUUID(),
      }),
    );
  }

  const minConfig: AsyncTaskConfig = {
    name: 'test',
    contextPolicy: 'isolated',
  };

  /** A typed runAgentFn for tests where it's never called (concurrencyController
   *  rejects first, so executeTask never reaches runAgentFn). */
  const neverCalledRunAgent = async (
    _config: unknown,
    _input: string,
    _signal?: AbortSignal,
  ): Promise<SubAgentResult> => {
    throw new Error('should never be called');
  };

  /** Poll handle.status until it leaves pending/running. */
  async function waitForSettled(handle: { status: string }): Promise<void> {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (handle.status !== 'pending' && handle.status !== 'running') {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }

  // ---------------------------------------------------------------------------
  // Outer catch behaviour
  // ---------------------------------------------------------------------------

  it('sets status to failed when executeTask rejects', async () => {
    const manager = new TaskManagerImpl({
      concurrencyController: makeThrowingController(new Error('boom')) as any,
      runAgentFn: neverCalledRunAgent,
    });

    const handle = await manager.launch(
      { ...minConfig, concurrencySlot: { key: 'x', maxConcurrent: 1 } },
      'test',
    );

    await waitForSettled(handle);
    expect(handle.status).toBe('failed');
  });

  it('sets error when executeTask rejects', async () => {
    const manager = new TaskManagerImpl({
      concurrencyController: makeThrowingController(new Error('boom')) as any,
      runAgentFn: neverCalledRunAgent,
    });

    const handle = await manager.launch(
      { ...minConfig, concurrencySlot: { key: 'x', maxConcurrent: 1 } },
      'test',
    );

    await waitForSettled(handle);
    expect(handle.error).toBeInstanceOf(Error);
    expect(handle.error!.message).toBe('boom');
  });

  it("emits 'task:error' with correct taskId when executeTask rejects", async () => {
    const eventBus = new EventBus();
    const errorEvents: Array<{ taskId: string; error: Error }> = [];
    eventBus.subscribe('task:error', (data) =>
      errorEvents.push(data as { taskId: string; error: Error }),
    );

    const manager = new TaskManagerImpl({
      eventBus,
      concurrencyController: makeThrowingController(new Error('boom')) as any,
      runAgentFn: neverCalledRunAgent,
    });

    const handle = await manager.launch(
      { ...minConfig, concurrencySlot: { key: 'x', maxConcurrent: 1 } },
      'test',
    );

    await waitForSettled(handle);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].taskId).toBe(handle.taskId);
    expect(errorEvents[0].error.message).toBe('boom');
  });

  // ---------------------------------------------------------------------------
  // Guard: do NOT overwrite an already-completed task
  // ---------------------------------------------------------------------------

  it('does NOT overwrite status when task is already completed', async () => {
    // Acquire resolves normally; the release function throws IN the finally
    // block, which propagates past the internal try/catch.  At that point
    // state.status is already 'completed', so the safety net must NOT flip it.
    const releaseFn = vi.fn(() => {
      throw new Error('release failure');
    });
    const controller = {
      acquire: vi.fn().mockResolvedValue(releaseFn),
    };

    const manager = new TaskManagerImpl({
      concurrencyController: controller as any,
      runAgentFn: makeSuccessRunAgent(),
    });

    const handle = await manager.launch(
      { ...minConfig, concurrencySlot: { key: 'x', maxConcurrent: 1 } },
      'test',
    );

    // The promise will reject (due to the finally-thrown error), so the task
    // may briefly flicker.  Poll for the final status.
    await waitForSettled(handle);
    expect(handle.status).toBe('completed');
    expect(handle.error).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Normal happy path (regression guard)
  // ---------------------------------------------------------------------------

  it('still completes normally when no errors occur', async () => {
    const manager = new TaskManagerImpl({
      runAgentFn: makeSuccessRunAgent(),
    });

    const handle = await manager.launch(minConfig, 'test');

    await new Promise<SubAgentResult>((resolve) => handle.on_complete(resolve));
    expect(handle.status).toBe('completed');
    expect(handle.result?.response).toBe('ok');
  });
});
