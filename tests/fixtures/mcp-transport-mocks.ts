/**
 * Shared MCP Transport Mock and JSON-RPC Helpers
 *
 * Canonical implementations extracted from tests/mcp/client.spec.ts.
 *
 * @module
 */

import type { JSONRPCMessage, JSONRPCRequest, JSONRPCSuccessResponse, JSONRPCErrorResponse } from '../../src/mcp/types.js';
import type { MCPTransport, TransportStatus } from '../../src/mcp/transport.js';

// ============================================================
// JSON-RPC Helpers
// ============================================================

export function createJSONRPCResponse(id: number, result: unknown): JSONRPCSuccessResponse {
  return { jsonrpc: '2.0', id, result };
}

export function createJSONRPCError(id: number, code: number, message: string): JSONRPCErrorResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export function createJSONRPCRequest(id: number, method: string, params?: Record<string, unknown>): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method, params };
}

// ============================================================
// ControllableMockTransport
// ============================================================

export class ControllableMockTransport implements MCPTransport {
  private _status: TransportStatus = 'disconnected';
  private _onmessage?: (message: JSONRPCMessage) => void;
  private _onerror?: (error: Error) => void;
  private _onclose?: () => void;
  private sentMessages: JSONRPCMessage[] = [];
  private shouldFailConnect = false;
  private shouldFailSend = false;
  private autoRespond = true;

  get status(): TransportStatus {
    return this._status;
  }

  set onmessage(handler: ((message: JSONRPCMessage) => void) | undefined) {
    this._onmessage = handler;
  }

  get onmessage(): ((message: JSONRPCMessage) => void) | undefined {
    return this._onmessage;
  }

  set onerror(handler: ((error: Error) => void) | undefined) {
    this._onerror = handler;
  }

  get onerror(): ((error: Error) => void) | undefined {
    return this._onerror;
  }

  set onclose(handler: (() => void) | undefined) {
    this._onclose = handler;
  }

  get onclose(): (() => void) | undefined {
    return this._onclose;
  }

  get sentMessagesList(): JSONRPCMessage[] {
    return [...this.sentMessages];
  }

  setFailConnect(should: boolean): void {
    this.shouldFailConnect = should;
  }

  setFailSend(should: boolean): void {
    this.shouldFailSend = should;
  }

  setAutoRespond(should: boolean): void {
    this.autoRespond = should;
  }

  async connect(): Promise<void> {
    if (this.shouldFailConnect) {
      this._status = 'error';
      throw new Error('Mock connection failed');
    }
    this._status = 'connected';
  }

  async close(): Promise<void> {
    this._status = 'disconnected';
    this._onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._status !== 'connected') {
      throw new Error('Not connected');
    }
    if (this.shouldFailSend) {
      throw new Error('Mock send failed');
    }
    this.sentMessages.push(message);
    if (this.autoRespond && 'id' in message && 'method' in message) {
      this.autoRespondTo(message as JSONRPCRequest);
    }
  }

  simulateMessage(message: JSONRPCMessage): void {
    this._onmessage?.(message);
  }

  simulateError(error: Error): void {
    this._onerror?.(error);
  }

  simulateClose(): void {
    this._onclose?.();
  }

  clearSentMessages(): void {
    this.sentMessages = [];
  }

  private autoRespondTo(request: JSONRPCRequest): void {
    let response: JSONRPCSuccessResponse;
    if (request.method === 'initialize') {
      response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          serverInfo: { name: 'mock-server', version: '1.0.0' },
        },
      };
    } else if (request.method === 'tools/list') {
      response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
            { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
          ],
        },
      };
    } else if (request.method === 'tools/call') {
      response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: 'Mock tool result' }],
          isError: false,
        },
      };
    } else {
      return;
    }
    Promise.resolve().then(() => {
      this._onmessage?.(response);
    });
  }
}
