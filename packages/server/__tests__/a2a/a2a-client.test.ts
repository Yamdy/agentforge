import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2AClient } from '../../src/a2a/client.js';
import type { A2AAgentCard, JsonRpcResponse } from '../../src/a2a/types.js';

const mockCard: A2AAgentCard = {
  name: 'Remote Agent',
  description: 'A remote test agent',
  version: '1.0.0',
  url: 'http://remote:3000/a2a',
  skills: [{ id: 'chat', name: 'Chat', description: 'General chat', tags: ['chat'] }],
  capabilities: { streaming: true },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
};

describe('A2AClient', () => {
  let client: A2AClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new A2AClient({ card: mockCard, fetch: mockFetch });
  });

  it('sends a message and returns task result', async () => {
    const taskResponse: JsonRpcResponse = {
      jsonrpc: '2.0', id: 1,
      result: {
        task: {
          id: 'task-1', contextId: 'ctx-1',
          status: { state: 'completed', timestamp: new Date().toISOString() },
          artifacts: [{ artifactId: 'art-1', parts: [{ kind: 'text', text: 'Remote response' }] }],
        },
      },
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(taskResponse) });

    const result = await client.sendMessage('Hello');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://remote:3000/a2a',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('SendMessage');
    expect(body.params.message.parts[0].text).toBe('Hello');
    expect((result as unknown as { task: { status: { state: string } } }).task.status.state).toBe('completed');
  });

  it('extracts text from completed task artifact', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve({
        jsonrpc: '2.0', id: 1,
        result: { task: { id: 'task-1', contextId: 'ctx-1', status: { state: 'completed', timestamp: new Date().toISOString() }, artifacts: [{ artifactId: 'art-1', parts: [{ kind: 'text', text: '42' }] }] } },
      }),
    });

    const text = await client.sendAndExtract('What is 2+2?');
    expect(text).toBe('42');
  });

  it('returns empty string when task has no artifacts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve({
        jsonrpc: '2.0', id: 1,
        result: { task: { id: 'task-1', contextId: 'ctx-1', status: { state: 'completed', timestamp: new Date().toISOString() }, artifacts: [] } },
      }),
    });

    const text = await client.sendAndExtract('Hello');
    expect(text).toBe('');
  });

  it('throws on JSON-RPC error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'Task not found' } }),
    });

    await expect(client.sendMessage('Hi')).rejects.toThrow(/A2A error/);
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    await expect(client.sendMessage('Hi')).rejects.toThrow(/HTTP 500/);
  });

  it('gets a task by id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve({
        jsonrpc: '2.0', id: 1,
        result: { task: { id: 'task-1', contextId: 'ctx-1', status: { state: 'working', timestamp: new Date().toISOString() } } },
      }),
    });

    const result = await client.getTask('task-1') as unknown as { task: { id: string; status: { state: string } } };
    expect(result.task.id).toBe('task-1');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('GetTask');
    expect(body.params.id).toBe('task-1');
  });

  it('cancels a task', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve({
        jsonrpc: '2.0', id: 1,
        result: { task: { id: 'task-1', contextId: 'ctx-1', status: { state: 'canceled', timestamp: new Date().toISOString() } } },
      }),
    });

    const result = await client.cancelTask('task-1') as unknown as { task: { status: { state: string } } };
    expect(result.task.status.state).toBe('canceled');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('CancelTask');
  });

  it('uses contextId when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve({
        jsonrpc: '2.0', id: 1,
        result: { task: { id: 'task-1', contextId: 'my-ctx', status: { state: 'completed', timestamp: new Date().toISOString() }, artifacts: [] } },
      }),
    });

    await client.sendMessage('Hi', { contextId: 'my-ctx' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.message.contextId).toBe('my-ctx');
  });
});
