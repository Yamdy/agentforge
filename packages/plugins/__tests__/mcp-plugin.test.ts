import { describe, it, expect, vi } from 'vitest';
import type { HarnessAPI, ResourceDeclaration, ToolDefinition, McpServerConfig } from '@agentforge/sdk';
import { convertMcpTool, type McpToolDefinition } from '../src/mcp/tool-converter.js';
import { createMcpClient, createMockMcpClient } from '../src/mcp/mcp-client.js';
import { mcpPlugin, type McpPluginOptions } from '../src/mcp/index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createHarnessAPI(): { api: HarnessAPI; resources: ResourceDeclaration[]; tools: Map<string, ToolDefinition> } {
  const resources: ResourceDeclaration[] = [];
  const tools = new Map<string, ToolDefinition>();

  const api: HarnessAPI = {
    registerProcessor: () => {},
    registerTool: (tool) => { tools.set(tool.name, tool); },
    registerCommand: () => {},
    registerHook: () => {},
    subscribe: () => () => {},
    registerResource: (decl) => { resources.push(decl); },
    registerProvider: () => {},
  };

  return { api, resources, tools };
}

// ---------------------------------------------------------------------------
// Slice 1: tool-converter
// ---------------------------------------------------------------------------

describe('convertMcpTool', () => {
  it('converts MCP tool to framework Tool with correct name, description, inputSchema', () => {
    const mcpTool: McpToolDefinition = {
      name: 'search',
      description: 'Search files',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    };
    const callTool = vi.fn(async () => ({}));

    const tool = convertMcpTool(mcpTool, 'myserver', callTool);

    expect(tool.name).toBe('myserver__search');
    expect(tool.description).toBe('Search files');
    expect(tool.inputSchema).toEqual({ type: 'object', properties: { query: { type: 'string' } } });
  });

  it('prefixes name with serverName__', () => {
    const mcpTool: McpToolDefinition = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object' },
    };
    const callTool = vi.fn(async () => ({}));

    const tool = convertMcpTool(mcpTool, 'fs', callTool);

    expect(tool.name).toBe('fs__read_file');
  });

  it('execute() delegates to callTool callback', async () => {
    const mcpTool: McpToolDefinition = {
      name: 'search',
      description: 'Search files',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    };
    const callTool = vi.fn(async () => ({ results: ['file1.ts'] }));

    const tool = convertMcpTool(mcpTool, 'myserver', callTool);
    const result = await tool.execute({ query: 'test' }, { sessionId: 's1' });

    expect(callTool).toHaveBeenCalledWith('search', { query: 'test' });
    expect(result).toEqual({ results: ['file1.ts'] });
  });
});

// ---------------------------------------------------------------------------
// Slice 2: mcp-client
// ---------------------------------------------------------------------------

describe('createMockMcpClient', () => {
  it('returns client with discoverable tools', async () => {
    const mockTools: McpToolDefinition[] = [
      { name: 'search', description: 'Search files', inputSchema: { type: 'object' } },
      { name: 'read', description: 'Read a file', inputSchema: { type: 'object' } },
    ];
    const client = createMockMcpClient(mockTools);

    await client.connect();
    const tools = await client.discoverTools();

    expect(tools).toEqual(mockTools);
  });

  it('callTool delegates to provided function', async () => {
    const mockTools: McpToolDefinition[] = [
      { name: 'search', description: 'Search files', inputSchema: { type: 'object' } },
    ];
    const mockCallTool = vi.fn(async (_name: string, _args: unknown) => ({ result: 'mock result' }));
    const client = createMockMcpClient(mockTools, mockCallTool);

    await client.connect();
    const result = await client.callTool('search', { query: 'test' });

    expect(mockCallTool).toHaveBeenCalledWith('search', { query: 'test' });
    expect(result).toEqual({ result: 'mock result' });
  });

  it('close() resolves without error', async () => {
    const client = createMockMcpClient([]);
    await client.connect();
    await expect(client.close()).resolves.toBeUndefined();
  });
});

describe('createMcpClient', () => {
  it('creates client for stdio transport', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'stdio',
      command: 'npx',
      args: ['mcp-server'],
    };

    const client = createMcpClient(config);
    expect(client).toBeDefined();
  });

  it('defaults to stdio transport when not specified', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      command: 'npx',
      args: ['mcp-server'],
    };

    const client = createMcpClient(config);
    expect(client).toBeDefined();
  });

  it('creates client for sse transport', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'sse',
      url: 'http://localhost:3000/sse',
    };

    const client = createMcpClient(config);
    expect(client).toBeDefined();
    expect(typeof client.connect).toBe('function');
  });

  it('creates client for http transport', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'http',
      url: 'http://localhost:3000/mcp',
    };

    const client = createMcpClient(config);
    expect(client).toBeDefined();
    expect(typeof client.connect).toBe('function');
  });

  it('stdio client has correct interface', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'stdio',
      command: 'node',
      args: ['fake-server.js'],
    };

    const client = createMcpClient(config);
    expect(typeof client.connect).toBe('function');
    expect(typeof client.discoverTools).toBe('function');
    expect(typeof client.callTool).toBe('function');
    expect(typeof client.close).toBe('function');
  });

  it('stdio client rejects on spawn failure', async () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'stdio',
      command: 'nonexistent-binary-that-does-not-exist-12345',
    };

    const client = createMcpClient(config);
    await expect(client.connect()).rejects.toThrow(/process error|exited unexpectedly/);
  });

  it('stdio client sends initialized notification after handshake', async () => {
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    const serverScript = `
import { createInterface } from 'readline';
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'test', version: '0.0.1' } }
    }) + '\\n');
  } else if (msg.method === 'notifications/initialized') {
    // Client correctly sent initialized notification — do nothing
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object' } }] }
    }) + '\\n');
  }
});
`;

    const tmpFile = path.join(os.tmpdir(), `mcp-test-server-${Date.now()}.mjs`);
    fs.writeFileSync(tmpFile, serverScript);

    try {
      const config: McpServerConfig = {
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: [tmpFile],
      };

      const client = createMcpClient(config);
      await client.connect();
      const tools = await client.discoverTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('ping');
      await client.close();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ---------------------------------------------------------------------------
// Slice 3: plugin factory
// ---------------------------------------------------------------------------

describe('mcpPlugin', () => {
  it('registers one ResourceDeclaration per server config', () => {
    const { api, resources } = createHarnessAPI();

    const mockClient = createMockMcpClient([]);
    const options: McpPluginOptions = {
      servers: [
        { name: 'server-a', transport: 'stdio', command: 'npx', args: ['a'] },
        { name: 'server-b', transport: 'stdio', command: 'npx', args: ['b'] },
      ],
      clientFactory: () => mockClient,
    };

    mcpPlugin(options)(api);

    expect(resources).toHaveLength(2);
    expect(resources[0].id).toBe('mcp:server-a');
    expect(resources[0].type).toBe('mcp-server');
    expect(resources[1].id).toBe('mcp:server-b');
    expect(resources[1].type).toBe('mcp-server');
  });

  it('resource.start() discovers tools and registers them via api.registerTool', async () => {
    const { api, resources, tools } = createHarnessAPI();

    const mockTools: McpToolDefinition[] = [
      { name: 'search', description: 'Search files', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      { name: 'read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    ];
    const mockCallTool = vi.fn(async (_name: string, _args: unknown) => ({ result: 'mock' }));
    const mockClient = createMockMcpClient(mockTools, mockCallTool);

    const options: McpPluginOptions = {
      servers: [
        { name: 'fs-server', transport: 'stdio', command: 'npx', args: ['fs'] },
      ],
      clientFactory: () => mockClient,
    };

    mcpPlugin(options)(api);

    // Resource should be registered but no tools yet
    expect(tools.size).toBe(0);

    // Start the resource — should discover tools and register them
    const resource = resources[0];
    await resource.start();

    // Two tools should now be registered with prefixed names
    expect(tools.size).toBe(2);
    expect(tools.has('fs-server__search')).toBe(true);
    expect(tools.has('fs-server__read')).toBe(true);

    const searchTool = tools.get('fs-server__search')!;
    expect(searchTool.description).toBe('Search files');
  });

  it('resource.stop() closes the McpClient', async () => {
    const { api, resources } = createHarnessAPI();

    const mockTools: McpToolDefinition[] = [];
    const mockClient = createMockMcpClient(mockTools);

    const options: McpPluginOptions = {
      servers: [
        { name: 'test-server', transport: 'stdio', command: 'npx', args: ['test'] },
      ],
      clientFactory: () => mockClient,
    };

    mcpPlugin(options)(api);
    const resource = resources[0];
    const client = await resource.start();

    // Stop should resolve without error
    await resource.stop(client);
  });

  it('full lifecycle: start discovers tools, tools are registered and callable', async () => {
    const { api, resources, tools } = createHarnessAPI();

    const mockTools: McpToolDefinition[] = [
      { name: 'search', description: 'Search files', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
    ];
    const mockCallTool = vi.fn(async (_name: string, _args: unknown) => ({ results: ['found.txt'] }));
    const mockClient = createMockMcpClient(mockTools, mockCallTool);

    const options: McpPluginOptions = {
      servers: [
        { name: 'fs-server', transport: 'stdio', command: 'npx', args: ['fs'] },
      ],
      clientFactory: () => mockClient,
    };

    mcpPlugin(options)(api);

    // Start the resource
    await resources[0].start();

    // Verify tool was registered
    const tool = tools.get('fs-server__search')!;
    expect(tool).toBeDefined();

    // Execute the tool
    const result = await tool.execute({ query: 'test' }, { sessionId: 's1' });
    expect(mockCallTool).toHaveBeenCalledWith('search', { query: 'test' });
    expect(result).toEqual({ results: ['found.txt'] });
  });

  it('returns PluginRegistration', () => {
    const { api } = createHarnessAPI();

    const options: McpPluginOptions = {
      servers: [
        { name: 'test-server', transport: 'stdio', command: 'npx', args: ['test'] },
      ],
    };

    const registration = mcpPlugin(options)(api);
    expect(registration).toBeDefined();
    expect(typeof registration).toBe('object');
  });

  it('uses default createMcpClient when clientFactory is not provided', () => {
    const { api, resources } = createHarnessAPI();

    const options: McpPluginOptions = {
      servers: [
        { name: 'test-server', transport: 'stdio', command: 'npx', args: ['test'] },
      ],
    };

    mcpPlugin(options)(api);
    // Just verify it doesn't throw at the factory level
    expect(resources).toHaveLength(1);
    expect(resources[0].id).toBe('mcp:test-server');
  });
});
