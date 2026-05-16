import type { McpServerConfig } from '@agentforge/sdk';
import type { McpToolDefinition } from './tool-converter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpSdkClient {
  connect(transport: unknown): Promise<unknown>;
  listTools(): Promise<unknown>;
  callTool(params: Record<string, unknown>): Promise<unknown>;
  close?(): Promise<unknown>;
}

export interface McpClient {
  connect(): Promise<void>;
  discoverTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
  connected: boolean;
  onToolsChanged?: () => void;
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
    connected: false,
    async connect() { this.connected = true; },
    async discoverTools() {
      return tools;
    },
    async callTool(name: string, args: unknown) {
      if (!this.connected) throw new Error('MCP server disconnected');
      if (callToolFn) {
        return callToolFn(name, args);
      }
      return {};
    },
    async close() { this.connected = false; },
    onToolsChanged: undefined,
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
  const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let buffer = '';
  let isConnected = false;

  const client: McpClient = {
    connected: false,
    onToolsChanged: undefined,

    async connect(): Promise<void> {
      const { spawn } = await import('child_process');
      childProcess = spawn(config.command!, config.args ?? [], {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      childProcess.on('error', (err) => {
        disconnect(`MCP server process error: ${err.message}`);
      });

      childProcess.on('exit', (code, signal) => {
        disconnect(`MCP server exited unexpectedly (code=${code}, signal=${signal})`);
      });

      childProcess.stdout!.on('data', (data: Buffer) => {
        handleMessage(data.toString());
      });

      await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agentforge', version: '0.0.1' },
      }, DEFAULT_CONNECT_TIMEOUT_MS);

      sendNotification('notifications/initialized');
      isConnected = true;
      this.connected = true;
    },

    async discoverTools(): Promise<McpToolDefinition[]> {
      const result = await sendRequest('tools/list') as { tools: McpToolDefinition[] };
      return result.tools ?? [];
    },

    async callTool(name: string, args: unknown): Promise<unknown> {
      if (!isConnected) {
        throw new Error(`MCP server "${config.name}" is disconnected`);
      }
      return sendRequest('tools/call', { name, arguments: args });
    },

    async close(): Promise<void> {
      isConnected = false;
      this.connected = false;
      if (childProcess) {
        childProcess.kill();
        childProcess = null;
      }
    },
  };

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
        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const { resolve, reject } = pendingRequests.get(msg.id)!;
          pendingRequests.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message ?? 'MCP error'));
          } else {
            resolve(msg.result);
          }
        }
        if (msg.method === 'notifications/tools/list_changed') {
          client.onToolsChanged?.();
        }
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  function disconnect(reason: string): void {
    isConnected = false;
    client.connected = false;
    const error = new Error(reason);
    for (const { reject } of pendingRequests.values()) reject(error);
    pendingRequests.clear();
  }

  return client;
}

// ---------------------------------------------------------------------------
// SSE Client (via @modelcontextprotocol/sdk)
// ---------------------------------------------------------------------------

function createSseClient(config: McpServerConfig): McpClient {
  let clientPromise: Promise<McpSdkClient> | null = null;

  const mcpClient: McpClient = {
    connected: false,
    onToolsChanged: undefined,

    async connect(): Promise<void> {
      const [{ Client }, { SSEClientTransport }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/sse.js'),
      ]);

      const transport = new SSEClientTransport(new URL(config.url!));
      const client = new Client({ name: `agentforge-${config.name}`, version: '0.0.1' });

      await client.connect(transport);
      clientPromise = Promise.resolve(client as McpSdkClient);
      this.connected = true;
    },

    async discoverTools(): Promise<McpToolDefinition[]> {
      const client = await clientPromise!;
      const result = await client.listTools() as { tools?: unknown[] };
      return (result?.tools ?? []) as McpToolDefinition[];
    },

    async callTool(name: string, args: unknown): Promise<unknown> {
      if (!this.connected) throw new Error(`MCP server "${config.name}" is disconnected`);
      const client = await clientPromise!;
      const result = await client.callTool({ name, arguments: args });
      return result;
    },

    async close(): Promise<void> {
      if (clientPromise) {
        const client = await clientPromise;
        await client.close?.();
        clientPromise = null;
      }
      this.connected = false;
    },
  };

  return mcpClient;
}

// ---------------------------------------------------------------------------
// HTTP Client (Streamable HTTP via @modelcontextprotocol/sdk)
// ---------------------------------------------------------------------------

function createHttpClient(config: McpServerConfig): McpClient {
  let clientPromise: Promise<McpSdkClient> | null = null;

  const mcpClient: McpClient = {
    connected: false,
    onToolsChanged: undefined,

    async connect(): Promise<void> {
      const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
      ]);

      const transport = new StreamableHTTPClientTransport(new URL(config.url!));
      const client = new Client({ name: `agentforge-${config.name}`, version: '0.0.1' });

      await client.connect(transport);
      clientPromise = Promise.resolve(client as McpSdkClient);
      this.connected = true;
    },

    async discoverTools(): Promise<McpToolDefinition[]> {
      const client = await clientPromise!;
      const result = await client.listTools() as { tools?: unknown[] };
      return (result?.tools ?? []) as McpToolDefinition[];
    },

    async callTool(name: string, args: unknown): Promise<unknown> {
      if (!this.connected) throw new Error(`MCP server "${config.name}" is disconnected`);
      const client = await clientPromise!;
      const result = await client.callTool({ name, arguments: args });
      return result;
    },

    async close(): Promise<void> {
      if (clientPromise) {
        const client = await clientPromise;
        await client.close?.();
        clientPromise = null;
      }
      this.connected = false;
    },
  };

  return mcpClient;
}

// ---------------------------------------------------------------------------
// Client Factory
// ---------------------------------------------------------------------------

/**
 * Creates an MCP client based on the transport specified in the config.
 */
export function createMcpClient(config: McpServerConfig): McpClient {
  const transport = config.transport ?? 'stdio';

  switch (transport) {
    case 'stdio':
      return createStdioClient(config);
    case 'sse':
      return createSseClient(config);
    case 'http':
      return createHttpClient(config);
    default:
      throw new Error(`Unknown transport: ${transport}`);
  }
}
