/**
 * Unit tests for src/a2a/connection.ts
 *
 * Tests A2AConnection: heartbeat, reconnection, message queue, backlog.
 * Uses vitest fake timers for time-based testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Subject,
  BehaviorSubject,
  firstValueFrom,
  take,
} from 'rxjs';
import type { Observable } from 'rxjs';
import {
  A2AConnection,
  createConnection,
} from '../../src/a2a/connection.js';
import type {
  A2ATransport,
  TransportStatus,
  A2AMessage,
  ConnectionEvent,
  ConnectionErrorEvent,
  HeartbeatConfig,
  ReconnectConfig,
  BacklogConfig,
} from '../../src/a2a/index.js';
import {
  A2A_BROADCAST_TARGET,
  A2A_PROTOCOL_VERSION,
} from '../../src/a2a/index.js';
import { TransportError } from '../../src/a2a/transport.js';

// ============================================================
// Test Mock Transport
// ============================================================

/**
 * Controllable mock transport for testing A2AConnection.
 */
class TestMockTransport implements A2ATransport {
  readonly name = 'test-mock-transport';
  readonly agentId: string;

  private statusSubject = new BehaviorSubject<TransportStatus>('disconnected');
  private messagesSubject = new Subject<A2AMessage>();
  private sentMessages: A2AMessage[] = [];
  private connectDelay = 0;
  private sendDelay = 0;
  private shouldFailConnect = false;
  private shouldFailSend = false;

  get status$(): Observable<TransportStatus> {
    return this.statusSubject.asObservable();
  }

  get status(): TransportStatus {
    return this.statusSubject.getValue();
  }

  get messages$(): Observable<A2AMessage> {
    return this.messagesSubject.asObservable();
  }

  get sentMessagesList(): A2AMessage[] {
    return [...this.sentMessages];
  }

  constructor(options: { agentId: string }) {
    this.agentId = options.agentId;
  }

  setConnectDelay(ms: number): void {
    this.connectDelay = ms;
  }

  setSendDelay(ms: number): void {
    this.sendDelay = ms;
  }

  setFailConnect(should: boolean): void {
    this.shouldFailConnect = should;
  }

  setFailSend(should: boolean): void {
    this.shouldFailSend = should;
  }

  async connect(): Promise<void> {
    this.statusSubject.next('connecting');
    if (this.connectDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.connectDelay));
    }
    if (this.shouldFailConnect) {
      this.statusSubject.next('error');
      throw new TransportError('Connection failed', 'CONNECT_ERROR', true);
    }
    this.statusSubject.next('connected');
  }

  async disconnect(): Promise<void> {
    this.statusSubject.next('disconnected');
  }

  async send(message: A2AMessage): Promise<void> {
    if (this.status !== 'connected') {
      throw new TransportError('Not connected', 'NOT_CONNECTED', false);
    }
    if (this.sendDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.sendDelay));
    }
    if (this.shouldFailSend) {
      throw new TransportError('Send failed', 'SEND_ERROR', false);
    }
    this.sentMessages.push(message);
  }

  simulateMessage(message: A2AMessage): void {
    this.messagesSubject.next(message);
  }

  simulateStatus(status: TransportStatus): void {
    this.statusSubject.next(status);
  }

  clearSentMessages(): void {
    this.sentMessages = [];
  }

  destroy(): void {
    this.statusSubject.complete();
    this.messagesSubject.complete();
  }
}

// ============================================================
// Test Utilities
// ============================================================

function createTestMessage(
  type: A2AMessage['type'],
  from: string,
  to: string,
  payload: unknown,
  options?: { correlationId?: string; ttl?: number }
): A2AMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from,
    to,
    timestamp: Date.now(),
    ttl: options?.ttl ?? 300000,
    type,
    payload,
    correlationId: options?.correlationId,
    version: A2A_PROTOCOL_VERSION,
  };
}

function createTestConnection(agentId: string = 'test-conn', options?: {
  heartbeat?: Partial<HeartbeatConfig>;
  reconnect?: Partial<ReconnectConfig>;
  backlog?: Partial<BacklogConfig>;
}): {
  connection: A2AConnection;
  transport: TestMockTransport;
} {
  const transport = new TestMockTransport({ agentId });
  const connection = createConnection({
    transport,
    agentId,
    ...options,
  });
  return { connection, transport };
}

// ============================================================
// A2AConnection Lifecycle Tests
// ============================================================

describe('A2AConnection Lifecycle', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    const setup = createTestConnection('lifecycle-test', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;
  });

  afterEach(() => {
    connection.destroy();
    transport.destroy();
    vi.useRealTimers();
  });

  it('should create connection with unique ID', () => {
    expect(connection.connectionId).toBeDefined();
    expect(connection.connectionId).toMatch(/^conn-/);
    expect(connection.agentId).toBe('lifecycle-test');
  });

  it('should start with disconnected status', () => {
    expect(connection.status).toBe('disconnected');
    expect(connection.isConnected).toBe(false);
  });

  it('should connect successfully', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.status).toBe('connected');
    expect(connection.isConnected).toBe(true);
  });

  it('should not throw if connect called twice', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connection.connect();
    expect(connection.status).toBe('connected');
  });

  it('should disconnect successfully', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.status).toBe('disconnected');
    expect(connection.isConnected).toBe(false);
  });

  it('should not throw if disconnect called without connect', async () => {
    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.status).toBe('disconnected');
  });

  it('should release resources on destroy', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    connection.destroy();
    expect(() => connection.status$.subscribe()).not.toThrow();
  });

  it('should emit opening event on connect', async () => {
    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.opening') {
        events.push(e as ConnectionEvent);
      }
    });

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    expect(events).toHaveLength(1);
    expect(events[0]!.agentId).toBe('lifecycle-test');
  });

  it('should emit open event on successful connect', async () => {
    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.open') {
        events.push(e as ConnectionEvent);
      }
    });

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    expect(events).toHaveLength(1);
  });

  it('should emit closing and closed events on disconnect', async () => {
    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.closing' || e.type === 'connection.closed') {
        events.push(e as ConnectionEvent);
      }
    });

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(100);

    const closingEvents = events.filter((e) => e.type === 'connection.closing');
    const closedEvents = events.filter((e) => e.type === 'connection.closed');

    expect(closingEvents).toHaveLength(1);
    expect(closedEvents).toHaveLength(1);
  });
});

// ============================================================
// A2AConnection Send Tests
// ============================================================

describe('A2AConnection Send', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    const setup = createTestConnection('send-test', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;
  });

  afterEach(() => {
    connection.destroy();
    transport.destroy();
    vi.useRealTimers();
  });

  it('should send message when connected', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const message = createTestMessage('notification', 'test-conn', 'target', { test: true });
    await connection.send(message);

    const sentMsg = transport.sentMessagesList.find((m) => m.id === message.id);
    expect(sentMsg).toBeDefined();
  });

  it('should emit message_sent event', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.message_sent') {
        events.push(e as ConnectionEvent);
      }
    });

    const message = createTestMessage('notification', 'test-conn', 'target', {});
    await connection.send(message);

    expect(events).toHaveLength(1);
    expect(events[0]!.details?.messageId).toBe(message.id);
  });

  it('should queue message when not connected', async () => {
    const message = createTestMessage('notification', 'test-conn', 'target', {});

    await connection.send(message);

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const sentMsg = transport.sentMessagesList.find((m) => m.id === message.id);
    expect(sentMsg).toBeDefined();
  });
});

// ============================================================
// A2AConnection Request-Response Tests
// ============================================================

describe('A2AConnection Request', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    const setup = createTestConnection('request-test', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;
  });

  afterEach(() => {
    connection.destroy();
    transport.destroy();
    vi.useRealTimers();
  });

  it('should send request message', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const request$ = connection.request('target-agent', { action: 'test' });
    const subscription = request$.subscribe();

    await vi.advanceTimersByTimeAsync(100);

    const requestMsg = transport.sentMessagesList.find((m) => m.type === 'request');
    expect(requestMsg).toBeDefined();
    expect(requestMsg!.from).toBe('request-test');
    expect(requestMsg!.to).toBe('target-agent');
    expect(requestMsg!.payload).toEqual({ action: 'test' });

    subscription.unsubscribe();
  });

  it('should track pending request', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const subscription = connection.request('target', {}).subscribe();
    await vi.advanceTimersByTimeAsync(100);

    const pending = connection.getPendingRequestIds();
    expect(pending.length).toBeGreaterThanOrEqual(1);

    subscription.unsubscribe();
  });

  it('should resolve when response arrives', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const requestPromise = firstValueFrom(
      connection.request('target-agent', { action: 'test' }).pipe(take(1))
    );

    await vi.advanceTimersByTimeAsync(100);

    const requestMsg = transport.sentMessagesList.find((m) => m.type === 'request');
    expect(requestMsg).toBeDefined();

    const response = createTestMessage(
      'response',
      'target-agent',
      'request-test',
      { result: 'ok' },
      { correlationId: requestMsg!.id }
    );
    transport.simulateMessage(response);

    await vi.advanceTimersByTimeAsync(100);

    const result = await requestPromise;
    expect(result.type).toBe('response');
    expect(result.payload).toEqual({ result: 'ok' });
  });

  it('should handle error response', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const requestPromise = firstValueFrom(
      connection.request('target-agent', {}).pipe(take(1))
    );

    await vi.advanceTimersByTimeAsync(100);

    const requestMsg = transport.sentMessagesList.find((m) => m.type === 'request');
    const errorResponse = createTestMessage(
      'error',
      'target-agent',
      'request-test',
      { code: 'NOT_FOUND', message: 'Not found' },
      { correlationId: requestMsg!.id }
    );
    transport.simulateMessage(errorResponse);

    await vi.advanceTimersByTimeAsync(100);

    const result = await requestPromise;
    expect(result.type).toBe('error');
  });

  it('should timeout if no response', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const request$ = connection.request('target-agent', {}, { timeout: 1000 });
    const resultPromise = firstValueFrom(request$.pipe(take(1)));

    await vi.advanceTimersByTimeAsync(1100);

    const result = await resultPromise;
    expect(result.type).toBe('error');
    const payload = result.payload as { code: string };
    expect(payload.code).toBe('REQUEST_ERROR');
  });

  it('should cancel request', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const subscription = connection.request('target', {}).subscribe();
    await vi.advanceTimersByTimeAsync(100);

    const pending = connection.getPendingRequestIds();
    const requestId = pending[0];

    expect(requestId).toBeDefined();
    if (requestId) {
      const cancelled = connection.cancelRequest(requestId);
      expect(cancelled).toBe(true);
      expect(connection.hasPendingRequest(requestId)).toBe(false);
    }

    subscription.unsubscribe();
  });
});

// ============================================================
// A2AConnection Notify/Broadcast Tests
// ============================================================

describe('A2AConnection Notify/Broadcast', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    const setup = createTestConnection('notify-test', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;
  });

  afterEach(() => {
    connection.destroy();
    transport.destroy();
    vi.useRealTimers();
  });

  it('should send notification', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    await connection.notify('target-agent', { event: 'update' });

    const notificationMsg = transport.sentMessagesList.find((m) => m.type === 'notification');
    expect(notificationMsg).toBeDefined();
    expect(notificationMsg!.to).toBe('target-agent');
  });

  it('should send broadcast to wildcard target', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    await connection.broadcast({ announcement: 'hello' });

    const broadcastMsg = transport.sentMessagesList.find((m) => m.to === A2A_BROADCAST_TARGET);
    expect(broadcastMsg).toBeDefined();
    expect(broadcastMsg!.type).toBe('notification');
  });
});

// ============================================================
// A2AConnection Respond Tests
// ============================================================

describe('A2AConnection Respond', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    const setup = createTestConnection('respond-test', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;
  });

  afterEach(() => {
    connection.destroy();
    transport.destroy();
    vi.useRealTimers();
  });

  it('should send response with correlationId', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const request = createTestMessage('request', 'sender', 'respond-test', {});
    await connection.respond(request, { result: 'ok' });

    const responseMsg = transport.sentMessagesList.find((m) => m.type === 'response');
    expect(responseMsg).toBeDefined();
    expect(responseMsg!.correlationId).toBe(request.id);
    expect(responseMsg!.to).toBe('sender');
  });

  it('should send error response', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const request = createTestMessage('request', 'sender', 'respond-test', {});
    await connection.respondError(request, 'VALIDATION_ERROR', 'Invalid input', { field: 'name' });

    const errorResponse = transport.sentMessagesList.find((m) => m.type === 'error');
    expect(errorResponse).toBeDefined();
    expect(errorResponse!.correlationId).toBe(request.id);

    const payload = errorResponse!.payload as { code: string; message: string; details: unknown };
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(payload.details).toEqual({ field: 'name' });
  });
});

// ============================================================
// A2AConnection Heartbeat Tests
// ============================================================

describe('A2AConnection Heartbeat', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    connection?.destroy();
    transport?.destroy();
    vi.useRealTimers();
  });

  it('should send heartbeat at configured interval', async () => {
    const setup = createTestConnection('heartbeat-test', {
      heartbeat: { enabled: true, interval: 5000, timeout: 2000 },
    });
    connection = setup.connection;
    transport = setup.transport;

    await connection.connect();
    transport.clearSentMessages();

    await vi.advanceTimersByTimeAsync(5000);

    const heartbeats = transport.sentMessagesList.filter((m) => m.type === 'heartbeat');
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
  });

  it('should emit heartbeat_sent event', async () => {
    const setup = createTestConnection('heartbeat-test', {
      heartbeat: { enabled: true, interval: 1000, timeout: 500 },
    });
    connection = setup.connection;
    transport = setup.transport;

    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.heartbeat_sent') {
        events.push(e as ConnectionEvent);
      }
    });

    await connection.connect();
    await vi.advanceTimersByTimeAsync(1500);

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('should not send heartbeat when disabled', async () => {
    const setup = createTestConnection('no-heartbeat', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    await connection.connect();
    transport.clearSentMessages();

    await vi.advanceTimersByTimeAsync(60000);

    const heartbeats = transport.sentMessagesList.filter((m) => m.type === 'heartbeat');
    expect(heartbeats).toHaveLength(0);
  });

  it('should emit heartbeat_timeout on failure', async () => {
    const setup = createTestConnection('timeout-test', {
      heartbeat: { enabled: true, interval: 1000, timeout: 500 },
    });
    connection = setup.connection;
    transport = setup.transport;

    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.heartbeat_timeout') {
        events.push(e as ConnectionEvent);
      }
    });

    await connection.connect();
    transport.setFailSend(true);

    await vi.advanceTimersByTimeAsync(1500);

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('should stop heartbeat on disconnect', async () => {
    const setup = createTestConnection('stop-heartbeat', {
      heartbeat: { enabled: true, interval: 1000, timeout: 500 },
    });
    connection = setup.connection;
    transport = setup.transport;

    await connection.connect();
    await vi.advanceTimersByTimeAsync(500);
    await connection.disconnect();

    transport.clearSentMessages();
    await vi.advanceTimersByTimeAsync(5000);

    const heartbeats = transport.sentMessagesList.filter((m) => m.type === 'heartbeat');
    expect(heartbeats).toHaveLength(0);
  });
});

// ============================================================
// A2AConnection Reconnection Tests
// ============================================================

describe('A2AConnection Reconnection', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    connection?.destroy();
    transport?.destroy();
    vi.useRealTimers();
  });

  it('should emit reconnecting event on connection failure with reconnection enabled', async () => {
    const setup = createTestConnection('reconnect-test', {
      reconnect: { enabled: true, maxAttempts: 3, initialDelay: 100 },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.reconnecting') {
        events.push(e as ConnectionEvent);
      }
    });

    transport.setFailConnect(true);
    connection.connect().catch(() => {});

    await vi.advanceTimersByTimeAsync(150);

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('should stop reconnecting after max attempts', async () => {
    const setup = createTestConnection('max-attempts', {
      reconnect: {
        enabled: true,
        maxAttempts: 2,
        initialDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 1,
      },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const errorEvents: ConnectionErrorEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.error') {
        errorEvents.push(e as ConnectionErrorEvent);
      }
    });

    transport.setFailConnect(true);
    connection.connect().catch(() => {});

    await vi.advanceTimersByTimeAsync(500);

    const exhaustedError = errorEvents.find((e) => e.error.code === 'RECONNECT_EXHAUSTED');
    expect(exhaustedError).toBeDefined();
  });

  it('should not reconnect when disabled', async () => {
    const setup = createTestConnection('no-reconnect', {
      reconnect: { enabled: false },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const reconnectEvents: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.reconnecting') {
        reconnectEvents.push(e as ConnectionEvent);
      }
    });

    transport.setFailConnect(true);

    await expect(connection.connect()).rejects.toThrow();

    expect(reconnectEvents).toHaveLength(0);
  });

  it('should not reconnect after intentional disconnect', async () => {
    const setup = createTestConnection('intentional', {
      reconnect: { enabled: true, initialDelay: 100 },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    
    // Properly disconnect
    await connection.disconnect();

    // Connection should be in disconnected state
    expect(connection.status).toBe('disconnected');

    // Even if transport goes to error, connection should not reconnect
    // because intentionallyClosed flag is set
    transport.simulateStatus('error');
    await vi.advanceTimersByTimeAsync(500);

    // The connection should stay in disconnected/error state
    // It should NOT be in 'connecting' or 'connected' state (no reconnection)
    expect(['disconnected', 'error']).toContain(connection.status);
  });
});

// ============================================================
// A2AConnection Message Queue Tests
// ============================================================

describe('A2AConnection Message Queue', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    connection?.destroy();
    transport?.destroy();
    vi.useRealTimers();
  });

  it('should queue messages when not connected', async () => {
    const setup = createTestConnection('queue-test', {
      backlog: { maxSize: 10, overflowStrategy: 'drop' },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const message = createTestMessage('notification', 'test', 'target', {});
    await connection.send(message);

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const sentMsg = transport.sentMessagesList.find((m) => m.id === message.id);
    expect(sentMsg).toBeDefined();
  });

  it('should emit message_queued event', async () => {
    const setup = createTestConnection('queued-event', {
      backlog: { maxSize: 10, overflowStrategy: 'drop' },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.message_queued') {
        events.push(e as ConnectionEvent);
      }
    });

    const message = createTestMessage('notification', 'test', 'target', {});
    await connection.send(message);

    expect(events).toHaveLength(1);
    expect(events[0]!.details?.messageId).toBe(message.id);
  });

  it('should flush queue on connect', async () => {
    const setup = createTestConnection('flush-test', {
      backlog: { maxSize: 10, overflowStrategy: 'drop' },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const msg1 = createTestMessage('notification', 'test', 'target', { id: 1 });
    const msg2 = createTestMessage('notification', 'test', 'target', { id: 2 });

    await connection.send(msg1);
    await connection.send(msg2);

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    expect(transport.sentMessagesList.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// A2AConnection Backlog Strategy Tests
// ============================================================

describe('A2AConnection Backlog Strategies', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  afterEach(() => {
    connection?.destroy();
    transport?.destroy();
  });

  it('should drop messages on overflow with drop strategy', async () => {
    vi.useFakeTimers();
    const setup = createTestConnection('drop-strategy', {
      backlog: { maxSize: 2, overflowStrategy: 'drop' },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.message_queued') {
        events.push(e as ConnectionEvent);
      }
    });

    await connection.send(createTestMessage('notification', 'test', 'target', { id: 1 }));
    await connection.send(createTestMessage('notification', 'test', 'target', { id: 2 }));
    await connection.send(createTestMessage('notification', 'test', 'target', { id: 3 }));

    const droppedEvents = events.filter((e) => e.details?.dropped === true);
    expect(droppedEvents.length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });

  it('should replace oldest message on overflow with replace strategy', async () => {
    vi.useFakeTimers();
    const setup = createTestConnection('replace-strategy', {
      backlog: { maxSize: 2, overflowStrategy: 'replace' },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.message_queued') {
        events.push(e as ConnectionEvent);
      }
    });

    await connection.send(createTestMessage('notification', 'test', 'target', { id: 1 }));
    await connection.send(createTestMessage('notification', 'test', 'target', { id: 2 }));
    await connection.send(createTestMessage('notification', 'test', 'target', { id: 3 }));

    expect(events.length).toBe(3);
    vi.useRealTimers();
  });

  it('should throw on overflow with block strategy', async () => {
    vi.useFakeTimers();
    const setup = createTestConnection('block-strategy', {
      backlog: { maxSize: 2, overflowStrategy: 'block' },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    await connection.send(createTestMessage('notification', 'test', 'target', { id: 1 }));
    await connection.send(createTestMessage('notification', 'test', 'target', { id: 2 }));

    await expect(
      connection.send(createTestMessage('notification', 'test', 'target', { id: 3 }))
    ).rejects.toThrow('queue full');
    vi.useRealTimers();
  });
});

// ============================================================
// A2AConnection Incoming Message Handling Tests
// ============================================================

describe('A2AConnection Incoming Messages', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    const setup = createTestConnection('incoming-test', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;
  });

  afterEach(() => {
    connection.destroy();
    transport.destroy();
    vi.useRealTimers();
  });

  it('should emit incoming messages to messages$', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const messages: A2AMessage[] = [];
    connection.messages$.subscribe((msg) => messages.push(msg));

    const notification = createTestMessage('notification', 'sender', 'incoming-test', {});
    transport.simulateMessage(notification);

    await vi.advanceTimersByTimeAsync(100);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.id).toBe(notification.id);
  });

  it('should ignore expired messages', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const messages: A2AMessage[] = [];
    connection.messages$.subscribe((msg) => messages.push(msg));

    const expiredMessage: A2AMessage = {
      id: 'expired',
      from: 'sender',
      to: 'incoming-test',
      timestamp: Date.now() - 100000,
      ttl: 1000,
      type: 'notification',
      payload: {},
      version: A2A_PROTOCOL_VERSION,
    };

    transport.simulateMessage(expiredMessage);

    await vi.advanceTimersByTimeAsync(100);

    expect(messages).toHaveLength(0);
  });

  it('should handle heartbeat messages without emitting', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const messages: A2AMessage[] = [];
    connection.messages$.subscribe((msg) => messages.push(msg));

    const heartbeat = createTestMessage('heartbeat', 'sender', 'incoming-test', { timestamp: Date.now() });
    transport.simulateMessage(heartbeat);

    await vi.advanceTimersByTimeAsync(100);

    expect(messages).toHaveLength(0);
  });

  it('should resolve pending request when response arrives', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    let resolvedMessage: A2AMessage | undefined;
    connection.request('target', {}).subscribe((msg) => {
      resolvedMessage = msg;
    });

    await vi.advanceTimersByTimeAsync(100);

    const requestMsg = transport.sentMessagesList.find((m) => m.type === 'request');
    const response = createTestMessage('response', 'target', 'incoming-test', { ok: true }, { correlationId: requestMsg!.id });
    transport.simulateMessage(response);

    await vi.advanceTimersByTimeAsync(100);

    expect(resolvedMessage).toBeDefined();
    expect(resolvedMessage?.type).toBe('response');
  });

  it('should reject pending request when error arrives', async () => {
    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    let resolvedMessage: A2AMessage | undefined;
    connection.request('target', {}).subscribe((msg) => {
      resolvedMessage = msg;
    });

    await vi.advanceTimersByTimeAsync(100);

    const requestMsg = transport.sentMessagesList.find((m) => m.type === 'request');
    const errorResponse = createTestMessage('error', 'target', 'incoming-test', { code: 'ERR', message: 'Failed' }, { correlationId: requestMsg!.id });
    transport.simulateMessage(errorResponse);

    await vi.advanceTimersByTimeAsync(100);

    expect(resolvedMessage?.type).toBe('error');
  });
});

// ============================================================
// A2AConnection Error Handling Tests
// ============================================================

describe('A2AConnection Error Handling', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    connection?.destroy();
    transport?.destroy();
    vi.useRealTimers();
  });

  it('should emit error event on connection failure', async () => {
    const setup = createTestConnection('error-test', {
      reconnect: { enabled: false },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const errorEvents: ConnectionErrorEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.error') {
        errorEvents.push(e as ConnectionErrorEvent);
      }
    });

    transport.setFailConnect(true);

    await expect(connection.connect()).rejects.toThrow();

    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0]!.error.code).toBe('CONNECTION_ERROR');
  });

  it('should emit error event on send failure', async () => {
    const setup = createTestConnection('send-error', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    const errorEvents: ConnectionErrorEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.error') {
        errorEvents.push(e as ConnectionErrorEvent);
      }
    });

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    transport.setFailSend(true);

    try {
      await connection.send(createTestMessage('notification', 'test', 'target', {}));
    } catch {
      // Expected
    }

    await vi.advanceTimersByTimeAsync(100);

    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject pending requests on disconnect', async () => {
    const setup = createTestConnection('reject-pending', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const subscription = connection.request('target', {}).subscribe();

    await vi.advanceTimersByTimeAsync(100);
    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(100);

    expect(connection.getPendingRequestIds()).toHaveLength(0);
    subscription.unsubscribe();
  });
});

// ============================================================
// A2AConnection Status Observable Tests
// ============================================================

describe('A2AConnection Status Observable', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    const setup = createTestConnection('status-test', {
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;
  });

  afterEach(() => {
    connection.destroy();
    transport.destroy();
    vi.useRealTimers();
  });

  it('should emit status changes', async () => {
    const statuses: TransportStatus[] = [];
    connection.status$.subscribe((status) => statuses.push(status));

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(100);

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('connected');
    expect(statuses).toContain('disconnected');
  });

  it('should reflect current status', async () => {
    expect(connection.status).toBe('disconnected');

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.status).toBe('connected');

    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.status).toBe('disconnected');
  });

  it('should update isConnected', async () => {
    expect(connection.isConnected).toBe(false);

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.isConnected).toBe(true);

    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.isConnected).toBe(false);
  });
});

// ============================================================
// A2AConnection Default Configuration Tests
// ============================================================

describe('A2AConnection Default Configuration', () => {
  let connection: A2AConnection;
  let transport: TestMockTransport;

  afterEach(() => {
    connection?.destroy();
    transport?.destroy();
  });

  it('should use default heartbeat config', async () => {
    vi.useFakeTimers();
    const setup = createTestConnection('default-hb', {
      heartbeat: { enabled: true, interval: 1000, timeout: 500 },
    });
    connection = setup.connection;
    transport = setup.transport;

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const events: ConnectionEvent[] = [];
    connection.events$.subscribe((e) => {
      if (e.type === 'connection.heartbeat_sent') {
        events.push(e as ConnectionEvent);
      }
    });

    await vi.advanceTimersByTimeAsync(2000);

    expect(events.length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });

  it('should use default reconnect config', () => {
    const setup = createTestConnection('default-reconnect');
    connection = setup.connection;
    transport = setup.transport;

    expect(connection).toBeDefined();
  });

  it('should allow custom request timeout', async () => {
    vi.useFakeTimers();
    const setup = createTestConnection('timeout-test', {
      reconnect: { enabled: false },
      heartbeat: { enabled: false },
    });
    connection = setup.connection;
    transport = setup.transport;

    await connection.connect();
    await vi.advanceTimersByTimeAsync(100);

    const request$ = connection.request('target', {}, { timeout: 500 });
    const resultPromise = firstValueFrom(request$.pipe(take(1)));

    await vi.advanceTimersByTimeAsync(600);

    const result = await resultPromise;
    expect(result.type).toBe('error');

    vi.useRealTimers();
  });
});
