import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { agentRoutes } from '../../src/routes/agents.js';
import type { AgentRegistry } from '../../src/registry.js';

// Minimal mock agent that satisfies agentRoutes usage
function mockAgent(overrides?: { runResult?: unknown; streamYields?: string[] }) {
  const runResult = overrides?.runResult ?? { response: 'ok', tokenUsage: { prompt: 0, completion: 0, total: 0 }, sessionId: 's1' };
  const streamYields = overrides?.streamYields ?? ['hello'];

  return {
    run: vi.fn().mockResolvedValue(runResult),
    resume: vi.fn().mockResolvedValue(runResult),
    stream: vi.fn().mockImplementation(async function* () {
      for (const chunk of streamYields) yield chunk;
    }),
    streamEvents: vi.fn().mockImplementation(async function* () {
      for (const chunk of streamYields) yield { type: 'text_delta', text: chunk };
    }),
    state: 'pending',
  };
}

// Build a Hono app with a registry containing one registered agent
function makeApp(agentOverrides?: Parameters<typeof mockAgent>[0]) {
  const agent = mockAgent(agentOverrides);
  const registry = {
    get: vi.fn().mockReturnValue(agent),
    list: vi.fn().mockReturnValue([{ id: 'test-agent', state: 'pending' }]),
  } as unknown as AgentRegistry;

  const app = new Hono();
  app.route('/agents', agentRoutes(registry));
  return { app, agent, registry };
}

describe('Agent routes: input validation', () => {
  const BASE = '/agents/test-agent';

  it('returns 400 when input field is missing', async () => {
    const { app } = makeApp();
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/input/i);
  });

  it('returns 400 when input is a number', async () => {
    const { app } = makeApp();
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when input is null', async () => {
    const { app } = makeApp();
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: null }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when input is an object', async () => {
    const { app } = makeApp();
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: 'hello' } }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when input is an empty string', async () => {
    const { app } = makeApp();
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 413 when body exceeds 1MB', async () => {
    const { app } = makeApp();
    const bigInput = 'x'.repeat(1024 * 1024 + 100);
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: bigInput }),
    });
    expect(res.status).toBe(413);
  });

  it('returns 400 on malformed JSON', async () => {
    const { app } = makeApp();
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json',
    });
    expect(res.status).toBe(400);
  });

  it('passes through valid request with string input', async () => {
    const { app, agent } = makeApp();
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Hello agent' }),
    });
    expect(res.status).toBe(200);
    expect(agent.run).toHaveBeenCalledWith('Hello agent', undefined);
  });

  it('passes through valid request with optional sessionId', async () => {
    const { app, agent } = makeApp();
    const res = await app.request(BASE + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Hello', sessionId: 'sess-123' }),
    });
    expect(res.status).toBe(200);
    expect(agent.run).toHaveBeenCalledWith('Hello', { sessionId: 'sess-123' });
  });
});
