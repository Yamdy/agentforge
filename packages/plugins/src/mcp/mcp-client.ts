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
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function createStdioClient(config: McpServerConfig): McpClient {
  let nextId = 1;
  let childProcess: import('child_process').ChildProcess | null = null;
  let pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let buffer = '';

  function sendNotification(method: string, params?: unknown): void {
    const message = JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
    childProcess!.stdin!.write(message + '\n');
  }

  function sendRequest(method: string, params?: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method} (id=${id}, ${timeoutMs}ms)`));
      }, timeoutMs);
      pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      childProcess!.stdin!.write(message + '\n');
    });
  }

  function handleMessage(data: string): void {
    buffer += data;
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        // Response to a request
        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const { resolve, reject } = pendingRequests.get(msg.id)!;
          pendingRequests.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message ?? 'MCP error'));
          } else {
            resolve(msg.result);
          }
        }
        // Server-initiated notifications are silently consumed
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

      // Reject all pending requests if the process dies
      childProcess.on('error', (err) => {
        const error = new Error(`MCP server process error: ${err.message}`);
        for (const { reject } of pendingRequests.values()) reject(error);
        pendingRequests.clear();
      });

      childProcess.on('exit', (code, signal) => {
        const error = new Error(`MCP server exited unexpectedly (code=${code}, signal=${signal})`);
        for (const { reject } of pendingRequests.values()) reject(error);
        pendingRequests.clear();
      });

      childProcess.stdout!.on('data', (data: Buffer) => {
        handleMessage(data.toString());
      });

      // MCP handshake: initialize → initialized notification
      await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agentforge', version: '0.0.1' },
      }, DEFAULT_CONNECT_TIMEOUT_MS);

      sendNotification('notifications/initialized');
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
