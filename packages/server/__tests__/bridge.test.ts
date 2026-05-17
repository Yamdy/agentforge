import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketBridge, type WSMessage, type WSSocket } from '../src/bridge/bridge.js';
import type { AgentRegistry } from '../src/registry.js';
import type { Agent } from '@primo-ai/core';
import type { StreamEvent } from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// Helpers — lightweight WS mock
// ---------------------------------------------------------------------------

function createMockSocket() {
  const sent: string[] = [];
  const listeners: Record<string, Function[]> = {};
  const socket = {
    send: vi.fn((data: string) => { sent.push(data); }),
    close: vi.fn(),
    on: vi.fn((event: string, handler: Function) => {
      (listeners[event] ??= []).push(handler);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const handler of listeners[event] ?? []) handler(...args);
    },
    sentMessages(): WSMessage[] {
      return sent.map((s) => JSON.parse(s));
    },
    lastMessage(): WSMessage | undefined {
      if (sent.length === 0) return undefined;
      return JSON.parse(sent[sent.length - 1]);
    },
    readyState: 1, // OPEN
  };
  return socket;
}


function createMockAgent() {
  return {
    run: vi.fn().mockResolvedValue({
      response: 'mock response',
      tokenUsage: { input: 10, output: 20 },
      sessionId: 'session-1',
    }),
    stream: vi.fn().mockImplementation(async function* () {
      yield 'Hello ';
      yield 'World';
    }),
    streamEvents: vi.fn().mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'Hello ' } as StreamEvent;
      yield { type: 'text_delta', text: 'World' } as StreamEvent;
      yield { type: 'complete', context: undefined } as unknown as StreamEvent;
    }),
    resume: vi.fn().mockResolvedValue({
      response: 'resumed response',
      tokenUsage: { input: 5, output: 10 },
      sessionId: 'session-1',
    }),
    state: 'pending' as string,
  } as unknown as Agent;
}

function createMockRegistry(agent: Agent): AgentRegistry {
  return {
    get: vi.fn().mockReturnValue(agent),
    register: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    remove: vi.fn(),
  } as unknown as AgentRegistry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketBridge', () => {
  let bridge: WebSocketBridge;
  let mockAgent: Agent;
  let mockRegistry: AgentRegistry;

  beforeEach(() => {
    mockAgent = createMockAgent();
    mockRegistry = createMockRegistry(mockAgent);
    bridge = new WebSocketBridge(mockRegistry);
  });

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  describe('connection lifecycle', () => {
    it('accepts a new connection and assigns a connection ID', () => {
      const socket = createMockSocket();
      const conn = bridge.handleUpgrade(socket as unknown as WSSocket);

      expect(conn).toBeDefined();
      expect(conn.id).toBeTruthy();
      expect(conn.id).toMatch(/^ws-/);
    });

    it('tracks active connections', () => {
      const s1 = createMockSocket();
      const s2 = createMockSocket();
      bridge.handleUpgrade(s1 as unknown as WSSocket);
      bridge.handleUpgrade(s2 as unknown as WSSocket);

      expect(bridge.connectionCount).toBe(2);
    });

    it('removes connection on close', () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      expect(bridge.connectionCount).toBe(1);
      socket.emit('close');
      expect(bridge.connectionCount).toBe(0);
    });

    it('sends pong in response to ping', () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({ type: 'ping' }));
      const last = socket.lastMessage();
      expect(last).toEqual({ type: 'pong' });
    });
  });

  // ---------------------------------------------------------------------------
  // Run command
  // ---------------------------------------------------------------------------

  describe('run command', () => {
    it('runs an agent and returns the result', async () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'run',
        agentId: 'test-agent',
        input: 'Hello agent',
        requestId: 'req-1',
      }));

      // Wait for async handler to complete
      await vi.waitFor(() => {
        const msgs = socket.sentMessages().filter((m) => m.type === 'run_result');
        expect(msgs).toHaveLength(1);
      });

      const msg = socket.sentMessages().find((m) => m.type === 'run_result')!;
      expect(msg).toMatchObject({
        type: 'run_result',
        requestId: 'req-1',
        response: 'mock response',
        tokenUsage: { input: 10, output: 20 },
        sessionId: 'session-1',
      });

      expect(mockAgent.run).toHaveBeenCalledWith('Hello agent');
    });

    it('sends error when agent not found', async () => {
      (mockRegistry.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'run',
        agentId: 'missing',
        input: 'test',
        requestId: 'req-2',
      }));

      await vi.waitFor(() => {
        const errs = socket.sentMessages().filter((m) => m.type === 'error');
        expect(errs).toHaveLength(1);
      });

      const err = socket.sentMessages().find((m) => m.type === 'error')!;
      expect(err.requestId).toBe('req-2');
      expect(err.message).toContain('not found');
    });

    it('sends error on agent run failure', async () => {
      (mockAgent.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('LLM failure'));
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'run',
        agentId: 'test-agent',
        input: 'fail',
        requestId: 'req-3',
      }));

      await vi.waitFor(() => {
        const errs = socket.sentMessages().filter((m) => m.type === 'error');
        expect(errs).toHaveLength(1);
      });

      const err = socket.sentMessages().find((m) => m.type === 'error')!;
      expect(err.requestId).toBe('req-3');
      expect(err.message).toBe('LLM failure');
    });
  });

  // ---------------------------------------------------------------------------
  // Stream command
  // ---------------------------------------------------------------------------

  describe('stream command', () => {
    it('streams text deltas to the client', async () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'stream',
        agentId: 'test-agent',
        input: 'Stream this',
        requestId: 'req-s1',
      }));

      await vi.waitFor(() => {
        const completes = socket.sentMessages().filter((m) => m.type === 'stream_complete');
        expect(completes).toHaveLength(1);
      });

      const deltas = socket.sentMessages().filter((m) => m.type === 'stream_event');
      // Mock yields: text_delta("Hello "), text_delta("World"), complete
      expect(deltas).toHaveLength(3);
      expect(deltas[0]).toMatchObject({ type: 'stream_event', event: { type: 'text_delta', text: 'Hello ' } });
      expect(deltas[1]).toMatchObject({ type: 'stream_event', event: { type: 'text_delta', text: 'World' } });
      expect(deltas[2]).toMatchObject({ type: 'stream_event', event: { type: 'complete' } });

      const complete = socket.sentMessages().find((m) => m.type === 'stream_complete')!;
      expect(complete.requestId).toBe('req-s1');
    });

    it('sends error when stream fails', async () => {
      (mockAgent.streamEvents as ReturnType<typeof vi.fn>).mockImplementationOnce(async function* () {
        throw new Error('Stream exploded');
        yield undefined as never;
      });
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'stream',
        agentId: 'test-agent',
        input: 'fail-stream',
        requestId: 'req-s2',
      }));

      await vi.waitFor(() => {
        const errs = socket.sentMessages().filter((m) => m.type === 'error');
        expect(errs).toHaveLength(1);
      });

      const err = socket.sentMessages().find((m) => m.type === 'error')!;
      expect(err.requestId).toBe('req-s2');
      expect(err.message).toBe('Stream exploded');
    });
  });

  // ---------------------------------------------------------------------------
  // Resume command
  // ---------------------------------------------------------------------------

  describe('resume command', () => {
    it('resumes an agent session and returns the result', async () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'resume',
        agentId: 'test-agent',
        sessionId: 'session-1',
        requestId: 'req-r1',
      }));

      await vi.waitFor(() => {
        const msgs = socket.sentMessages().filter((m) => m.type === 'run_result');
        expect(msgs).toHaveLength(1);
      });

      const msg = socket.sentMessages().find((m) => m.type === 'run_result')!;
      expect(msg).toMatchObject({
        type: 'run_result',
        requestId: 'req-r1',
        response: 'resumed response',
        sessionId: 'session-1',
      });

      expect(mockAgent.resume).toHaveBeenCalledWith('session-1');
    });

    it('sends error when agent not found for resume', async () => {
      (mockRegistry.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'resume',
        agentId: 'missing',
        sessionId: 's-1',
        requestId: 'req-r2',
      }));

      await vi.waitFor(() => {
        const errs = socket.sentMessages().filter((m) => m.type === 'error');
        expect(errs).toHaveLength(1);
      });

      const err = socket.sentMessages().find((m) => m.type === 'error')!;
      expect(err.requestId).toBe('req-r2');
      expect(err.message).toContain('not found');
    });
  });

  // ---------------------------------------------------------------------------
  // Cancel command
  // ---------------------------------------------------------------------------

  describe('cancel command', () => {
    it('aborts an active stream', async () => {
      // Make stream hang so we can cancel it
      let streamStarted = false;
      let resolveHang: () => void = () => {};
      const hangPromise = new Promise<void>((r) => { resolveHang = r; });

      (mockAgent.streamEvents as ReturnType<typeof vi.fn>).mockImplementationOnce(async function* () {
        streamStarted = true;
        await hangPromise;
        yield { type: 'complete' } as StreamEvent;
      });

      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'stream',
        agentId: 'test-agent',
        input: 'long-running',
        requestId: 'req-c1',
      }));

      // Wait for stream to start
      await vi.waitFor(() => expect(streamStarted).toBe(true));

      socket.emit('message', JSON.stringify({
        type: 'cancel',
        requestId: 'req-c1',
      }));

      const cancelAck = socket.sentMessages().find((m) => m.type === 'cancelled');
      expect(cancelAck).toMatchObject({ type: 'cancelled', requestId: 'req-c1' });

      resolveHang();
    });
  });

  // ---------------------------------------------------------------------------
  // State change notifications
  // ---------------------------------------------------------------------------

  describe('state notifications', () => {
    it('emits state events when agent state is readable', async () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      // Trigger a run which will cause state transitions
      socket.emit('message', JSON.stringify({
        type: 'run',
        agentId: 'test-agent',
        input: 'trigger state',
        requestId: 'req-st1',
      }));

      await vi.waitFor(() => {
        const results = socket.sentMessages().filter((m) => m.type === 'run_result');
        expect(results).toHaveLength(1);
      });

      const states = socket.sentMessages().filter((m) => m.type === 'state');
      // We expect at least one state notification during the run
      expect(states.length).toBeGreaterThanOrEqual(1);
      // Each state event should have agentId and state fields
      for (const s of states) {
        expect(s).toHaveProperty('agentId');
        expect(s).toHaveProperty('state');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling & protocol
  // ---------------------------------------------------------------------------

  describe('protocol validation', () => {
    it('sends error for unknown message type', async () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'unknown_command',
        requestId: 'req-u1',
      }));

      await vi.waitFor(() => {
        const errs = socket.sentMessages().filter((m) => m.type === 'error');
        expect(errs).toHaveLength(1);
      });

      const err = socket.sentMessages().find((m) => m.type === 'error')!;
      expect(err.requestId).toBe('req-u1');
      expect(err.message).toContain('Unknown');
    });

    it('sends error for malformed JSON', async () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', 'not valid json{{{');

      await vi.waitFor(() => {
        const errs = socket.sentMessages().filter((m) => m.type === 'error');
        expect(errs).toHaveLength(1);
      });

      const err = socket.sentMessages().find((m) => m.type === 'error')!;
      expect(err.message).toContain('Invalid');
    });

    it('sends error for missing required fields on run', async () => {
      const socket = createMockSocket();
      bridge.handleUpgrade(socket as unknown as WSSocket);

      socket.emit('message', JSON.stringify({
        type: 'run',
        // missing agentId and input
        requestId: 'req-bad',
      }));

      await vi.waitFor(() => {
        const errs = socket.sentMessages().filter((m) => m.type === 'error');
        expect(errs).toHaveLength(1);
      });

      const err = socket.sentMessages().find((m) => m.type === 'error')!;
      expect(err.requestId).toBe('req-bad');
      expect(err.message).toContain('required');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple concurrent connections
  // ---------------------------------------------------------------------------

  describe('concurrent connections', () => {
    it('supports multiple independent connections', async () => {
      const s1 = createMockSocket();
      const s2 = createMockSocket();
      bridge.handleUpgrade(s1 as unknown as WSSocket);
      bridge.handleUpgrade(s2 as unknown as WSSocket);

      expect(bridge.connectionCount).toBe(2);

      s1.emit('message', JSON.stringify({
        type: 'run',
        agentId: 'test-agent',
        input: 'from conn 1',
        requestId: 'r1',
      }));

      s2.emit('message', JSON.stringify({
        type: 'run',
        agentId: 'test-agent',
        input: 'from conn 2',
        requestId: 'r2',
      }));

      await vi.waitFor(() => {
        expect(s1.sentMessages().filter((m) => m.type === 'run_result')).toHaveLength(1);
        expect(s2.sentMessages().filter((m) => m.type === 'run_result')).toHaveLength(1);
      });

      // Responses go to correct connections
      expect(s1.sentMessages().find((m) => m.type === 'run_result')!.requestId).toBe('r1');
      expect(s2.sentMessages().find((m) => m.type === 'run_result')!.requestId).toBe('r2');
    });

    it('does not cross-contaminate messages between connections', async () => {
      const s1 = createMockSocket();
      const s2 = createMockSocket();
      bridge.handleUpgrade(s1 as unknown as WSSocket);
      bridge.handleUpgrade(s2 as unknown as WSSocket);

      s1.emit('message', JSON.stringify({ type: 'ping' }));
      s2.emit('message', JSON.stringify({ type: 'ping' }));

      // Each socket should get exactly one pong
      expect(s1.sentMessages().filter((m) => m.type === 'pong')).toHaveLength(1);
      expect(s2.sentMessages().filter((m) => m.type === 'pong')).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  describe('cleanup', () => {
    it('closeAll removes all connections', () => {
      const s1 = createMockSocket();
      const s2 = createMockSocket();
      bridge.handleUpgrade(s1 as unknown as WSSocket);
      bridge.handleUpgrade(s2 as unknown as WSSocket);

      expect(bridge.connectionCount).toBe(2);
      bridge.closeAll();
      expect(bridge.connectionCount).toBe(0);
      expect(s1.close).toHaveBeenCalled();
      expect(s2.close).toHaveBeenCalled();
    });
  });
});
