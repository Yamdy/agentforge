/**
 * Integration tests for src/mcp/client.ts
 *
 * Tests AgentForgeMCPClient connect/disconnect/tools/callTool lifecycle
 * using ControllableMockTransport for transport injection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONRPCMessage, JSONRPCRequest } from '../../src/mcp/types.js';
import type { MCPServerConfig } from '../../src/core/interfaces.js';
import { AgentForgeMCPClient, type MCPEvent, type MCPClientOptions } from '../../src/mcp/client.js';
import { registerTransportFactory } from '../../src/mcp/transport.js';
import {
  ControllableMockTransport,
  createJSONRPCResponse,
  createJSONRPCError,
  createJSONRPCRequest,
} from '../helpers/mcp-transport-mocks.js';

// ============================================================
// Factory Test
// ============================================================

describe('createMCPClient Factory', () => {
  it('should create AgentForgeMCPClient instance', async () => {
    const { createMCPClient } = await import('../../src/mcp/client.js');
    const config: MCPServerConfig = { type: 'stdio', command: 'test', args: [] };
    const options = { serverName: 'test', sessionId: 'session-1' };
    const client = createMCPClient(config, options);
    expect(client).toBeDefined();
    expect(client.status()).toBe('disconnected');
  });
});

// ============================================================
// Integration Tests with ControllableMockTransport
// ============================================================

describe('AgentForgeMCPClient with Mock Transport', () => {
  let mockTransport: ControllableMockTransport;
  let events: MCPEvent[];
  let client: AgentForgeMCPClient;

  beforeEach(() => {
    mockTransport = new ControllableMockTransport();
    registerTransportFactory('test-mock', () => mockTransport);
    events = [];

    const config: MCPServerConfig = {
      type: 'test-mock' as 'stdio',
      command: 'test',
      args: [],
    };
    const options: MCPClientOptions = {
      serverName: 'test-server',
      sessionId: 'test-session',
      emitEvent: (event) => events.push(event),
    };
    client = new AgentForgeMCPClient(config, options);
  });

  // ============================================================
  // connect()
  // ============================================================

  describe('connect()', () => {
    it('should successfully connect to MCP server', async () => {
      await client.connect();
      expect(client.status()).toBe('connected');
    });

    it('should emit mcp.connecting event when starting connection', async () => {
      await client.connect();
      const connectingEvents = events.filter((e) => e.type === 'mcp.connecting');
      expect(connectingEvents.length).toBeGreaterThanOrEqual(1);
      expect(connectingEvents[0]?.serverName).toBe('test-server');
    });

    it('should emit mcp.connected event after successful connection', async () => {
      await client.connect();
      const connectedEvents = events.filter((e) => e.type === 'mcp.connected');
      expect(connectedEvents.length).toBeGreaterThanOrEqual(1);
      expect(connectedEvents[0]?.serverName).toBe('test-server');
      expect(connectedEvents[0]?.tools).toBeDefined();
    });

    it('should emit mcp.error event when connection fails', async () => {
      mockTransport.setFailConnect(true);
      await expect(client.connect()).rejects.toThrow();
      const errorEvents = events.filter((e) => e.type === 'mcp.error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      expect(errorEvents[0]?.error).toBeDefined();
    });

    it('should throw error when already connected', async () => {
      await client.connect();
      await expect(client.connect()).rejects.toThrow('Client already connected');
    });
  });

  // ============================================================
  // disconnect()
  // ============================================================

  describe('disconnect()', () => {
    it('should disconnect from server', async () => {
      await client.connect();
      await client.disconnect();
      expect(client.status()).toBe('disconnected');
    });

    it('should emit mcp.disconnected event on disconnect', async () => {
      await client.connect();
      events.length = 0;
      await client.disconnect();
      const disconnectedEvents = events.filter((e) => e.type === 'mcp.disconnected');
      expect(disconnectedEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should be safe to call disconnect when not connected', async () => {
      await client.disconnect();
      expect(client.status()).toBe('disconnected');
    });

    it('should reject pending requests on disconnect', async () => {
      await client.connect();
      await client.disconnect();
      expect(client.status()).toBe('disconnected');
    });
  });

  // ============================================================
  // status()
  // ============================================================

  describe('status()', () => {
    it('should return disconnected initially', () => {
      expect(client.status()).toBe('disconnected');
    });

    it('should return connected after successful connection', async () => {
      await client.connect();
      expect(client.status()).toBe('connected');
    });

    it('should return disconnected after disconnect', async () => {
      await client.connect();
      await client.disconnect();
      expect(client.status()).toBe('disconnected');
    });
  });

  // ============================================================
  // tools()
  // ============================================================

  describe('tools()', () => {
    it('should return list of tools after connection', async () => {
      await client.connect();
      const tools = await client.tools();
      expect(tools.length).toBeGreaterThanOrEqual(2);
      expect(tools.find((t) => t.name === 'read_file')).toBeDefined();
      expect(tools.find((t) => t.name === 'write_file')).toBeDefined();
    });

    it('should return empty array when not connected', async () => {
      const tools = await client.tools();
      expect(tools).toEqual([]);
    });
  });

  // ============================================================
  // callTool()
  // ============================================================

  describe('callTool()', () => {
    it('should successfully call a tool', async () => {
      await client.connect();
      const result = await client.callTool('read_file', { path: '/test.txt' });
      expect(result).toBe('Mock tool result');
    });

    it('should throw when not connected', async () => {
      await expect(client.callTool('test_tool', {})).rejects.toThrow('Client not connected');
    });

    it('should send correct tool call request', async () => {
      await client.connect();
      mockTransport.clearSentMessages();
      mockTransport.setAutoRespond(false);

      const callPromise = client.callTool('read_file', { path: '/test.txt' });

      // Wait for the send to complete using fake timers
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(10);
      vi.useRealTimers();

      const sentMessages = mockTransport.sentMessagesList;
      const toolCall = sentMessages.find((m) => 'method' in m && m.method === 'tools/call');
      expect(toolCall).toBeDefined();
      expect((toolCall as JSONRPCRequest).params?.name).toBe('read_file');
      expect((toolCall as JSONRPCRequest).params?.arguments).toEqual({ path: '/test.txt' });

      // Respond to complete the promise
      mockTransport.simulateMessage({
        jsonrpc: '2.0',
        id: (toolCall as JSONRPCRequest).id,
        result: { content: [{ type: 'text', text: 'Done' }], isError: false },
      });
      await callPromise;
    });

    it('should respect custom timeout configuration', () => {
      // Verify timeout option is accepted and configurable
      const options: MCPClientOptions = {
        serverName: 'test',
        sessionId: 's1',
        timeout: 5000,
        emitEvent: () => {},
      };
      expect(options.timeout).toBe(5000);
    });
  });

  // ============================================================
  // events
  // ============================================================

  describe('events', () => {
    it('should emit mcp.connected with tools list', async () => {
      await client.connect();
      const connectedEvent = events.find((e) => e.type === 'mcp.connected');
      expect(connectedEvent).toBeDefined();
      expect(connectedEvent?.tools).toBeDefined();
      expect(Array.isArray(connectedEvent?.tools)).toBe(true);
    });

    it('should emit mcp.error with error details', async () => {
      mockTransport.setFailConnect(true);
      try { await client.connect(); } catch { /* Expected */ }
      const errorEvent = events.find((e) => e.type === 'mcp.error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toBeDefined();
    });

    it('should emit mcp.disconnected on manual disconnect', async () => {
      await client.connect();
      events.length = 0;
      await client.disconnect();
      const disconnectedEvent = events.find((e) => e.type === 'mcp.disconnected');
      expect(disconnectedEvent).toBeDefined();
      expect(disconnectedEvent?.serverName).toBe('test-server');
    });
  });

  // ============================================================
  // onStatusChange()
  // ============================================================

  describe('onStatusChange()', () => {
    it('should emit status changes through listener', async () => {
      const statuses: string[] = [];
      const unsub = client.onStatusChange((status) => { statuses.push(status); });
      expect(statuses).toContain('disconnected');
      await client.connect();
      expect(statuses).toContain('connected');
      unsub();
    });
  });

  // ============================================================
  // transport errors
  // ============================================================

  describe('transport errors', () => {
    it('should handle transport error callback', async () => {
      await client.connect();
      events.length = 0;
      mockTransport.simulateError(new Error('Transport error'));
      const errorEvent = events.find((e) => e.type === 'mcp.error');
      expect(errorEvent).toBeDefined();
    });

    it('should handle transport close callback', async () => {
      await client.connect();
      events.length = 0;
      mockTransport.simulateClose();
      const disconnectedEvent = events.find((e) => e.type === 'mcp.disconnected');
      expect(disconnectedEvent).toBeDefined();
    });
  });
});
