/**
 * Unit tests for src/a2a/transport.ts
 *
 * Tests transport factory, error classes, and defaults.
 */

import { describe, it, expect } from 'vitest';
import {
  // Factory
  createTransport,
  registerTransportFactory,
  hasTransportFactory,
  getRegisteredTransportTypes,
  // Defaults
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_HEARTBEAT_CONFIG,
  DEFAULT_BACKLOG_CONFIG,
  // Errors
  TransportError,
  TransportConnectionError,
  TransportSendError,
  TransportParseError,
} from '../../src/a2a/index.js';
import type { A2ATransport, A2ATransportOptions } from '../../src/a2a/index.js';
import { Subject, of } from 'rxjs';
import type { Observable } from 'rxjs';

// ============================================================
// Mock Transport for Factory Tests
// ============================================================

function createMockTransport(options: A2ATransportOptions): A2ATransport {
  const statusSubject = new Subject<string>();
  const messagesSubject = new Subject<import('../../src/a2a/index.js').A2AMessage>();

  return {
    name: 'mock',
    agentId: options.agentId,
    status: 'disconnected' as const,
    status$: statusSubject.asObservable() as Observable<import('../../src/a2a/index.js').TransportStatus>,
    messages$: messagesSubject.asObservable(),
    connect: async () => {
      // no-op
    },
    disconnect: async () => {
      // no-op
    },
    send: async () => {
      // no-op
    },
    destroy: () => {
      statusSubject.complete();
      messagesSubject.complete();
    },
  };
}

// ============================================================
// Default Configuration Tests
// ============================================================

describe('Default Configuration', () => {
  it('should have correct reconnect defaults', () => {
    expect(DEFAULT_RECONNECT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_RECONNECT_CONFIG.maxAttempts).toBe(5);
    expect(DEFAULT_RECONNECT_CONFIG.initialDelay).toBe(1000);
    expect(DEFAULT_RECONNECT_CONFIG.maxDelay).toBe(30000);
    expect(DEFAULT_RECONNECT_CONFIG.backoffMultiplier).toBe(2);
  });

  it('should have correct heartbeat defaults', () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_HEARTBEAT_CONFIG.interval).toBe(30000);
    expect(DEFAULT_HEARTBEAT_CONFIG.timeout).toBe(10000);
  });

  it('should have correct backlog defaults', () => {
    expect(DEFAULT_BACKLOG_CONFIG.maxSize).toBe(1000);
    expect(DEFAULT_BACKLOG_CONFIG.overflowStrategy).toBe('drop');
  });
});

// ============================================================
// Transport Factory Tests
// ============================================================

describe('Transport Factory', () => {
  afterEach(() => {
    // Clear registered factories
    const types = getRegisteredTransportTypes();
    // Factory cleanup not needed since each test registers fresh
  });

  it('should create transport from registered factory', () => {
    registerTransportFactory('websocket', createMockTransport);

    const transport = createTransport('websocket', {
      agentId: 'test-agent',
      endpoint: 'ws://localhost:8080',
    });

    expect(transport).toBeDefined();
    expect(transport.name).toBe('mock');
    expect(transport.agentId).toBe('test-agent');
    transport.destroy();
  });

  it('should throw for unregistered transport type', () => {
    expect(() =>
      createTransport('grpc', {
        agentId: 'test-agent',
        endpoint: 'http://localhost:8080',
      })
    ).toThrow('Transport factory not registered');
  });

  it('should throw for invalid transport type', () => {
    expect(() =>
      createTransport('invalid' as 'websocket', {
        agentId: 'test-agent',
        endpoint: 'http://localhost:8080',
      })
    ).toThrow('Invalid transport type');
  });

  it('should report registered transport types', () => {
    // Clear any existing registrations first by checking current state
    const beforeTypes = getRegisteredTransportTypes();
    
    // Register fresh for this test
    if (!hasTransportFactory('http')) {
      registerTransportFactory('http', createMockTransport);
    }

    expect(hasTransportFactory('http')).toBe(true);
    // websocket should not be registered unless explicitly registered
    const websocketRegistered = hasTransportFactory('websocket');

    const types = getRegisteredTransportTypes();
    expect(types).toContain('http');
    expect(types.length).toBeGreaterThanOrEqual(1);
  });

  it('should allow multiple factory registrations', () => {
    registerTransportFactory('websocket', createMockTransport);
    registerTransportFactory('http', createMockTransport);

    expect(getRegisteredTransportTypes()).toHaveLength(2);
  });
});

// ============================================================
// Transport Error Classes
// ============================================================

describe('TransportError', () => {
  it('should create base error with code', () => {
    const error = new TransportError('test error', 'TEST_CODE');
    expect(error.message).toBe('test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe('TransportError');
  });

  it('should create recoverable error', () => {
    const error = new TransportError('test', 'CODE', true);
    expect(error.recoverable).toBe(true);
  });
});

describe('TransportConnectionError', () => {
  it('should create connection error', () => {
    const error = new TransportConnectionError('connection failed');
    expect(error.message).toBe('connection failed');
    expect(error.code).toBe('CONNECTION_ERROR');
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe('TransportConnectionError');
  });

  it('should store cause error', () => {
    const cause = new Error('network error');
    const error = new TransportConnectionError('connection failed', cause);
    expect(error.cause).toBe(cause);
  });
});

describe('TransportSendError', () => {
  it('should create send error', () => {
    const error = new TransportSendError('send failed');
    expect(error.message).toBe('send failed');
    expect(error.code).toBe('SEND_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe('TransportSendError');
  });

  it('should store message data', () => {
    const error = new TransportSendError('buffer full', {
      id: 'msg-1',
      type: 'request',
    });
    expect(error.messageData).toBeDefined();
    expect(error.messageData?.id).toBe('msg-1');
  });
});

describe('TransportParseError', () => {
  it('should create parse error', () => {
    const error = new TransportParseError('invalid format');
    expect(error.message).toBe('invalid format');
    expect(error.code).toBe('PARSE_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe('TransportParseError');
  });

  it('should store raw data', () => {
    const error = new TransportParseError('invalid format', 'raw-data');
    expect(error.rawData).toBe('raw-data');
  });
});
