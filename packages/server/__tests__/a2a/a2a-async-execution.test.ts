import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { A2ARequestHandler } from '../../src/a2a/server.js';
import { InMemoryTaskStore } from '../../src/a2a/task-store.js';
import type { JsonRpcRequest } from '../../src/a2a/types.js';

// ---------------------------------------------------------------------------
// Mock Agent that resolves after a short delay
// ---------------------------------------------------------------------------

function createMockAgent(response: string, delayMs = 50) {
  return {
    run: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return { response, tokenUsage: {}, sessionId: 'test-session' };
    }),
    toolRegistry: {
      toAiSdkToolSchemas: vi.fn().mockReturnValue({}),
    },
  } as any;
}

function createFailingAgent(error: Error, delayMs = 50) {
  return {
    run: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      throw error;
    }),
    toolRegistry: {
      toAiSdkToolSchemas: vi.fn().mockReturnValue({}),
    },
  } as any;
}

function sendRequest(messageText: string, contextId?: string): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    method: 'SendMessage',
    id: 1,
    params: {
      message: {
        kind: 'message',
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: messageText }],
        ...(contextId && { contextId }),
      },
    },
  };
}

describe('A2A async execution', () => {
  let taskStore: InMemoryTaskStore;

  beforeEach(() => {
    taskStore = new InMemoryTaskStore();
  });

  it('returns task in "working" state immediately (non-blocking)', async () => {
    const agent = createMockAgent('hello', 2000); // slow agent
    const handler = new A2ARequestHandler({ agent, taskStore });

    const response = await handler.handle(sendRequest('hi'));

    expect(response.result).toBeDefined();
    const result = response.result as { task: any };
    expect(result.task.status.state).toBe('working');
    expect(result.task.id).toBeDefined();
  });

  it('transitions task to "completed" after agent finishes', async () => {
    const agent = createMockAgent('hello world', 50);
    const handler = new A2ARequestHandler({ agent, taskStore });

    const response = await handler.handle(sendRequest('hi'));
    const result = response.result as { task: any };
    const taskId = result.task.id;

    // Wait for background execution to complete
    await new Promise((r) => setTimeout(r, 200));

    const finalTask = await taskStore.get(taskId);
    expect(finalTask).toBeDefined();
    expect(finalTask!.status.state).toBe('completed');
  });

  it('stores agent response as artifact on completion', async () => {
    const agent = createMockAgent('hello world', 50);
    const handler = new A2ARequestHandler({ agent, taskStore });

    const response = await handler.handle(sendRequest('hi'));
    const taskId = (response.result as { task: any }).task.id;

    // Wait for background execution
    await new Promise((r) => setTimeout(r, 200));

    const finalTask = await taskStore.get(taskId);
    expect(finalTask!.artifacts).toHaveLength(1);
    expect(finalTask!.artifacts![0].parts[0]).toEqual({
      kind: 'text',
      text: 'hello world',
    });
  });

  it('transitions task to "failed" when agent throws', async () => {
    const agent = createFailingAgent(new Error('Agent crashed'), 50);
    const handler = new A2ARequestHandler({ agent, taskStore });

    const response = await handler.handle(sendRequest('hi'));
    const taskId = (response.result as { task: any }).task.id;

    // Wait for background execution to fail
    await new Promise((r) => setTimeout(r, 200));

    const finalTask = await taskStore.get(taskId);
    expect(finalTask!.status.state).toBe('failed');
  });

  it('task follows lifecycle: submitted -> working -> completed', async () => {
    const agent = createMockAgent('result', 50);
    const handler = new A2ARequestHandler({ agent, taskStore });

    // SendMessage should set status to working immediately
    const response = await handler.handle(sendRequest('hi'));
    const result = response.result as { task: any };

    // Task was created with 'submitted' then moved to 'working'
    expect(result.task.status.state).toBe('working');

    const taskId = result.task.id;

    // After agent finishes, task should be completed
    await new Promise((r) => setTimeout(r, 200));
    const finalTask = await taskStore.get(taskId);
    expect(finalTask!.status.state).toBe('completed');
  });

  it('GetTask returns current state during execution', async () => {
    const agent = createMockAgent('result', 200);
    const handler = new A2ARequestHandler({ agent, taskStore });

    // Start async execution
    const sendResp = await handler.handle(sendRequest('hi'));
    const taskId = (sendResp.result as { task: any }).task.id;

    // Immediately query - should be working
    const getResp = await handler.handle({
      jsonrpc: '2.0',
      method: 'GetTask',
      id: 2,
      params: { id: taskId },
    });
    const getResult = getResp.result as { task: any };
    expect(getResult.task.status.state).toBe('working');

    // Wait for completion
    await new Promise((r) => setTimeout(r, 400));

    const finalResp = await handler.handle({
      jsonrpc: '2.0',
      method: 'GetTask',
      id: 3,
      params: { id: taskId },
    });
    const finalResult = finalResp.result as { task: any };
    expect(finalResult.task.status.state).toBe('completed');
  });

  it('cancels a working task', async () => {
    const agent = createMockAgent('result', 500);
    const handler = new A2ARequestHandler({ agent, taskStore });

    const sendResp = await handler.handle(sendRequest('hi'));
    const taskId = (sendResp.result as { task: any }).task.id;

    // Cancel while still working
    const cancelResp = await handler.handle({
      jsonrpc: '2.0',
      method: 'CancelTask',
      id: 2,
      params: { id: taskId },
    });
    const cancelResult = cancelResp.result as { task: any };
    expect(cancelResult.task.status.state).toBe('canceled');
  });

  it('handles multiple concurrent tasks independently', async () => {
    const agent = createMockAgent('response', 100);
    const handler = new A2ARequestHandler({ agent, taskStore });

    const resp1 = await handler.handle(sendRequest('task1', 'ctx-1'));
    const resp2 = await handler.handle(sendRequest('task2', 'ctx-2'));

    const id1 = (resp1.result as { task: any }).task.id;
    const id2 = (resp2.result as { task: any }).task.id;

    expect(id1).not.toBe(id2);

    // Wait for both to complete
    await new Promise((r) => setTimeout(r, 300));

    const task1 = await taskStore.get(id1);
    const task2 = await taskStore.get(id2);

    expect(task1!.status.state).toBe('completed');
    expect(task2!.status.state).toBe('completed');
  });
});
