import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { a2aMultiAgentRoutes } from '../../src/a2a/routes.js';
import type { Agent } from '@agentforge/core';
import type { AgentRegistry } from '../../src/registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAgent(response: string): Agent {
  return {
    run: vi.fn().mockResolvedValue({ response, tokenUsage: {}, sessionId: 's1' }),
    stream: vi.fn(),
    streamEvents: vi.fn(),
    resume: vi.fn(),
    state: 'pending',
    toolRegistry: {
      toAiSdkToolSchemas: vi.fn().mockReturnValue({}),
    },
  } as unknown as Agent;
}

function mockRegistry(agentMap: Record<string, Agent>): AgentRegistry {
  return {
    get: vi.fn().mockImplementation((id: string) => agentMap[id]),
    list: vi.fn().mockReturnValue(
      Object.entries(agentMap).map(([id, agent]) => ({ id, agent })),
    ),
  } as unknown as AgentRegistry;
}

describe('A2A multi-agent routing', () => {
  it('routes to different agents based on agentId path', async () => {
    const agent1 = mockAgent('Response from agent-1');
    const agent2 = mockAgent('Response from agent-2');
    const registry = mockRegistry({ 'agent-1': agent1, 'agent-2': agent2 });

    const app = a2aMultiAgentRoutes({
      registry,
      agents: {
        'agent-1': { name: 'Agent One', description: 'First agent', url: 'http://localhost:3000/a2a/agent-1', version: '1.0.0' },
        'agent-2': { name: 'Agent Two', description: 'Second agent', url: 'http://localhost:3000/a2a/agent-2', version: '1.0.0' },
      },
    });

    // Send message to agent-1
    const res1 = await app.request('/agent-1/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendMessage',
        id: 1,
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello agent 1' }],
          },
        },
      }),
    });

    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.result.task.status.state).toBe('working');

    // Wait for background execution
    await new Promise((r) => setTimeout(r, 50));

    // Verify agent-1 was called
    expect(agent1.run).toHaveBeenCalledWith('Hello agent 1');

    // Send message to agent-2
    const res2 = await app.request('/agent-2/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendMessage',
        id: 2,
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-2',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello agent 2' }],
          },
        },
      }),
    });

    expect(res2.status).toBe(200);

    // Wait for background execution
    await new Promise((r) => setTimeout(r, 50));

    // Verify agent-2 was called
    expect(agent2.run).toHaveBeenCalledWith('Hello agent 2');

    // agent-1 should NOT have been called for the second request
    expect(agent1.run).toHaveBeenCalledTimes(1);
    expect(agent2.run).toHaveBeenCalledTimes(1);
  });

  it('each agent has its own independent agent card', async () => {
    const agent1 = mockAgent('Response from agent-1');
    const agent2 = mockAgent('Response from agent-2');
    const registry = mockRegistry({ 'agent-1': agent1, 'agent-2': agent2 });

    const app = a2aMultiAgentRoutes({
      registry,
      agents: {
        'agent-1': { name: 'Agent One', description: 'First agent', url: 'http://localhost:3000/a2a/agent-1', version: '1.0.0' },
        'agent-2': { name: 'Agent Two', description: 'Second agent', url: 'http://localhost:3000/a2a/agent-2', version: '2.0.0' },
      },
    });

    const card1Res = await app.request('/agent-1/.well-known/agent-card.json');
    expect(card1Res.status).toBe(200);
    const card1 = await card1Res.json();
    expect(card1.name).toBe('Agent One');
    expect(card1.version).toBe('1.0.0');
    expect(card1.url).toBe('http://localhost:3000/a2a/agent-1');

    const card2Res = await app.request('/agent-2/.well-known/agent-card.json');
    expect(card2Res.status).toBe(200);
    const card2 = await card2Res.json();
    expect(card2.name).toBe('Agent Two');
    expect(card2.version).toBe('2.0.0');
    expect(card2.url).toBe('http://localhost:3000/a2a/agent-2');
  });

  it('returns 404 for unknown agent route', async () => {
    const agent1 = mockAgent('Response');
    const registry = mockRegistry({ 'agent-1': agent1 });

    const app = a2aMultiAgentRoutes({
      registry,
      agents: {
        'agent-1': { name: 'Agent One', description: 'First agent', url: 'http://localhost:3000/a2a/agent-1', version: '1.0.0' },
      },
    });

    const res = await app.request('/unknown-agent/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendMessage',
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

    expect(res.status).toBe(404);
  });

  it('each agent has its own task store (isolated tasks)', async () => {
    const agent1 = mockAgent('Response from agent-1');
    const agent2 = mockAgent('Response from agent-2');
    const registry = mockRegistry({ 'agent-1': agent1, 'agent-2': agent2 });

    const app = a2aMultiAgentRoutes({
      registry,
      agents: {
        'agent-1': { name: 'Agent One', description: 'First agent', url: 'http://localhost:3000/a2a/agent-1', version: '1.0.0' },
        'agent-2': { name: 'Agent Two', description: 'Second agent', url: 'http://localhost:3000/a2a/agent-2', version: '1.0.0' },
      },
    });

    // Create task on agent-1
    const res1 = await app.request('/agent-1/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendMessage',
        id: 1,
        params: {
          message: {
            kind: 'message',
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Task for agent 1' }],
          },
        },
      }),
    });
    const taskId1 = (await res1.json()).result.task.id;

    // Task from agent-1 should not be visible on agent-2
    const res2 = await app.request('/agent-2/jsonrpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'GetTask',
        id: 2,
        params: { id: taskId1 },
      }),
    });

    const body2 = await res2.json();
    expect(body2.error).toBeDefined();
    expect(body2.error.code).toBe(-32001); // TASK_NOT_FOUND
  });
});
