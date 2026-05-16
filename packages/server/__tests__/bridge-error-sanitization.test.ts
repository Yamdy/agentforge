import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketBridge } from '../src/bridge/bridge.js';
import type { AgentRegistry } from '../src/registry.js';
import type { Agent } from '@agentforge/core';

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

describe('Error message sanitization', () => {
  let bridge: WebSocketBridge;
  let mockAgent: Agent;

  beforeEach(() => {
    mockAgent = createMockAgent();
    bridge = new WebSocketBridge(createMockRegistry(mockAgent));
  });

  it('scrubs API key patterns from error messages sent to client (run)', async () => {
    (mockAgent as any).run.mockRejectedValueOnce(
      new Error('OpenAI API error: Invalid API key sk-abc123def456ghi789')
    );
    const socket = createMockSocket();
    bridge.handleUpgrade(socket);

    socket.emit('message', JSON.stringify({
      type: 'run',
      agentId: 'test-agent',
      input: 'test',
      requestId: 'req-1',
    }));

    await vi.waitFor(() => {
      const errs = socket.sentMessages().filter((m: any) => m.type === 'error');
      expect(errs).toHaveLength(1);
    });

    const err = socket.sentMessages().find((m: any) => m.type === 'error');
    expect(err.message).not.toContain('sk-abc123');
    expect(err.message).not.toContain('sk-');
    expect(err.message).toBeTruthy();
    expect(err.correlationId).toBeDefined();
    expect(typeof err.correlationId).toBe('string');
    expect(err.correlationId.length).toBeGreaterThan(0);
  });

  it('scrubs internal URLs from error messages (resume)', async () => {
    (mockAgent as any).resume.mockRejectedValueOnce(
      new Error('Connection refused to http://internal-db.corp.local:5432/session')
    );
    const socket = createMockSocket();
    bridge.handleUpgrade(socket);

    socket.emit('message', JSON.stringify({
      type: 'resume',
      agentId: 'test-agent',
      sessionId: 's-1',
      requestId: 'req-2',
    }));

    await vi.waitFor(() => {
      const errs = socket.sentMessages().filter((m: any) => m.type === 'error');
      expect(errs).toHaveLength(1);
    });

    const err = socket.sentMessages().find((m: any) => m.type === 'error');
    expect(err.message).not.toContain('http://internal-db');
    expect(err.message).not.toContain('corp.local');
    expect(err.message).toBeTruthy();
    expect(err.correlationId).toBeDefined();
  });

  it('scrubs API key patterns from stream errors', async () => {
    (mockAgent as any).streamEvents.mockImplementationOnce(async function* () {
      throw new Error('Rate limited for key key-azure-openai-abc123xyz');
      yield undefined as never;
    });
    const socket = createMockSocket();
    bridge.handleUpgrade(socket);

    socket.emit('message', JSON.stringify({
      type: 'stream',
      agentId: 'test-agent',
      input: 'fail',
      requestId: 'req-s1',
    }));

    await vi.waitFor(() => {
      const errs = socket.sentMessages().filter((m: any) => m.type === 'error');
      expect(errs).toHaveLength(1);
    });

    const err = socket.sentMessages().find((m: any) => m.type === 'error');
    expect(err.message).not.toContain('key-azure');
    expect(err.message).not.toContain('abc123xyz');
    expect(err.message).toBeTruthy();
    expect(err.correlationId).toBeDefined();
  });

  it('returns generic user-safe messages without leaking internals', async () => {
    (mockAgent as any).run.mockRejectedValueOnce(
      new Error('ECONNREFUSED 10.0.1.50:6379 at TCPConnectWrap.afterConnect')
    );
    const socket = createMockSocket();
    bridge.handleUpgrade(socket);

    socket.emit('message', JSON.stringify({
      type: 'run',
      agentId: 'test-agent',
      input: 'test',
      requestId: 'req-3',
    }));

    await vi.waitFor(() => {
      const errs = socket.sentMessages().filter((m: any) => m.type === 'error');
      expect(errs).toHaveLength(1);
    });

    const err = socket.sentMessages().find((m: any) => m.type === 'error');
    expect(err.message).not.toContain('10.0.1.50');
    expect(err.message).not.toContain('6379');
    expect(err.message).not.toContain('TCPConnectWrap');
    expect(err.message).toBeTruthy();
    expect(err.correlationId).toBeDefined();
  });

  it('correlation IDs are unique across different errors', async () => {
    const correlationIds = new Set<string>();

    for (let i = 0; i < 3; i++) {
      (mockAgent as any).run.mockRejectedValueOnce(new Error('fail ' + i));
      const socket = createMockSocket();
      bridge.handleUpgrade(socket);

      socket.emit('message', JSON.stringify({
        type: 'run',
        agentId: 'test-agent',
        input: 'test',
        requestId: 'req-' + i,
      }));

      await vi.waitFor(() => {
        const errs = socket.sentMessages().filter((m: any) => m.type === 'error');
        expect(errs).toHaveLength(1);
      });

      const err = socket.sentMessages().find((m: any) => m.type === 'error');
      correlationIds.add(err.correlationId);
    }

    expect(correlationIds.size).toBe(3);
  });
});
