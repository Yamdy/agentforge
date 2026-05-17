import { describe, it, expect, vi } from 'vitest';
import { a2aRoutes } from '../../src/a2a/routes.js';
import type { Agent } from '@primo-ai/core';
import type { AgentRegistry } from '../../src/registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAgent(response: string, delayMs = 30): Agent {
  return {
    run: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return { response, tokenUsage: { input: 10, output: 20 }, sessionId: 'sess-1' };
    }),
    stream: vi.fn(),
    streamEvents: vi.fn(),
    resume: vi.fn(),
    state: 'pending',
    toolRegistry: {
      toAiSdkToolSchemas: vi.fn().mockReturnValue({}),
    },
  } as unknown as Agent;
}

function mockRegistry(agent: Agent, agentId = 'test-agent'): AgentRegistry {
  return {
    get: vi.fn().mockReturnValue(agent),
    list: vi.fn().mockReturnValue([{ id: agentId, agent }]),
  } as unknown as AgentRegistry;
}

describe('A2A streaming JSON-RPC', () => {
  it('SendTaskStreaming returns SSE events for a message', async () => {
    const agent = mockAgent('Streamed result', 30);
    const registry = mockRegistry(agent);

    const { app } = a2aRoutes({
      registry,
      agentId: 'test-agent',
      cardOptions: {
        name: 'Test Agent',
        description: 'A test agent',
        url: 'http://localhost:3000/a2a/test-agent',
        version: '1.0.0',
      },
    });

    const res = await app.request('/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendTaskStreaming',
        id: 1,
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
      }),
    });

    expect(res.status).toBe(200);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toContain('text/event-stream');

    const body = await res.text();
    const dataLines = body.split('\n').filter((l) => l.startsWith('data: '));
    expect(dataLines.length).toBeGreaterThanOrEqual(2);

    const events = dataLines.map((l) => JSON.parse(l.slice(6)));

    // Should have status-update working
    const hasWorking = events.some(
      (e: { result?: { kind?: string; status?: { state?: string } } }) => e.result?.kind === 'status-update' && e.result?.status?.state === 'working',
    );
    expect(hasWorking).toBe(true);

    // Should have status-update completed
    const hasCompleted = events.some(
      (e: { result?: { kind?: string; status?: { state?: string } } }) => e.result?.kind === 'status-update' && e.result?.status?.state === 'completed',
    );
    expect(hasCompleted).toBe(true);
  });

  it('SendTaskStreaming includes artifact-update event', async () => {
    const agent = mockAgent('Artifact content', 30);
    const registry = mockRegistry(agent);

    const { app } = a2aRoutes({
      registry,
      agentId: 'test-agent',
      cardOptions: {
        name: 'Test Agent',
        description: 'A test agent',
        url: 'http://localhost:3000/a2a/test-agent',
        version: '1.0.0',
      },
    });

    const res = await app.request('/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendTaskStreaming',
        id: 2,
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-2',
            role: 'user',
            parts: [{ kind: 'text', text: 'Give me an artifact' }],
          },
        },
      }),
    });

    const body = await res.text();
    const dataLines = body.split('\n').filter((l) => l.startsWith('data: '));
    const events = dataLines.map((l) => JSON.parse(l.slice(6)));

    const hasArtifact = events.some(
      (e: { result?: { kind?: string; status?: { state?: string } } }) => e.result?.kind === 'artifact-update',
    );
    expect(hasArtifact).toBe(true);
  });

  it('SendTaskStreaming emits failed status on agent error', async () => {
    const agent = {
      run: vi.fn().mockRejectedValue(new Error('Agent exploded')),
      stream: vi.fn(),
      streamEvents: vi.fn(),
      resume: vi.fn(),
      state: 'pending',
      toolRegistry: { toAiSdkToolSchemas: vi.fn().mockReturnValue({}) },
    } as unknown as Agent;
    const registry = mockRegistry(agent);

    const { app } = a2aRoutes({
      registry,
      agentId: 'test-agent',
      cardOptions: {
        name: 'Test Agent',
        description: 'A test agent',
        url: 'http://localhost:3000/a2a/test-agent',
        version: '1.0.0',
      },
    });

    const res = await app.request('/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendTaskStreaming',
        id: 3,
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-3',
            role: 'user',
            parts: [{ kind: 'text', text: 'Fail' }],
          },
        },
      }),
    });

    const body = await res.text();
    const dataLines = body.split('\n').filter((l) => l.startsWith('data: '));
    const events = dataLines.map((l) => JSON.parse(l.slice(6)));

    const hasFailed = events.some(
      (e: { result?: { kind?: string; status?: { state?: string } } }) => e.result?.kind === 'status-update' && e.result?.status?.state === 'failed',
    );
    expect(hasFailed).toBe(true);
  });

  it('SendTaskStreaming events include jsonrpc and id fields', async () => {
    const agent = mockAgent('Result', 20);
    const registry = mockRegistry(agent);

    const { app } = a2aRoutes({
      registry,
      agentId: 'test-agent',
      cardOptions: {
        name: 'Test Agent',
        description: 'A test agent',
        url: 'http://localhost:3000/a2a/test-agent',
        version: '1.0.0',
      },
    });

    const res = await app.request('/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendTaskStreaming',
        id: 42,
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-4',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
      }),
    });

    const body = await res.text();
    const dataLines = body.split('\n').filter((l) => l.startsWith('data: '));
    const events = dataLines.map((l) => JSON.parse(l.slice(6)));

    for (const event of events) {
      expect(event.jsonrpc).toBe('2.0');
      expect(event.id).toBe(42);
    }
  });
});
