import { describe, it, expect, vi } from 'vitest';
import { mcpRoutes } from '../src/routes/mcp.js';
import type { McpManager } from '@primo-ai/plugins';
import type { McpServerStatus } from '@primo-ai/plugins';

function createMockMcpManager(overrides?: Partial<McpManager>): McpManager {
  return {
    addServer: vi.fn(),
    removeServer: vi.fn(),
    reconnect: vi.fn(),
    listServers: vi.fn().mockReturnValue([]),
    getServerTools: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as McpManager;
}

describe('mcpRoutes', () => {
  describe('GET /', () => {
    it('returns empty array when no MCP manager', async () => {
      const app = mcpRoutes(undefined);
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns server statuses from manager', async () => {
      const statuses: McpServerStatus[] = [
        { name: 'fs-server', connected: true, toolCount: 3 },
        { name: 'db-server', connected: false, toolCount: 0, error: 'timeout' },
      ];
      const mgr = createMockMcpManager({ listServers: vi.fn().mockReturnValue(statuses) });
      const app = mcpRoutes(mgr);
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(statuses);
    });
  });

  describe('GET /:name/tools', () => {
    it('returns empty array when no MCP manager', async () => {
      const app = mcpRoutes(undefined);
      const res = await app.request('/fs-server/tools');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns tools for a specific server', async () => {
      const tools = [
        { name: 'read_file', description: 'Read a file', inputSchema: {} },
        { name: 'write_file', description: 'Write a file', inputSchema: {} },
      ];
      const mgr = createMockMcpManager({ getServerTools: vi.fn().mockReturnValue(tools) });
      const app = mcpRoutes(mgr);
      const res = await app.request('/fs-server/tools');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(tools);
      expect(mgr.getServerTools).toHaveBeenCalledWith('fs-server');
    });

    it('returns empty array for unknown server', async () => {
      const mgr = createMockMcpManager({ getServerTools: vi.fn().mockReturnValue([]) });
      const app = mcpRoutes(mgr);
      const res = await app.request('/unknown/tools');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });
  });

  describe('POST /', () => {
    it('returns 404 when no MCP manager', async () => {
      const app = mcpRoutes(undefined);
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-server', url: 'http://localhost:3000' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when name is missing', async () => {
      const mgr = createMockMcpManager();
      const app = mcpRoutes(mgr);
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://localhost:3000' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('name');
    });

    it('returns 400 when name is not a string', async () => {
      const mgr = createMockMcpManager();
      const app = mcpRoutes(mgr);
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 123 }),
      });
      expect(res.status).toBe(400);
    });

    it('adds server and returns 201 with status', async () => {
      const newStatus: McpServerStatus = { name: 'new-server', connected: true, toolCount: 2 };
      const mgr = createMockMcpManager({
        addServer: vi.fn(),
        listServers: vi.fn().mockReturnValue([newStatus]),
      });
      const app = mcpRoutes(mgr);
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-server', url: 'http://localhost:3000' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('new-server');
      expect(mgr.addServer).toHaveBeenCalledWith({ name: 'new-server', url: 'http://localhost:3000' });
    });
  });

  describe('DELETE /:name', () => {
    it('returns 404 when no MCP manager', async () => {
      const app = mcpRoutes(undefined);
      const res = await app.request('/old-server', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('removes server and returns confirmation', async () => {
      const mgr = createMockMcpManager({ removeServer: vi.fn() });
      const app = mcpRoutes(mgr);
      const res = await app.request('/old-server', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.removed).toBe(true);
      expect(mgr.removeServer).toHaveBeenCalledWith('old-server');
    });
  });

  describe('POST /:name/reconnect', () => {
    it('returns 404 when no MCP manager', async () => {
      const app = mcpRoutes(undefined);
      const res = await app.request('/fs-server/reconnect', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('reconnects and returns updated status', async () => {
      const status: McpServerStatus = { name: 'fs-server', connected: true, toolCount: 5 };
      const mgr = createMockMcpManager({
        reconnect: vi.fn(),
        listServers: vi.fn().mockReturnValue([status]),
      });
      const app = mcpRoutes(mgr);
      const res = await app.request('/fs-server/reconnect', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('fs-server');
      expect(mgr.reconnect).toHaveBeenCalledWith('fs-server');
    });

    it('returns 404 when reconnect throws', async () => {
      const mgr = createMockMcpManager({
        reconnect: vi.fn().mockRejectedValue(new Error('Server not found: missing')),
      });
      const app = mcpRoutes(mgr);
      const res = await app.request('/missing/reconnect', { method: 'POST' });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not found');
    });
  });
});
