/**
 * InMemoryAuditStore Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditStore } from '../../src/security/audit/audit-store.js';
import type { AuditEntry } from '../../src/security/audit/audit-logger.js';

describe('InMemoryAuditStore', () => {
  let store: InMemoryAuditStore;

  const makeEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
    timestamp: '2026-04-26T10:00:00Z',
    sessionId: 'session-1',
    agentName: 'test-agent',
    eventType: 'tool.execute',
    action: 'read_file',
    resource: '/tmp/test.txt',
    result: 'success',
    details: {},
    ...overrides,
  });

  beforeEach(() => {
    store = new InMemoryAuditStore();
  });

  describe('append() + getAll()', () => {
    it('should store and retrieve entries', () => {
      store.append(makeEntry());
      store.append(makeEntry({ action: 'write_file' }));

      const all = store.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].action).toBe('read_file');
      expect(all[1].action).toBe('write_file');
    });

    it('should return copy of entries', () => {
      store.append(makeEntry());
      const all = store.getAll();
      all.push(makeEntry()); // modify the copy
      expect(store.getAll()).toHaveLength(1); // original unchanged
    });
  });

  describe('count()', () => {
    it('should return 0 for empty store', () => {
      expect(store.count()).toBe(0);
    });

    it('should return correct count', () => {
      store.append(makeEntry());
      store.append(makeEntry());
      expect(store.count()).toBe(2);
    });
  });

  describe('clear()', () => {
    it('should remove all entries', () => {
      store.append(makeEntry());
      store.append(makeEntry());
      store.clear();
      expect(store.count()).toBe(0);
    });
  });

  describe('query()', () => {
    it('should filter by eventType', () => {
      store.append(makeEntry({ eventType: 'tool.execute' }));
      store.append(makeEntry({ eventType: 'permission.denied' }));
      store.append(makeEntry({ eventType: 'tool.execute' }));

      const result = store.query({ eventType: 'tool.execute' });
      expect(result).toHaveLength(2);
    });

    it('should filter by sessionId', () => {
      store.append(makeEntry({ sessionId: 's1' }));
      store.append(makeEntry({ sessionId: 's2' }));
      store.append(makeEntry({ sessionId: 's1' }));

      const result = store.query({ sessionId: 's1' });
      expect(result).toHaveLength(2);
    });

    it('should filter by result', () => {
      store.append(makeEntry({ result: 'success' }));
      store.append(makeEntry({ result: 'denied' }));
      store.append(makeEntry({ result: 'error' }));

      const result = store.query({ result: 'denied' });
      expect(result).toHaveLength(1);
    });

    it('should filter by since', () => {
      store.append(makeEntry({ timestamp: '2026-04-26T10:00:00Z' }));
      store.append(makeEntry({ timestamp: '2026-04-26T12:00:00Z' }));
      store.append(makeEntry({ timestamp: '2026-04-26T14:00:00Z' }));

      const result = store.query({ since: '2026-04-26T11:00:00Z' });
      expect(result).toHaveLength(2);
    });

    it('should filter by until', () => {
      store.append(makeEntry({ timestamp: '2026-04-26T10:00:00Z' }));
      store.append(makeEntry({ timestamp: '2026-04-26T12:00:00Z' }));
      store.append(makeEntry({ timestamp: '2026-04-26T14:00:00Z' }));

      const result = store.query({ until: '2026-04-26T11:00:00Z' });
      expect(result).toHaveLength(1);
    });

    it('should combine multiple filters', () => {
      store.append(makeEntry({ eventType: 'tool.execute', result: 'success' }));
      store.append(makeEntry({ eventType: 'tool.execute', result: 'denied' }));
      store.append(makeEntry({ eventType: 'permission.denied', result: 'denied' }));

      const result = store.query({ eventType: 'tool.execute', result: 'denied' });
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no matches', () => {
      store.append(makeEntry());
      const result = store.query({ eventType: 'injection.detected' });
      expect(result).toHaveLength(0);
    });
  });
});
