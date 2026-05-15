import { describe, it, expect } from 'vitest';
import type { AuthAdapter, AuthResult } from '@agentforge/sdk';
import { StaticKeyAuthAdapter } from '../src/middleware/static-key-auth.js';
import { AgentForgeServer } from '../src/server.js';

describe('StaticKeyAuthAdapter', () => {
  it('returns authenticated=true for valid Bearer token', async () => {
    const adapter = new StaticKeyAuthAdapter('my-secret');
    const result = await adapter.authenticate({
      header: (name: string) => name === 'Authorization' ? 'Bearer my-secret' : undefined,
    });
    expect(result).toEqual({ authenticated: true });
  });

  it('returns authenticated=false for missing Authorization header', async () => {
    const adapter = new StaticKeyAuthAdapter('my-secret');
    const result = await adapter.authenticate({
      header: () => undefined,
    });
    expect(result.authenticated).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns authenticated=false for wrong token', async () => {
    const adapter = new StaticKeyAuthAdapter('my-secret');
    const result = await adapter.authenticate({
      header: (name: string) => name === 'Authorization' ? 'Bearer wrong' : undefined,
    });
    expect(result.authenticated).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('AgentForgeServer auth wiring', () => {
  it('accepts authAdapter in ServerOptions', async () => {
    const adapter = new StaticKeyAuthAdapter('key');
    const server = new AgentForgeServer({ port: 3002, authAdapter: adapter });
    const res = await server.hono.request('/health', {
      headers: { Authorization: 'Bearer key' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects request with invalid token via authAdapter', async () => {
    const adapter = new StaticKeyAuthAdapter('key');
    const server = new AgentForgeServer({ port: 3002, authAdapter: adapter });
    const res = await server.hono.request('/health');
    expect(res.status).toBe(401);
  });

  it('apiKey shorthand still works (backward compat)', async () => {
    const server = new AgentForgeServer({ port: 3002, apiKey: 'legacy-key' });
    const res = await server.hono.request('/health', {
      headers: { Authorization: 'Bearer legacy-key' },
    });
    expect(res.status).toBe(200);
  });

  it('authAdapter takes precedence when both are provided', async () => {
    const customAdapter: AuthAdapter = {
      authenticate: async () => ({ authenticated: true }),
    };
    const server = new AgentForgeServer({
      port: 3002,
      apiKey: 'legacy-key',
      authAdapter: customAdapter,
    });
    const res = await server.hono.request('/health');
    expect(res.status).toBe(200);
  });

  it('no auth middleware when neither apiKey nor authAdapter is provided', async () => {
    const server = new AgentForgeServer({ port: 3002 });
    const res = await server.hono.request('/health');
    expect(res.status).toBe(200);
  });
});
