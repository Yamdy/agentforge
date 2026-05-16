import { describe, it, expect } from 'vitest';
import { createMcpClient } from '../src/mcp/mcp-client.js';
import type { McpServerConfig } from '@agentforge/sdk';

describe('MCP transport factory', () => {
  it('creates client for SSE transport without throwing', () => {
    const config: McpServerConfig = {
      name: 'test-sse',
      transport: 'sse',
      url: 'http://localhost:3001/sse',
    };

    const client = createMcpClient(config);
    expect(client).toBeDefined();
    expect(typeof client.connect).toBe('function');
    expect(typeof client.discoverTools).toBe('function');
    expect(typeof client.callTool).toBe('function');
    expect(typeof client.close).toBe('function');
  });

  it('creates client for HTTP transport without throwing', () => {
    const config: McpServerConfig = {
      name: 'test-http',
      transport: 'http',
      url: 'http://localhost:3001/mcp',
    };

    const client = createMcpClient(config);
    expect(client).toBeDefined();
    expect(typeof client.connect).toBe('function');
    expect(typeof client.discoverTools).toBe('function');
    expect(typeof client.callTool).toBe('function');
    expect(typeof client.close).toBe('function');
  });

  it('still throws for unknown transport', () => {
    const config = {
      name: 'test-bad',
      transport: 'unknown',
      url: 'http://localhost:3001',
    };

    expect(() => createMcpClient(config)).toThrow(/Unknown transport/);
  });

  it('still creates stdio client for default transport', () => {
    const config: McpServerConfig = {
      name: 'test-stdio',
      command: 'node',
      args: ['echo.js'],
    };

    const client = createMcpClient(config);
    expect(client).toBeDefined();
  });
});
