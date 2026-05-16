import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent } from '@agentforge/core';
import { A2ARequestHandler } from '../src/a2a/server.js';
import { InMemoryTaskStore } from '../src/a2a/task-store.js';
import { InMemoryNotificationRegistry } from '../src/a2a/push-notification.js';
import type { A2AMessage, JsonRpcRequest } from '../src/a2a/types.js';

function mockAgent(response = 'done') {
  return {
    run: vi.fn().mockResolvedValue({ response, tokenUsage: { input: 10, output: 5 }, sessionId: 's1' }),
  } as unknown as Agent;
}

function makeMessage(text: string, contextId = 'ctx-1'): A2AMessage {
  return {
    kind: 'message',
    messageId: 'msg-1',
    role: 'user',
    parts: [{ kind: 'text', text }],
    contextId,
  };
}

function jsonRpc(method: string, params: unknown, id = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', method, params, id };
}

describe('A2A Push Notification', () => {
  describe('InMemoryNotificationRegistry', () => {
    it('registers and retrieves webhook URL', () => {
      const registry = new InMemoryNotificationRegistry();
      registry.register('task-1', 'https://example.com/webhook');
      expect(registry.get('task-1')).toBe('https://example.com/webhook');
    });

    it('returns undefined for unregistered task', () => {
      const registry = new InMemoryNotificationRegistry();
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('unregisters a webhook', () => {
      const registry = new InMemoryNotificationRegistry();
      registry.register('task-1', 'https://example.com/webhook');
      registry.unregister('task-1');
      expect(registry.get('task-1')).toBeUndefined();
    });

    it('list returns all registered task IDs', () => {
      const registry = new InMemoryNotificationRegistry();
      registry.register('t1', 'https://a.com');
      registry.register('t2', 'https://b.com');
      expect(registry.list().sort()).toEqual(['t1', 't2']);
    });
  });

  describe('A2ARequestHandler with push notifications', () => {
    let agent: Agent;
    let store: InMemoryTaskStore;
    let registry: InMemoryNotificationRegistry;
    let handler: A2ARequestHandler;

    beforeEach(() => {
      agent = mockAgent();
      store = new InMemoryTaskStore();
      registry = new InMemoryNotificationRegistry();
      handler = new A2ARequestHandler({ agent, taskStore: store, notificationRegistry: registry });
    });

    it('registers webhook via RegisterPushNotification', async () => {
      const sendResult = await handler.handle(jsonRpc('SendMessage', { message: makeMessage('hello') }));
      const taskId = (sendResult.result as { task: { id: string } }).task.id;

      const regResult = await handler.handle(jsonRpc('RegisterPushNotification', {
        taskId,
        pushNotificationUrl: 'https://example.com/notify',
      }));

      expect(regResult.result).toBeDefined();
      expect(registry.get(taskId)).toBe('https://example.com/notify');
    });

    it('returns error for unknown task in RegisterPushNotification', async () => {
      const result = await handler.handle(jsonRpc('RegisterPushNotification', {
        taskId: 'nonexistent',
        pushNotificationUrl: 'https://example.com/notify',
      }));

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(-32001);
    });

    it('notify sends POST to registered webhook', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      handler = new A2ARequestHandler({
        agent: mockAgent('result2'),
        taskStore: new InMemoryTaskStore(),
        notificationRegistry: registry,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      const sendResult = await handler.handle(jsonRpc('SendMessage', { message: makeMessage('test') }));
      const taskId = (sendResult.result as { task: { id: string } }).task.id;

      registry.register(taskId, 'https://example.com/notify2');
      await handler.notify(taskId);

      expect(fetchMock).toHaveBeenCalledWith('https://example.com/notify2', expect.objectContaining({
        method: 'POST',
      }));
    });

    it('handles webhook delivery failure gracefully', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
      handler = new A2ARequestHandler({
        agent,
        taskStore: store,
        notificationRegistry: registry,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      registry.register('t1', 'https://example.com/fail');
      await expect(handler.notify('t1')).resolves.toBeUndefined();
    });
  });
});
