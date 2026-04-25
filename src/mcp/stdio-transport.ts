/**
 * MCP Stdio Transport
 *
 * Transport implementation using stdin/stdout for process communication.
 * Uses newline-delimited JSON format.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import { spawn } from 'child_process';
import type { MCPServerConfig } from '../core/interfaces.js';
import { ReadBuffer } from './read-buffer.js';
import type { MCPTransport, TransportStatus } from './transport.js';
import { MCPConnectionError, MCPSendError, MCPParseError } from './transport.js';
import type { JSONRPCMessage } from './types.js';
import { parseJSONRPCMessage } from './types.js';

// ============================================================
// Stdio Transport Config
// ============================================================

/**
 * Configuration for Stdio transport.
 */
export interface StdioTransportConfig {
  /** Command to execute */
  command: string;
  /** Command line arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

// ============================================================
// Stdio Transport Implementation
// ============================================================

/**
 * Stdio Transport - communicates via stdin/stdout with a child process.
 *
 * Protocol: Newline-delimited JSON (one JSON-RPC message per line).
 *
 * Usage scenarios:
 * - Local MCP servers (e.g., @modelcontextprotocol/server-filesystem)
 * - No network overhead
 * - Process lifecycle managed by AgentForge
 */
export class StdioTransport implements MCPTransport {
  private _process: import('child_process').ChildProcess | undefined;
  private _readBuffer = new ReadBuffer();
  private _status: TransportStatus = 'disconnected';

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(private config: StdioTransportConfig) {}

  get status(): TransportStatus {
    return this._status;
  }

  /**
   * Spawn the child process and set up communication.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._status !== 'disconnected') {
        reject(new MCPConnectionError('Transport already connected or connecting'));
        return;
      }

      this._status = 'connecting';

      try {
        // Build environment (inherit from parent, override with config)
        const env = {
          ...this.getDefaultEnv(),
          ...this.config.env,
        };

        // Spawn child process
        this._process = spawn(this.config.command, this.config.args ?? [], {
          env,
          cwd: this.config.cwd,
          stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
          shell: false,
        });

        // Handle process errors
        this._process.on('error', error => {
          this._status = 'error';
          this.onerror?.(new MCPConnectionError(`Process error: ${error.message}`, error));
        });

        // Handle process exit
        this._process.on('close', () => {
          const wasConnected = this._status === 'connected';
          this._status = 'disconnected';
          this._process = undefined;

          if (wasConnected) {
            this.onclose?.();
          }
        });

        // Handle stdout data
        this._process.stdout?.on('data', (chunk: Buffer) => {
          this._readBuffer.append(chunk);
          this.processReadBuffer();
        });

        // Check if process spawned successfully
        if (!this._process.stdin || !this._process.stdout) {
          throw new MCPConnectionError('Failed to create stdin/stdout pipes');
        }

        this._status = 'connected';
        resolve();
      } catch (error) {
        this._status = 'error';
        reject(
          new MCPConnectionError(
            `Failed to spawn process: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error : undefined
          )
        );
      }
    });
  }

  /**
   * Send a JSON-RPC message via stdin.
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this._status !== 'connected' || !this._process?.stdin) {
      throw new MCPSendError('Transport not connected');
    }

    const json = JSON.stringify(message) + '\n';

    return new Promise((resolve, reject) => {
      this._process?.stdin?.write(json, 'utf-8', error => {
        if (error) {
          reject(new MCPSendError(`Failed to write to stdin: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Close the connection gracefully.
   */
  async close(): Promise<void> {
    if (!this._process) {
      return;
    }

    const process = this._process;
    this._status = 'disconnected';

    // Graceful shutdown: stdin.end() -> SIGTERM -> SIGKILL
    process.stdin?.end();

    // Wait for process to exit (max 5 seconds)
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        process.kill('SIGTERM');
        setTimeout(() => process.kill('SIGKILL'), 1000);
      }, 5000);

      process.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Resolve immediately if already closed
      if (process.exitCode !== null) {
        clearTimeout(timeout);
        resolve();
      }
    });

    this._process = undefined;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Process the read buffer, parsing complete messages.
   */
  private processReadBuffer(): void {
    while (this._readBuffer.hasMessage()) {
      const rawMessage = this._readBuffer.readMessage();
      if (!rawMessage) continue;

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const parsed: unknown = JSON.parse(rawMessage);
        const message = parseJSONRPCMessage(parsed);

        if (message) {
          this.onmessage?.(message);
        } else {
          this.onerror?.(new MCPParseError('Invalid JSON-RPC message structure', parsed));
        }
      } catch (error) {
        this.onerror?.(
          new MCPParseError(
            `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
            rawMessage
          )
        );
      }
    }
  }

  /**
   * Get default environment variables to inherit (cross-platform).
   */
  private getDefaultEnv(): Record<string, string> {
    // Cross-platform essential environment variables
    const inherited =
      process.platform === 'win32'
        ? [
            'APPDATA',
            'HOMEDRIVE',
            'HOMEPATH',
            'PATH',
            'TEMP',
            'USERNAME',
            'USERPROFILE',
            'SYSTEMROOT',
            'COMSPEC',
          ]
        : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER', 'LANG', 'LC_ALL'];

    const env: Record<string, string> = {};
    for (const key of inherited) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }
}

// ============================================================
// Factory Registration
// ============================================================

/**
 * Create a Stdio transport from MCPServerConfig.
 */
export function createStdioTransport(config: MCPServerConfig): StdioTransport {
  if (!config.command) {
    throw new MCPConnectionError('Stdio transport requires "command" in config');
  }

  const transportConfig: StdioTransportConfig = {
    command: config.command,
  };

  if (config.args !== undefined) {
    transportConfig.args = config.args;
  }
  if (config.env !== undefined) {
    transportConfig.env = config.env;
  }

  return new StdioTransport(transportConfig);
}
