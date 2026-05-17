import { describe, it, expect, vi } from 'vitest';
import { A2ARequestHandler } from '../../src/a2a/server.js';
import { InMemoryTaskStore } from '../../src/a2a/task-store.js';
import { A2AClient } from '../../src/a2a/client.js';
import { buildAgentCard } from '../../src/a2a/agent-card.js';
import type { Agent } from '@primo-ai/core';
import type {
  JsonRpcRequest,
  A2AStreamEvent,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  A2AAgentCard,
} from '../../src/a2a/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAgent(response: string): Agent {
  return {
    run: vi.fn().mockResolvedValue({ response, tokenUsage: { input: 10, output: 20 }, sessionId: 'sess-1' }),
    stream: vi.fn(),
    streamEvents: vi.fn(),
    resume: vi.fn(),
    state: 'pending',
  } as unknown as Agent;
}

/** Mock agent whose run() resolves after a short delay so events are emitted in order. */
function mockAgentDelayed(response: string, delayMs = 50): Agent {
  return {
    run: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return { response, tokenUsage: { input: 10, output: 20 }, sessionId: 'sess-1' };
    }),
    stream: vi.fn(),
    streamEvents: vi.fn(),
    resume: vi.fn(),
    state: 'pending',
  } as unknown as Agent;
}

function jsonRpcRequest(method: string, params: unknown, id = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', method, params, id };
}

// ---------------------------------------------------------------------------
// 1. A2ARequestHandler — StreamTask method
// ---------------------------------------------------------------------------

describe('A2ARequestHandler — StreamTask', () => {
  it('returns an async iterable of A2AStreamEvents for a SendMessage request', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgentDelayed('Hello streamed', 30);
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const events: A2AStreamEvent[] = [];
    for await (const event of handler.streamSendMessage({
      message: {
        kind: 'message',
        messageId: 'msg-s1',
        role: 'user',
        parts: [{ kind: 'text', text: 'Stream me' }],
      },
    })) {
      events.push(event);
    }

    // Should contain at least: status-update(working), artifact-update, status-update(completed)
    expect(events.length).toBeGreaterThanOrEqual(3);

    const statusUpdates = events.filter((e) => e.kind === 'status-update') as TaskStatusUpdateEvent[];
    const artifactUpdates = events.filter((e) => e.kind === 'artifact-update') as TaskArtifactUpdateEvent[];

    // First status update should be 'working'
    expect(statusUpdates[0].status.state).toBe('working');

    // Should have an artifact with the agent response
    expect(artifactUpdates.length).toBeGreaterThanOrEqual(1);
    const textPart = artifactUpdates[0].artifact.parts.find((p) => p.kind === 'text');
    expect(textPart).toBeDefined();
    if (textPart && textPart.kind === 'text') {
      expect(textPart.text).toBe('Hello streamed');
    }

    // Last status update should be 'completed'
    const lastStatus = statusUpdates[statusUpdates.length - 1];
    expect(lastStatus.status.state).toBe('completed');
  });

  it('emits status-update(failed) when agent.run() rejects', async () => {
    const store = new InMemoryTaskStore();
    const agent = {
      ...mockAgent(''),
      run: vi.fn().mockRejectedValue(new Error('LLM error')),
    } as unknown as Agent;
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const events: A2AStreamEvent[] = [];
    for await (const event of handler.streamSendMessage({
      message: {
        kind: 'message',
        messageId: 'msg-s2',
        role: 'user',
        parts: [{ kind: 'text', text: 'Fail me' }],
      },
    })) {
      events.push(event);
    }

    const statusUpdates = events.filter((e) => e.kind === 'status-update') as TaskStatusUpdateEvent[];
    const lastStatus = statusUpdates[statusUpdates.length - 1];
    expect(lastStatus.status.state).toBe('failed');
  });

  it('includes taskId and contextId on every event', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgentDelayed('Ok', 10);
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    const events: A2AStreamEvent[] = [];
    for await (const event of handler.streamSendMessage({
      message: {
        kind: 'message',
        messageId: 'msg-s3',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hi' }],
        contextId: 'ctx-test',
      },
    })) {
      events.push(event);
    }

    for (const event of events) {
      expect(event.taskId).toBeTruthy();
      expect(event.contextId).toBe('ctx-test');
    }
  });

  it('stores the completed task in the task store', async () => {
    const store = new InMemoryTaskStore();
    const agent = mockAgentDelayed('Done', 10);
    const handler = new A2ARequestHandler({ agent, taskStore: store });

    let taskId = '';
    for await (const event of handler.streamSendMessage({
      message: {
        kind: 'message',
        messageId: 'msg-s4',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hi' }],
      },
    })) {
      taskId = event.taskId;
    }

    const stored = await store.get(taskId);
    expect(stored).toBeDefined();
    expect(stored!.status.state).toBe('completed');
    expect(stored!.artifacts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. SSE streaming endpoint — a2aStreamRoute
// ---------------------------------------------------------------------------

describe('a2aStreamRoute', () => {
  it('streams SSE events for an existing task via GET /tasks/:id/stream', async () => {
    const { Hono } = await import('hono');
    const { a2aStreamRoute } = await import('../../src/a2a/streaming.js');
    const store = new InMemoryTaskStore();
    const agent = mockAgentDelayed('Streamed response', 30);

    const app = new Hono();
    app.route('/', a2aStreamRoute({ agent, taskStore: store }));

    // Create a task first via SendMessage (async — returns working immediately)
    const handler = new A2ARequestHandler({ agent, taskStore: store });
    const sendResponse = await handler.handle(jsonRpcRequest('SendMessage', {
      message: {
        kind: 'message',
        messageId: 'msg-r1',
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello' }],
      },
    }));
    const taskId = (sendResponse.result as { task: { id: string } }).task.id;

    // Wait for background execution to complete
    await new Promise((r) => setTimeout(r, 100));

    // Now stream it — since it's completed, we should get the final events
    const res = await app.request(`/tasks/${taskId}/stream`);
    expect(res.status).toBe(200);
    // content-type may be set by the streaming helper
    const contentType = res.headers.get('content-type');
    if (contentType != null) {
      expect(contentType).toContain('text/event-stream');
    }

    const body = await res.text();
    // Should contain at least one data line with a status-update
    const dataLines = body.split('\n').filter((l) => l.startsWith('data: '));
    expect(dataLines.length).toBeGreaterThan(0);

    const parsed = dataLines.map((l) => JSON.parse(l.slice(6)));
    const hasCompleted = parsed.some(
      (e) => e.kind === 'status-update' && e.status.state === 'completed',
    );
    expect(hasCompleted).toBe(true);
  });

  it('returns 404 for nonexistent task', async () => {
    const { Hono } = await import('hono');
    const { a2aStreamRoute } = await import('../../src/a2a/streaming.js');
    const store = new InMemoryTaskStore();
    const agent = mockAgent('Ok');

    const app = new Hono();
    app.route('/', a2aStreamRoute({ agent, taskStore: store }));

    const res = await app.request('/tasks/nonexistent/stream');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 3. A2AClient — streamTask
// ---------------------------------------------------------------------------

describe('A2AClient — streamTask', () => {
  const card: A2AAgentCard = {
    name: 'Remote Agent',
    description: 'A remote test agent',
    version: '1.0.0',
    url: 'http://remote:3000/a2a',
    skills: [],
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };

  it('yields A2AStreamEvents from SSE response', async () => {
    const sseBody = [
      'data: ' + JSON.stringify({
        kind: 'status-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'working', timestamp: new Date().toISOString() },
      }),
      '',
      'data: ' + JSON.stringify({
        kind: 'artifact-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        artifact: { artifactId: 'art-1', parts: [{ kind: 'text', text: 'Hello' }] },
        lastChunk: true,
      }),
      '',
      'data: ' + JSON.stringify({
        kind: 'status-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed', timestamp: new Date().toISOString() },
      }),
      '',
    ].join('\n');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      text: () => Promise.resolve(sseBody),
    });

    const client = new A2AClient({ card, fetch: mockFetch });

    const events: A2AStreamEvent[] = [];
    for await (const event of client.streamTask('task-1')) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe('status-update');
    expect(events[1].kind).toBe('artifact-update');
    expect(events[2].kind).toBe('status-update');

    // Verify correct URL was called
    expect(mockFetch).toHaveBeenCalledWith(
      'http://remote:3000/a2a/tasks/task-1/stream',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws on HTTP error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    const client = new A2AClient({ card, fetch: mockFetch });

    await expect(async () => {
      for await (const _event of client.streamTask('bad-task')) { void _event; }
    }).rejects.toThrow(/HTTP 404/);
  });
});

// ---------------------------------------------------------------------------
// 4. buildAgentCard — pushNotifications configurable
// ---------------------------------------------------------------------------

describe('buildAgentCard — pushNotifications', () => {
  const minimalOptions = {
    name: 'Test Agent',
    description: 'A test agent',
    url: 'http://localhost:3000/a2a',
    version: '1.0.0',
  };

  it('defaults pushNotifications to false', () => {
    const card = buildAgentCard(minimalOptions);
    expect(card.capabilities.pushNotifications).toBe(false);
  });

  it('sets pushNotifications to true when configured', () => {
    const card = buildAgentCard({
      ...minimalOptions,
      pushNotifications: true,
    });
    expect(card.capabilities.pushNotifications).toBe(true);
  });
});
