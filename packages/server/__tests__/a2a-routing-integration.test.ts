import { describe, it, expect } from 'vitest';
import { AgentForgeServer } from '../src/server.js';
import { AgentRegistry } from '../src/registry.js';

/**
 * Integration tests verifying A2A routes are mounted on the server
 * and reachable via HTTP.
 *
 * These tests use the `a2a` option in ServerOptions to enable A2A endpoints
 * for a specific agent. The endpoints tested are:
 *   GET  /a2a/.well-known/agent-card.json
 *   POST /a2a/jsonrpc
 */
describe('A2A route mounting integration', () => {
  function makeServerWithA2A() {
    const registry = new AgentRegistry();
    registry.register('a2a-test-agent', {
      model: 'test/model',
      systemPrompt: 'You are a test agent',
      tools: [],
    });

    return new AgentForgeServer({
      port: 0,
      registry,
      a2a: {
        agentId: 'a2a-test-agent',
        cardOptions: {
          name: 'Test Agent',
          description: 'Agent for A2A integration testing',
          url: 'http://localhost:3000/a2a',
          version: '0.0.1',
        },
      },
    });
  }

  it('GET /a2a/.well-known/agent-card.json returns 200 with agent card', async () => {
    const server = makeServerWithA2A();
    const handle = await server.start();
    try {
      const res = await fetch(
        `http://127.0.0.1:${handle.port}/a2a/.well-known/agent-card.json`,
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe('Test Agent');
      expect(body.description).toBe('Agent for A2A integration testing');
      expect(body.version).toBe('0.0.1');
      expect(body.url).toBe('http://localhost:3000/a2a');
      expect(Array.isArray(body.skills)).toBe(true);
      expect(body.capabilities).toBeDefined();
    } finally {
      await handle.close();
    }
  });

  it('POST /a2a/jsonrpc with GetTask returns 200 with JSON-RPC response', async () => {
    const server = makeServerWithA2A();
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/a2a/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-1',
          method: 'GetTask',
          params: { id: 'nonexistent-task' },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // GetTask for a nonexistent task should return a JSON-RPC error response (not HTTP error)
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('test-1');
      expect(body.error).toBeDefined();
    } finally {
      await handle.close();
    }
  });

  it('GET /a2a/.well-known/agent-card.json returns 404 when no a2a option configured', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const handle = await server.start();
    try {
      const res = await fetch(
        `http://127.0.0.1:${handle.port}/a2a/.well-known/agent-card.json`,
      );
      expect(res.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it('agent card reflects registered tools as skills', async () => {
    const registry = new AgentRegistry();
    registry.register('tooled-agent', {
      model: 'test/model',
      systemPrompt: '',
      tools: [
        {
          name: 'echo',
          description: 'Echoes input',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          execute: async () => 'ok',
        },
      ],
    });

    const server = new AgentForgeServer({
      port: 0,
      registry,
      a2a: {
        agentId: 'tooled-agent',
        cardOptions: {
          name: 'Tooled Agent',
          description: 'Agent with tools',
          url: 'http://localhost:3000/a2a',
          version: '1.0.0',
        },
      },
    });

    const handle = await server.start();
    try {
      const res = await fetch(
        `http://127.0.0.1:${handle.port}/a2a/.well-known/agent-card.json`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const skills = body.skills as Array<{ id: string; name: string; description: string }>;
      const echoSkill = skills.find((s) => s.id === 'echo');
      expect(echoSkill).toBeDefined();
      expect(echoSkill!.description).toBe('Echoes input');
    } finally {
      await handle.close();
    }
  });

  it('throws when a2a.agentId is not in the registry', () => {
    expect(() => {
      new AgentForgeServer({
        port: 0,
        a2a: {
          agentId: 'nonexistent',
          cardOptions: {
            name: 'Ghost Agent',
            description: 'Does not exist',
            url: 'http://localhost:3000/a2a',
            version: '0.0.1',
          },
        },
      });
    }).toThrow(/Agent not found.*nonexistent/);
  });
});
