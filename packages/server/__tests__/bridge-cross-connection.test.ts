import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketBridge } from '../src/bridge/bridge.js';
import type { AgentRegistry } from '../src/registry.js';
import type { Agent } from '@primo-ai/core';

function createMockSocket() {
  const sent: string[] = [];
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  const socket = {
    send: vi.fn((data: string) => { sent.push(data); }),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...a: unknown[]) => void) => {
      (listeners[event] ??= []).push(handler);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const handler of listeners[event] ?? []) handler(...args);
    },
    sentMessages() {
      return sent.map((s) => JSON.parse(s));
    },
    readyState: 1,
  };
  return socket;
}

function createMockAgent(): Agent {
  return {
    run: vi.fn().mockResolvedValue({
      response: 'mock response',
      tokenUsage: { input: 10, output: 20 },
      sessionId: 'session-1',
    }),
    stream: vi.fn(),
    streamEvents: vi.fn().mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'Hello ' };
      yield { type: 'complete' };
    }),
    resume: vi.fn().mockResolvedValue({
      response: 'resumed response',
      tokenUsage: { input: 5, output: 10 },
      sessionId: 'session-1',
    }),
    state: 'pending',
  } as unknown as Agent;
}

function createMockRegistry(agent: Agent): AgentRegistry {
  return {
    get: vi.fn().mockReturnValue(agent),
    register: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    remove: vi.fn(),
    agents: new Map(),
    clear: vi.fn(),
  } as unknown as AgentRegistry;
}

describe('Cross-connection stream abort isolation', () => {
  let bridge: WebSocketBridge;
  let mockAgent: Agent;

  beforeEach(() => {
    mockAgent = createMockAgent();
    bridge = new WebSocketBridge(createMockRegistry(mockAgent));
  });

  it('disconnecting connection A does NOT abort connection B active streams', async () => {
    let resolveStreamB = () => {};
    let streamBStarted = false;
    let streamBAborted = false;
    let callCount = 0;

    (mockAgent as unknown as { streamEvents: { mockImplementation: (...args: unknown[]) => void } }).streamEvents.mockImplementation(
      async function* (_input: string, signal?: AbortSignal) {
        callCount++;
        if (callCount === 1) {
          yield { type: 'text_delta', text: 'A' };
          yield { type: 'complete' };
        } else {
          streamBStarted = true;
          signal?.addEventListener('abort', () => {
            streamBAborted = true;
          });
          await new Promise<void>((r) => { resolveStreamB = r; });
          yield { type: 'complete' };
        }
      }
    );

    const socketA = createMockSocket();
    const socketB = createMockSocket();
    bridge.handleUpgrade(socketA);
    bridge.handleUpgrade(socketB);

    socketA.emit('message', JSON.stringify({
      type: 'stream',
      agentId: 'test-agent',
      input: 'stream-A',
      requestId: 'req-A',
    }));

    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(1));

    socketB.emit('message', JSON.stringify({
      type: 'stream',
      agentId: 'test-agent',
      input: 'stream-B',
      requestId: 'req-B',
    }));

    await vi.waitFor(() => expect(streamBStarted).toBe(true));

    socketA.emit('close');
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(streamBAborted).toBe(false);

    resolveStreamB();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('cleanupConnection does NOT touch streams from other connections', async () => {
    let callCount = 0;
    let streamBAborted = false;
    let resolveStreamB = () => {};

    (mockAgent as unknown as { streamEvents: { mockImplementation: (...args: unknown[]) => void } }).streamEvents.mockImplementation(
      async function* (_input: string, signal?: AbortSignal) {
        callCount++;
        if (callCount === 1) {
          yield { type: 'complete' };
        } else {
          signal?.addEventListener('abort', () => {
            streamBAborted = true;
          });
          await new Promise<void>((r) => { resolveStreamB = r; });
          yield { type: 'complete' };
        }
      }
    );

    const socketA = createMockSocket();
    const socketB = createMockSocket();
    bridge.handleUpgrade(socketA);
    bridge.handleUpgrade(socketB);

    socketA.emit('message', JSON.stringify({
      type: 'stream',
      agentId: 'test-agent',
      input: 'A',
      requestId: 'req-A',
    }));

    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(1));

    socketB.emit('message', JSON.stringify({
      type: 'stream',
      agentId: 'test-agent',
      input: 'B',
      requestId: 'req-B',
    }));

    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));

    socketA.emit('close');
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(streamBAborted).toBe(false);

    resolveStreamB();
    await vi.waitFor(() => {
      const bCompletes = socketB.sentMessages().filter((m) => m.type === 'stream_complete');
      expect(bCompletes.length).toBe(1);
    });
  });

  it('multiple streams on the same connection are all cleaned up on disconnect', async () => {
    let callCount = 0;
    let stream1Aborted = false;
    let stream2Aborted = false;

    (mockAgent as unknown as { streamEvents: { mockImplementation: (...args: unknown[]) => void } }).streamEvents.mockImplementation(
      async function* (_input: string, signal?: AbortSignal) {
        callCount++;
        const idx = callCount;
        signal?.addEventListener('abort', () => {
          if (idx === 1) stream1Aborted = true;
          if (idx === 2) stream2Aborted = true;
        });
        if (idx === 1) {
          await new Promise<void>(() => {});
        } else {
          await new Promise<void>(() => {});
        }
        yield { type: 'complete' };
      }
    );

    const socket = createMockSocket();
    bridge.handleUpgrade(socket);

    socket.emit('message', JSON.stringify({
      type: 'stream',
      agentId: 'test-agent',
      input: 'first',
      requestId: 'req-1',
    }));

    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(1));

    socket.emit('message', JSON.stringify({
      type: 'stream',
      agentId: 'test-agent',
      input: 'second',
      requestId: 'req-2',
    }));

    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));

    socket.emit('close');
    await new Promise((r) => setTimeout(r, 50));

    expect(stream1Aborted).toBe(true);
    expect(stream2Aborted).toBe(true);
  });
});
