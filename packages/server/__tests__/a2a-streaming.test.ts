import { describe, it, expect, vi } from 'vitest';
import type { Agent } from '@agentforge/core';
import { A2ARequestHandler } from '../src/a2a/server.js';
import { InMemoryTaskStore } from '../src/a2a/task-store.js';
import type { A2AMessage, A2AStreamEvent } from '../src/a2a/types.js';

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

describe('A2A SSE Streaming', () => {
  describe('streamSendMessage handler', () => {
    it('yields status-update events as task progresses', async () => {
      const agent = mockAgent();
      const handler = new A2ARequestHandler({ agent });

      const events: A2AStreamEvent[] = [];
      for await (const event of handler.streamSendMessage({ message: makeMessage('hello') })) {
        events.push(event);
      }

      const states = events
        .filter((e): e is Extract<A2AStreamEvent, { kind: 'status-update' }> => e.kind === 'status-update')
        .map((e) => e.status.state);

      expect(states).toContain('working');
      expect(states).toContain('completed');
    });

    it('yields artifact-update event with agent response', async () => {
      const agent = mockAgent('The answer is 42');
      const handler = new A2ARequestHandler({ agent });

      const events: A2AStreamEvent[] = [];
      for await (const event of handler.streamSendMessage({ message: makeMessage('what?') })) {
        events.push(event);
      }

      const artifactEvent = events.find(
        (e): e is Extract<A2AStreamEvent, { kind: 'artifact-update' }> => e.kind === 'artifact-update',
      );
      expect(artifactEvent).toBeDefined();
      expect(artifactEvent!.artifact.parts[0]).toEqual({ kind: 'text', text: 'The answer is 42' });
    });

    it('yields failed status when agent throws', async () => {
      const agent = mockAgent();
      agent.run = vi.fn().mockRejectedValue(new Error('LLM down'));
      const handler = new A2ARequestHandler({ agent });

      const events: A2AStreamEvent[] = [];
      for await (const event of handler.streamSendMessage({ message: makeMessage('hello') })) {
        events.push(event);
      }

      const states = events
        .filter((e): e is Extract<A2AStreamEvent, { kind: 'status-update' }> => e.kind === 'status-update')
        .map((e) => e.status.state);

      expect(states).toContain('failed');
    });

    it('includes taskId and contextId in all events', async () => {
      const agent = mockAgent();
      const handler = new A2ARequestHandler({ agent });

      const events: A2AStreamEvent[] = [];
      for await (const event of handler.streamSendMessage({ message: makeMessage('hi', 'ctx-42') })) {
        events.push(event);
      }

      for (const event of events) {
        expect(event.taskId).toBeDefined();
        expect(event.contextId).toBe('ctx-42');
      }
    });
  });

  describe('SSE route GET /tasks/:id/stream', () => {
    it('returns 404 for unknown task', async () => {
      const { a2aStreamingRoute } = await import('../src/a2a/streaming.js');
      const app = a2aStreamingRoute(new InMemoryTaskStore());
      const res = await app.request('/tasks/nonexistent/stream');
      expect(res.status).toBe(404);
    });

    it('streams SSE events for a completed task', async () => {
      const agent = mockAgent('result');
      const store = new InMemoryTaskStore();
      const handler = new A2ARequestHandler({ agent, taskStore: store });

      const sendResult = await handler.handle({
        jsonrpc: '2.0',
        method: 'SendMessage',
        params: { message: makeMessage('hello') },
        id: 1,
      });
      const taskId = (sendResult.result as { task: { id: string } }).task.id;

      const { a2aStreamingRoute } = await import('../src/a2a/streaming.js');
      const app = a2aStreamingRoute(store);
      const res = await app.request(`/tasks/${taskId}/stream`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });
  });

  describe('A2AClient.streamTask', () => {
    const testCard: import('../src/a2a/types.js').A2AAgentCard = {
      name: 'test',
      description: 'test agent',
      version: '1.0',
      url: 'http://localhost/jsonrpc',
      skills: [],
      capabilities: {},
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
    };

    it('yields parsed A2AStreamEvent objects', async () => {
      const { A2AClient } = await import('../src/a2a/client.js');
      const events: A2AStreamEvent[] = [];

      const mockEvents = [
        { kind: 'status-update', taskId: 't1', contextId: 'c1', status: { state: 'working', timestamp: new Date().toISOString() } },
        { kind: 'artifact-update', taskId: 't1', contextId: 'c1', artifact: { artifactId: 'a1', parts: [{ kind: 'text', text: 'hi' }] } },
      ];

      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          for (const event of mockEvents) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        },
      });

      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
      );

      const client = new A2AClient({ card: testCard, fetch: mockFetch });
      for await (const event of client.streamTask('t1')) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0].kind).toBe('status-update');
      expect(events[1].kind).toBe('artifact-update');
    });

    it('handles empty stream gracefully', async () => {
      const { A2AClient } = await import('../src/a2a/client.js');
      const events: A2AStreamEvent[] = [];

      const body = new ReadableStream({ start(controller) { controller.close(); } });
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
      );

      const client = new A2AClient({ card: testCard, fetch: mockFetch });
      for await (const event of client.streamTask('nonexistent')) {
        events.push(event);
      }

      expect(events).toHaveLength(0);
    });
  });
});
