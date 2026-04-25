/**
 * Unit tests for src/a2a/message.ts
 *
 * Tests message creation, parsing, and validation utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  // Message creation
  createMessage,
  createRequest,
  createResponse,
  createNotification,
  createBroadcast,
  createError,
  createAck,
  createHeartbeat,
  // Parsing
  parseMessage,
  parseMessageJson,
  // Validation
  validateMessage,
  validateErrorPayload,
  validateAckPayload,
  isMessageExpired,
  // Utilities
  createCorrelationId,
  serializeMessage,
  // Types
  A2AMessageSchema,
  A2AErrorMessageSchema,
  A2AAckMessageSchema,
  isA2AMessage,
  isA2AErrorMessage,
  isA2AAckMessage,
  isA2ARequest,
  isA2AResponse,
  isA2ABroadcast,
  isA2ANotification,
  A2A_BROADCAST_TARGET,
} from '../../src/a2a/index.js';
import type { A2AMessage, A2AErrorPayload, A2AAckPayload } from '../../src/a2a/index.js';

// ============================================================
// Message Schema Tests
// ============================================================

describe('A2AMessageSchema', () => {
  it('should validate a valid message', () => {
    const message = {
      id: 'test-id',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      ttl: 300000,
      version: '1.0.0',
      type: 'request',
      payload: { action: 'test' },
    };

    const result = A2AMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should reject message missing required fields', () => {
    const message = {
      from: 'agent-a',
      to: 'agent-b',
      // missing id, timestamp, type, payload
    };

    const result = A2AMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('should reject invalid message type', () => {
    const message = {
      id: 'test-id',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      type: 'invalid-type',
      payload: {},
    };

    const result = A2AMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it('should accept all valid message types', () => {
    const types = ['request', 'response', 'notification', 'error', 'heartbeat', 'ack'];

    for (const type of types) {
      const message = {
        id: `test-${type}`,
        from: 'agent-a',
        to: 'agent-b',
        timestamp: Date.now(),
        type,
        payload: {},
      };

      const result = A2AMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    }
  });

  it('should apply default values', () => {
    const message = {
      id: 'test-id',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      type: 'request',
      payload: {},
    };

    const result = A2AMessageSchema.parse(message);
    expect(result.ttl).toBe(0);
    expect(result.version).toBe('1.0.0');
  });
});

// ============================================================
// Specialized Message Schema Tests
// ============================================================

describe('A2AErrorMessageSchema', () => {
  it('should validate error message', () => {
    const message = {
      id: 'error-id',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      correlationId: 'request-id',
      type: 'error',
      payload: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
      },
    };

    const result = A2AErrorMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should accept optional details', () => {
    const message = {
      id: 'error-id',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      correlationId: 'request-id',
      type: 'error',
      payload: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { field: 'email', reason: 'invalid format' },
      },
    };

    const result = A2AErrorMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});

describe('A2AAckMessageSchema', () => {
  it('should validate ack message', () => {
    const message = {
      id: 'ack-id',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      correlationId: 'message-id',
      type: 'ack',
      payload: {
        originalMessageId: 'message-id',
        status: 'received',
      },
    };

    const result = A2AAckMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it('should accept all valid statuses', () => {
    const statuses: Array<'received' | 'processing' | 'completed' | 'failed'> = [
      'received',
      'processing',
      'completed',
      'failed',
    ];

    for (const status of statuses) {
      const message = {
        id: 'ack-id',
        from: 'agent-a',
        to: 'agent-b',
        timestamp: Date.now(),
        correlationId: 'message-id',
        type: 'ack',
        payload: {
          originalMessageId: 'message-id',
          status,
        },
      };

      const result = A2AAckMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    }
  });
});

// ============================================================
// Message Creation Tests
// ============================================================

describe('createMessage', () => {
  it('should create a valid message', () => {
    const msg = createMessage('agent-a', 'agent-b', 'request', { test: true });

    expect(msg.id).toBeDefined();
    expect(msg.from).toBe('agent-a');
    expect(msg.to).toBe('agent-b');
    expect(msg.type).toBe('request');
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.payload).toEqual({ test: true });
  });

  it('should apply options correctly', () => {
    const msg = createMessage('agent-a', 'agent-b', 'request', {}, {
      ttl: 60000,
      correlationId: 'corr-123',
      sequence: 1,
      version: '2.0.0',
      metadata: { priority: 'high' },
    });

    expect(msg.ttl).toBe(60000);
    expect(msg.correlationId).toBe('corr-123');
    expect(msg.sequence).toBe(1);
    expect(msg.version).toBe('2.0.0');
    expect(msg.metadata).toEqual({ priority: 'high' });
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const msg = createMessage('agent-a', 'agent-b', 'request', {});
      ids.add(msg.id);
    }
    expect(ids.size).toBe(100);
  });
});

describe('createRequest', () => {
  it('should create request message without correlationId', () => {
    const msg = createRequest('agent-a', 'agent-b', { action: 'test' });

    expect(msg.type).toBe('request');
    expect(msg.correlationId).toBeUndefined();
    expect(msg.payload).toEqual({ action: 'test' });
  });
});

describe('createResponse', () => {
  it('should create response with correlationId', () => {
    const msg = createResponse('agent-b', 'agent-a', { result: 'ok' }, 'request-123');

    expect(msg.type).toBe('response');
    expect(msg.correlationId).toBe('request-123');
    expect(msg.payload).toEqual({ result: 'ok' });
  });
});

describe('createNotification', () => {
  it('should create notification message', () => {
    const msg = createNotification('agent-a', 'agent-b', { event: 'update' });

    expect(msg.type).toBe('notification');
    expect(msg.payload).toEqual({ event: 'update' });
  });
});

describe('createBroadcast', () => {
  it('should create broadcast message with wildcard target', () => {
    const msg = createBroadcast('agent-a', { announcement: 'hello' });

    expect(msg.to).toBe(A2A_BROADCAST_TARGET);
    expect(msg.type).toBe('notification');
    expect(msg.payload).toEqual({ announcement: 'hello' });
  });
});

describe('createError', () => {
  it('should create error message', () => {
    const errorPayload: A2AErrorPayload = {
      code: 'NOT_FOUND',
      message: 'Agent not found',
    };
    const msg = createError('agent-b', 'agent-a', 'request-123', errorPayload);

    expect(msg.type).toBe('error');
    expect(msg.correlationId).toBe('request-123');
    expect(msg.payload).toEqual(errorPayload);
  });
});

describe('createAck', () => {
  it('should create ack message', () => {
    const ackPayload: A2AAckPayload = {
      originalMessageId: 'msg-123',
      status: 'received',
    };
    const msg = createAck('agent-b', 'agent-a', 'msg-123', ackPayload);

    expect(msg.type).toBe('ack');
    expect(msg.correlationId).toBe('msg-123');
    expect(msg.payload).toEqual(ackPayload);
  });
});

describe('createHeartbeat', () => {
  it('should create heartbeat message', () => {
    const msg = createHeartbeat('agent-a', 'agent-b');

    expect(msg.type).toBe('heartbeat');
    expect(msg.payload).toHaveProperty('timestamp');
  });
});

// ============================================================
// Message Parsing Tests
// ============================================================

describe('parseMessage', () => {
  it('should parse valid message', () => {
    const raw = {
      id: 'msg-123',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      type: 'request',
      payload: { test: true },
    };

    const result = parseMessage(raw);
    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    expect(result.message?.id).toBe('msg-123');
  });

  it('should return error for invalid message', () => {
    const raw = {
      from: 'agent-a',
      // missing required fields
    };

    const result = parseMessage(raw);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.message).toBeUndefined();
  });

  it('should parse message with all optional fields', () => {
    const raw = {
      id: 'msg-123',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      ttl: 60000,
      correlationId: 'corr-123',
      sequence: 5,
      version: '1.0.0',
      type: 'response',
      payload: { result: 'ok' },
      metadata: { key: 'value' },
    };

    const result = parseMessage(raw);
    expect(result.success).toBe(true);
    expect(result.message?.correlationId).toBe('corr-123');
    expect(result.message?.sequence).toBe(5);
    expect(result.message?.metadata).toEqual({ key: 'value' });
  });
});

describe('parseMessageJson', () => {
  it('should parse JSON string', () => {
    const json = JSON.stringify({
      id: 'msg-123',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      type: 'request',
      payload: {},
    });

    const result = parseMessageJson(json);
    expect(result.success).toBe(true);
  });

  it('should return error for invalid JSON', () => {
    const result = parseMessageJson('not valid json');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================
// Message Validation Tests
// ============================================================

describe('validateMessage', () => {
  it('should return true for valid message', () => {
    const msg: A2AMessage = {
      id: 'test-id',
      from: 'agent-a',
      to: 'agent-b',
      timestamp: Date.now(),
      type: 'request',
      payload: {},
    };

    expect(validateMessage(msg)).toBe(true);
  });

  it('should return false for invalid message', () => {
    expect(validateMessage(null)).toBe(false);
    expect(validateMessage(undefined)).toBe(false);
    expect(validateMessage({})).toBe(false);
    expect(validateMessage('not an object')).toBe(false);
  });
});

describe('validateErrorPayload', () => {
  it('should validate error payload', () => {
    expect(validateErrorPayload({ code: 'ERR', message: 'Error' })).toBe(true);
    expect(validateErrorPayload({ code: 'ERR', message: 'Error', details: {} })).toBe(true);
  });

  it('should reject invalid error payload', () => {
    expect(validateErrorPayload({})).toBe(false);
    expect(validateErrorPayload({ code: 123, message: 'Error' })).toBe(false);
  });
});

describe('validateAckPayload', () => {
  it('should validate ack payload', () => {
    expect(
      validateAckPayload({ originalMessageId: 'msg-1', status: 'received' })
    ).toBe(true);
    expect(
      validateAckPayload({ originalMessageId: 'msg-1', status: 'completed' })
    ).toBe(true);
  });

  it('should reject invalid ack payload', () => {
    expect(validateAckPayload({})).toBe(false);
    expect(validateAckPayload({ originalMessageId: 'msg-1', status: 'invalid' })).toBe(false);
  });
});

describe('isMessageExpired', () => {
  it('should return false for non-expired message', () => {
    const msg: A2AMessage = {
      id: 'test',
      from: 'a',
      to: 'b',
      timestamp: Date.now() - 1000,
      ttl: 10000,
      type: 'request',
      payload: {},
    };

    expect(isMessageExpired(msg)).toBe(false);
  });

  it('should return true for expired message', () => {
    const msg: A2AMessage = {
      id: 'test',
      from: 'a',
      to: 'b',
      timestamp: Date.now() - 10000,
      ttl: 5000,
      type: 'request',
      payload: {},
    };

    expect(isMessageExpired(msg)).toBe(true);
  });

  it('should return false for message with ttl=0 (never expires)', () => {
    const msg: A2AMessage = {
      id: 'test',
      from: 'a',
      to: 'b',
      timestamp: Date.now() - 1000000,
      ttl: 0,
      type: 'request',
      payload: {},
    };

    expect(isMessageExpired(msg)).toBe(false);
  });

  it('should use provided timestamp', () => {
    const msg: A2AMessage = {
      id: 'test',
      from: 'a',
      to: 'b',
      timestamp: 1000,
      ttl: 100,
      type: 'request',
      payload: {},
    };

    expect(isMessageExpired(msg, 1050)).toBe(false);
    expect(isMessageExpired(msg, 1101)).toBe(true);
  });
});

// ============================================================
// Utility Tests
// ============================================================

describe('createCorrelationId', () => {
  it('should return request message ID', () => {
    const request = createRequest('agent-a', 'agent-b', {});
    const correlationId = createCorrelationId(request);

    expect(correlationId).toBe(request.id);
  });
});

describe('serializeMessage', () => {
  it('should serialize message to JSON', () => {
    const msg = createRequest('agent-a', 'agent-b', { test: true });
    const json = serializeMessage(msg);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe(msg.id);
    expect(parsed.from).toBe(msg.from);
  });
});

// ============================================================
// Type Guard Tests
// ============================================================

describe('Type Guards', () => {
  const requestMsg = createRequest('agent-a', 'agent-b', {});
  const responseMsg = createResponse('agent-b', 'agent-a', {}, 'req-123');
  const notificationMsg = createNotification('agent-a', 'agent-b', {});
  const broadcastMsg = createBroadcast('agent-a', {});
  const errorMsg = createError('agent-b', 'agent-a', 'req-123', {
    code: 'ERR',
    message: 'Error',
  });
  const ackMsg = createAck('agent-b', 'agent-a', 'req-123', {
    originalMessageId: 'req-123',
    status: 'received',
  });

  describe('isA2AMessage', () => {
    it('should return true for valid messages', () => {
      expect(isA2AMessage(requestMsg)).toBe(true);
      expect(isA2AMessage(responseMsg)).toBe(true);
      expect(isA2AMessage({})).toBe(false);
    });
  });

  describe('isA2AErrorMessage', () => {
    it('should return true only for error messages', () => {
      expect(isA2AErrorMessage(errorMsg)).toBe(true);
      expect(isA2AErrorMessage(requestMsg)).toBe(false);
    });
  });

  describe('isA2AAckMessage', () => {
    it('should return true only for ack messages', () => {
      expect(isA2AAckMessage(ackMsg)).toBe(true);
      expect(isA2AAckMessage(requestMsg)).toBe(false);
    });
  });

  describe('isA2ARequest', () => {
    it('should return true for request without correlationId', () => {
      expect(isA2ARequest(requestMsg)).toBe(true);
      expect(isA2ARequest(responseMsg)).toBe(false);
    });
  });

  describe('isA2AResponse', () => {
    it('should return true for response with correlationId', () => {
      expect(isA2AResponse(responseMsg)).toBe(true);
      expect(isA2AResponse(requestMsg)).toBe(false);
    });
  });

  describe('isA2ABroadcast', () => {
    it('should return true for broadcast messages', () => {
      expect(isA2ABroadcast(broadcastMsg)).toBe(true);
      expect(isA2ABroadcast(requestMsg)).toBe(false);
    });
  });

  describe('isA2ANotification', () => {
    it('should return true for notification messages', () => {
      expect(isA2ANotification(notificationMsg)).toBe(true);
      expect(isA2ANotification(requestMsg)).toBe(false);
    });
  });
});
