import { describe, it, expect, vi } from 'vitest';
import { A2ARequestHandler } from '../../src/a2a/server.js';
import { InMemoryTaskStore } from '../../src/a2a/task-store.js';
import type { Agent } from '@agentforge/core';
import type { JsonRpcRequest } from '../../src/a2a/types.js';

function mockAgent(response: string): Agent {
  return {
    run: vi.fn().mockResolvedValue({ response, tokenUsage: { input: 10, output: 20 }, sessionId: 'sess-1' }),
    stream: vi.fn(),
    streamEvents: vi.fn(),
    resume: vi.fn(),
    state: 'pending',
  } as unknown as Agent;
}

function jsonRpcRequest(method: string, params: unknown, id = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', method, params, id };
}

describe('A2ARequestHandler', () => {
  it('handles SendMessage — returns task with completed state', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgent('Hello from agent');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const request = jsonRpcRequest('SendMessage', {
      message: {
        kind: 'message',
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hi' }],
      },
    });

    const response = await handler.handle(request);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as { task: { id: string; status: { state: string } } };
    expect(result.task).toBeDefined();
    expect(result.task.status.state).toBe('completed');
  });

  it('passes user message text to agent.run()', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgent('Response');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    await handler.handle(jsonRpcRequest('SendMessage', {
      message: {
        kind: 'message', messageId: 'msg-1', role: 'user',
        parts: [{ kind: 'text', text: 'What is 2+2?' }],
      },
    }));

    expect(agent.run).toHaveBeenCalledWith('What is 2+2?');
  });

  it('returns task artifact with agent response', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgent('42');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const response = await handler.handle(jsonRpcRequest('SendMessage', {
      message: {
        kind: 'message', messageId: 'msg-1', role: 'user',
        parts: [{ kind: 'text', text: 'What is 2+2?' }],
      },
    }));

    const result = response.result as {
      task: { artifacts: Array<{ parts: Array<{ kind: string; text: string }> }> }
    };
    expect(result.task.artifacts).toHaveLength(1);
    expect(result.task.artifacts[0].parts[0]).toEqual({ kind: 'text', text: '42' });
  });

  it('handles GetTask — returns existing task', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgent('Ok');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const sendResponse = await handler.handle(jsonRpcRequest('SendMessage', {
      message: {
        kind: 'message', messageId: 'msg-1', role: 'user',
        parts: [{ kind: 'text', text: 'Hi' }],
      },
    }));
    const taskId = (sendResponse.result as { task: { id: string } }).task.id;

    const getResponse = await handler.handle(jsonRpcRequest('GetTask', { id: taskId }));

    expect(getResponse.error).toBeUndefined();
    const result = getResponse.result as { task: { id: string; status: { state: string } } };
    expect(result.task.id).toBe(taskId);
    expect(result.task.status.state).toBe('completed');
  });

  it('returns TASK_NOT_FOUND for missing task', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgent('Ok');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const response = await handler.handle(jsonRpcRequest('GetTask', { id: 'nonexistent' }));

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32001);
  });

  it('handles CancelTask on working task', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');
    await store.updateStatus(task.id, 'working');

    const agent = mockAgent('Ok');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const response = await handler.handle(jsonRpcRequest('CancelTask', { id: task.id }));

    expect(response.error).toBeUndefined();
    const result = response.result as { task: { status: { state: string } } };
    expect(result.task.status.state).toBe('canceled');
  });

  it('returns TASK_NOT_CANCELABLE for terminal task', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.create('ctx-1');
    await store.updateStatus(task.id, 'working');
    await store.updateStatus(task.id, 'completed');

    const agent = mockAgent('Ok');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const response = await handler.handle(jsonRpcRequest('CancelTask', { id: task.id }));

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32002);
  });

  it('returns UNSUPPORTED_OPERATION for unknown method', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgent('Ok');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const response = await handler.handle(jsonRpcRequest('UnknownMethod', {}));

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32004);
  });

  it('handles agent.run() failure gracefully', async () => {
    const store = new InMemoryTaskStore();
    const agent = {
      ...mockAgent(''),
      run: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    } as unknown as Agent;
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const response = await handler.handle(jsonRpcRequest('SendMessage', {
      message: {
        kind: 'message', messageId: 'msg-1', role: 'user',
        parts: [{ kind: 'text', text: 'Hi' }],
      },
    }));

    const result = response.result as { task: { status: { state: string } } };
    expect(result.task.status.state).toBe('failed');
  });

  it('preserves contextId from message in task', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgent('Ok');
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const response = await handler.handle(jsonRpcRequest('SendMessage', {
      message: {
        kind: 'message', messageId: 'msg-1', role: 'user',
        parts: [{ kind: 'text', text: 'Hi' }],
        contextId: 'my-ctx',
      },
    }));

    const result = response.result as { task: { contextId: string } };
    expect(result.task.contextId).toBe('my-ctx');
  });
});
