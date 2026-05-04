/**
 * DefaultAuditLogger Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultAuditLogger } from '../../src/security/audit/audit-logger.js';
import { InMemoryAuditStore } from '../../src/security/audit/audit-store.js';

describe('DefaultAuditLogger', () => {
  let store: InMemoryAuditStore;
  let logger: DefaultAuditLogger;

  beforeEach(() => {
    store = new InMemoryAuditStore();
    logger = new DefaultAuditLogger({
      sessionId: 'test-session',
      agentName: 'test-agent',
      store,
    });
  });

  describe('append()', () => {
    it('should add entry with timestamp and session info', () => {
      logger.append({
        eventType: 'tool.call',
        action: 'read_file',
        resource: '/tmp/test.txt',
        result: 'success',
        details: { size: 100 },
      });

      const entries = store.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].sessionId).toBe('test-session');
      expect(entries[0].agentName).toBe('test-agent');
      expect(entries[0].eventType).toBe('tool.call');
      expect(entries[0].timestamp).toBeDefined();
    });

    it('should not crash on store error', () => {
      const badStore = {
        append: () => { throw new Error('Storage error'); },
        query: () => [],
        getAll: () => [],
        clear: () => {},
        count: () => 0,
      };

      const badLogger = new DefaultAuditLogger({
        sessionId: 'test-session',
        agentName: 'test-agent',
        store: badStore,
      });

      expect(() => {
        badLogger.append({
          eventType: 'tool.call',
          action: 'read_file',
          resource: '/tmp/test.txt',
          result: 'success',
          details: {},
        });
      }).not.toThrow();
    });
  });

  describe('query()', () => {
    it('should delegate to store', () => {
      logger.append({ eventType: 'tool.call', action: 'a1', resource: 'r1', result: 'success', details: {} });
      logger.append({ eventType: 'permission.denied', action: 'a2', resource: 'r2', result: 'denied', details: {} });

      const result = logger.query({ eventType: 'tool.call' });
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('a1');
    });
  });

  describe('verifyIntegrity()', () => {
    it('should return true for valid timestamps', () => {
      logger.append({ eventType: 'tool.call', action: 'a1', resource: 'r1', result: 'success', details: {} });
      expect(logger.verifyIntegrity()).toBe(true);
    });

    it('should return false for invalid timestamps', () => {
      store.append({
        timestamp: 'invalid-date',
        sessionId: 's1',
        agentName: 'a1',
        eventType: 'tool.call',
        action: 'a1',
        resource: 'r1',
        result: 'success',
        details: {},
      });
      expect(logger.verifyIntegrity()).toBe(false);
    });

    it('should return true when integrity check disabled', () => {
      const noIntegrityLogger = new DefaultAuditLogger({
        sessionId: 'test-session',
        agentName: 'test-agent',
        store,
        enableIntegrity: false,
      });

      store.append({
        timestamp: 'invalid-date',
        sessionId: 's1',
        agentName: 'a1',
        eventType: 'tool.call',
        action: 'a1',
        resource: 'r1',
        result: 'success',
        details: {},
      });

      expect(noIntegrityLogger.verifyIntegrity()).toBe(true);
    });
  });

  describe('getStore()', () => {
    it('should return the underlying store', () => {
      expect(logger.getStore()).toBe(store);
    });
  });
});
