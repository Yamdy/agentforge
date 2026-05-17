import { describe, it, expect, vi } from 'vitest';
import { AgentForgeServer } from '../src/server.js';
import type { PermissionManager, ModelFactory } from '@primo-ai/core';
import type { McpManager } from '@primo-ai/plugins';

function createMockPermissionManager(): PermissionManager {
  return {
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(undefined),
    resolve: vi.fn(),
    awaitDecision: vi.fn(),
    getBySession: vi.fn().mockReturnValue([]),
  } as unknown as PermissionManager;
}

function createMockModelFactory(): ModelFactory {
  return {
    resolve: vi.fn(),
    registerGateway: vi.fn(),
    registerProvider: vi.fn(),
    listGateways: vi.fn().mockReturnValue([]),
  } as unknown as ModelFactory;
}

function createMockMcpManager(): McpManager {
  return {
    addServer: vi.fn(),
    removeServer: vi.fn(),
    reconnect: vi.fn(),
    listServers: vi.fn().mockReturnValue([]),
    getServerTools: vi.fn().mockReturnValue([]),
  } as unknown as McpManager;
}

describe('AgentForgeServer new routes', () => {
  it('mounts /permissions route and responds to GET /permissions/pending', async () => {
    const pm = createMockPermissionManager();
    const server = new AgentForgeServer({
      port: 0,
      permissionManager: pm,
    });
    const res = await server.hono.request('/permissions/pending');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('mounts /providers route and responds to GET /providers', async () => {
    const mf = createMockModelFactory();
    const server = new AgentForgeServer({
      port: 0,
      modelFactory: mf,
    });
    const res = await server.hono.request('/providers');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('mounts /mcp route and responds to GET /mcp', async () => {
    const mgr = createMockMcpManager();
    const server = new AgentForgeServer({
      port: 0,
      mcpManager: mgr,
    });
    const res = await server.hono.request('/mcp');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('permissions route works without permission manager (graceful degradation)', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const res = await server.hono.request('/permissions/pending');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('providers route works without model factory (graceful degradation)', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const res = await server.hono.request('/providers');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('mcp route works without MCP manager (graceful degradation)', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const res = await server.hono.request('/mcp');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('existing routes still work after adding new routes', async () => {
    const server = new AgentForgeServer({ port: 0 });
    // Health route
    const healthRes = await server.hono.request('/health');
    expect(healthRes.status).toBe(200);
    // Agents route
    const agentsRes = await server.hono.request('/agents');
    expect(agentsRes.status).toBe(200);
  });
});
