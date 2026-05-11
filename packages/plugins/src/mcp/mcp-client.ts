import type { McpServerConfig } from '@agentforge/sdk';
import { convertMcpTool, type McpToolDefinition } from './tool-converter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpClient {
  connect(): Promise<void>;
  discoverTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mock Client (for testing)
// ---------------------------------------------------------------------------

/**
 * Creates a mock MCP client for testing. Returns the provided tools from
 * discoverTools() and delegates callTool to the provided function.
 */
export function createMockMcpClient(
  tools: McpToolDefinition[],
  callToolFn?: (name: string, args: unknown) => Promise<unknown>,
): McpClient {
  return {
    async connect() {},
    async discoverTools() {
      return tools;
    },
    async callTool(name: string, args: unknown) {
      if (callToolFn) {
        return callToolFn(name, args);
      }
      return {};
    },
    async close() {},
  };
}

// ---------------------------------------------------------------------------
// Stdio Client (JSON-RPC over child process stdin/stdout)
// ---------------------------------------------------------------------------

/**
 * Creates an MCP client that communicates via stdio (child process).
 * Spawns the configured command and communicates using JSON-RPC.
 */
function createStdioClient(config: McpServerConfig): McpClient {
  let nextId = 1;
  let childProcess: import('child_process').ChildProcess | null = null;
  let pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let buffer = '';

  function sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
      pendingRequests.set(id, { resolve, reject });
      childProcess!.stdin!.write(message + '\n');
    });
  }

  function handleMessage(data: string): void {
    buffer += data;
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const response = JSON.parse(trimmed);
        if (response.id !== undefined && pendingRequests.has(response.id)) {
          const { resolve, reject } = pendingRequests.get(response.id)!;
          pendingRequests.delete(response.id);
          if (response.error) {
            reject(new Error(response.error.message ?? 'MCP error'));
          } else {
            resolve(response.result);
          }
        }
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  return {
    async connect(): Promise<void> {
      const { spawn } = await import('child_process');
      childProcess = spawn(config.command!, config.args ?? [], {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      childProcess.stdout!.on('data', (data: Buffer) => {
        handleMessage(data.toString());
      });

      // Initialize the connection
      await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agentforge', version: '0.0.1' },
      });
    },

    async discoverTools(): Promise<McpToolDefinition[]> {
      const result = await sendRequest('tools/list') as { tools: McpToolDefinition[] };
      return result.tools ?? [];
    },

    async callTool(name: string, args: unknown): Promise<unknown> {
      return sendRequest('tools/call', { name, arguments: args });
    },

    async close(): Promise<void> {
      if (childProcess) {
        childProcess.kill();
        childProcess = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Client Factory
// ---------------------------------------------------------------------------

/**
 * Creates an MCP client based on the transport specified in the config.
 * Currently only stdio transport is implemented.
 */
export function createMcpClient(config: McpServerConfig): McpClient {
  const transport = config.transport ?? 'stdio';

  switch (transport) {
    case 'stdio':
      return createStdioClient(config);
    case 'sse':
      throw new Error('SSE transport not implemented');
    case 'http':
      throw new Error('HTTP transport not implemented');
    default:
      throw new Error(`Unknown transport: ${transport}`);
  }
}
