import { describe, it, expect, vi } from 'vitest';
import type { McpServerConfig } from '@primo-ai/sdk';
import { createMockMcpClient } from '../src/mcp/mcp-client.js';
import type { McpToolDefinition } from '../src/mcp/tool-converter.js';
import { McpManager } from '../src/mcp/mcp-manager.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const sampleTools: McpToolDefinition[] = [
  { name: 'search', description: 'Search files', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
];

const sampleConfig: McpServerConfig = {
  name: 'test-server',
  transport: 'stdio',
  command: 'npx',
  args: ['mcp-server'],
};

// ---------------------------------------------------------------------------
// McpManager tests
// ---------------------------------------------------------------------------

describe('McpManager', () => {
  describe('addServer', () => {
    it('creates client and connects', async () => {
      const mockClient = createMockMcpClient(sampleTools);
      const manager = new McpManager(() => mockClient);

      await manager.addServer(sampleConfig);

      // After addServer, the client should be connected and tools discovered
      expect(mockClient.connected).toBe(true);
      const status = manager.listServers();
      expect(status).toHaveLength(1);
      expect(status[0].name).toBe('test-server');
      expect(status[0].connected).toBe(true);
    });

    it('discovers tools from server', async () => {
      const mockClient = createMockMcpClient(sampleTools);
      const manager = new McpManager(() => mockClient);

      await manager.addServer(sampleConfig);

      const tools = manager.getServerTools('test-server');
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('search');
      expect(tools[1].name).toBe('read');
    });

    it('reports toolCount in status', async () => {
      const mockClient = createMockMcpClient(sampleTools);
      const manager = new McpManager(() => mockClient);

      await manager.addServer(sampleConfig);

      const status = manager.listServers();
      expect(status[0].toolCount).toBe(2);
    });
  });

  describe('removeServer', () => {
    it('closes client and removes entry', async () => {
      const mockClient = createMockMcpClient(sampleTools);
      const manager = new McpManager(() => mockClient);

      await manager.addServer(sampleConfig);
      expect(manager.listServers()).toHaveLength(1);

      await manager.removeServer('test-server');

      expect(mockClient.connected).toBe(false);
      expect(manager.listServers()).toHaveLength(0);
    });

    it('for non-existent name is no-op', async () => {
      const mockClient = createMockMcpClient(sampleTools);
      const manager = new McpManager(() => mockClient);

      await manager.addServer(sampleConfig);

      // Removing a non-existent server should not throw
      await expect(manager.removeServer('non-existent')).resolves.toBeUndefined();
      expect(manager.listServers()).toHaveLength(1);
    });
  });

  describe('listServers', () => {
    it('returns status for all servers', async () => {
      const toolsA: McpToolDefinition[] = [
        { name: 'tool_a', description: 'A tool', inputSchema: { type: 'object' } },
      ];
      const toolsB: McpToolDefinition[] = [
        { name: 'tool_b1', description: 'B1', inputSchema: { type: 'object' } },
        { name: 'tool_b2', description: 'B2', inputSchema: { type: 'object' } },
      ];

      const clientA = createMockMcpClient(toolsA);
      const clientB = createMockMcpClient(toolsB);

      let callCount = 0;
      const factory = (config: McpServerConfig) => {
        callCount++;
        return config.name === 'server-a' ? clientA : clientB;
      };

      const manager = new McpManager(factory);

      await manager.addServer({ name: 'server-a', transport: 'stdio', command: 'a' });
      await manager.addServer({ name: 'server-b', transport: 'stdio', command: 'b' });

      const status = manager.listServers();
      expect(status).toHaveLength(2);

      const serverA = status.find(s => s.name === 'server-a');
      const serverB = status.find(s => s.name === 'server-b');

      expect(serverA).toBeDefined();
      expect(serverA!.connected).toBe(true);
      expect(serverA!.toolCount).toBe(1);

      expect(serverB).toBeDefined();
      expect(serverB!.connected).toBe(true);
      expect(serverB!.toolCount).toBe(2);
    });

    it('returns empty array when no servers', () => {
      const manager = new McpManager();
      expect(manager.listServers()).toEqual([]);
    });
  });

  describe('getServerTools', () => {
    it('returns tool definitions for a server', async () => {
      const mockClient = createMockMcpClient(sampleTools);
      const manager = new McpManager(() => mockClient);

      await manager.addServer(sampleConfig);

      const tools = manager.getServerTools('test-server');
      expect(tools).toEqual(sampleTools);
    });

    it('returns empty array for non-existent server', async () => {
      const manager = new McpManager();
      expect(manager.getServerTools('non-existent')).toEqual([]);
    });
  });

  describe('reconnect', () => {
    it('reconnects a disconnected server', async () => {
      const mockClient = createMockMcpClient(sampleTools);
      const manager = new McpManager(() => mockClient);

      await manager.addServer(sampleConfig);

      // Simulate disconnect
      mockClient.connected = false;

      const status = manager.listServers();
      expect(status[0].connected).toBe(false);

      // Reconnect
      await manager.reconnect('test-server');

      const statusAfter = manager.listServers();
      expect(statusAfter[0].connected).toBe(true);
      expect(statusAfter[0].toolCount).toBe(2);
    });

    it('throws for non-existent server', async () => {
      const manager = new McpManager();
      await expect(manager.reconnect('non-existent')).rejects.toThrow(/not found/i);
    });
  });
});
