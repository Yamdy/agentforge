/**
 * Unit tests for SqliteAuditStore
 *
 * Tests audit log append-only storage with SHA-256 hash chain integrity.
 * Uses :memory: SQLite database for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAuditStore } from '../../src/audit/sqlite-audit-store.js';
import type { AuditEntry, AuditFilter, AuditEventType } from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// Test Helpers
// ============================================================

function createTestEntry(overrides?: Partial<{
  sessionId: string;
  agentName: string;
  eventType: AuditEventType;
  action: string;
  resource: string;
  result: 'success' | 'denied' | 'error';
  details: Record<string, unknown>;
  timestamp: string;
}>) {
  return {
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
    sessionId: overrides?.sessionId ?? 'session-1',
    agentName: overrides?.agentName ?? 'assistant',
    eventType: overrides?.eventType ?? ('tool.execute' as AuditEventType),
    action: overrides?.action ?? 'read_file',
    resource: overrides?.resource ?? '/tmp/test.txt',
    result: overrides?.result ?? ('success' as const),
    details: overrides?.details ?? { path: '/tmp/test.txt' },
  };
}

// ============================================================
// AuditStore Tests
// ============================================================

describe('SqliteAuditStore', () => {
  let store: SqliteAuditStore;

  beforeEach(() => {
    store = new SqliteAuditStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  // ----------------------------------------------------------
  // TC-001: append() should add audit entries
  // ----------------------------------------------------------

  describe('append', () => {
    it('TC-001: should add audit entries', async () => {
      await store.append(createTestEntry());
      const count = await store.count();
      expect(count).toBe(1);
    });

    // ----------------------------------------------------------
    // TC-002: append() should auto-generate ID and hash
    // ----------------------------------------------------------

    it('TC-002: should auto-generate ID and hash', async () => {
      await store.append(createTestEntry());
      const entries = await store.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBeDefined();
      expect(entries[0]!.id).not.toBe('');
      expect(entries[0]!.hash).toBeDefined();
      expect(entries[0]!.hash).not.toBe('');
      expect(entries[0]!.hash).toHaveLength(64); // SHA-256 hex
    });

    // ----------------------------------------------------------
    // TC-003: append() should build hash chain
    // ----------------------------------------------------------

    it('TC-003: should build hash chain', async () => {
      await store.append(createTestEntry({ action: 'first' }));
      await store.append(createTestEntry({ action: 'second' }));
      await store.append(createTestEntry({ action: 'third' }));

      const entries = await store.query({});
      expect(entries).toHaveLength(3);

      // First entry has no previous hash (genesis)
      expect(entries[0]!.previousHash).toBeUndefined();

      // Second entry's previousHash equals first entry's hash
      expect(entries[1]!.previousHash).toBe(entries[0]!.hash);

      // Third entry's previousHash equals second entry's hash
      expect(entries[2]!.previousHash).toBe(entries[1]!.hash);
    });
  });

  // ----------------------------------------------------------
  // TC-004: query() should filter by criteria
  // ----------------------------------------------------------

  describe('query', () => {
    it('TC-004: should filter by criteria', async () => {
      await store.append(createTestEntry({
        sessionId: 'session-a',
        eventType: 'tool.execute',
        result: 'success',
      }));
      await store.append(createTestEntry({
        sessionId: 'session-b',
        eventType: 'llm.request',
        result: 'success',
      }));
      await store.append(createTestEntry({
        sessionId: 'session-a',
        eventType: 'tool.execute',
        result: 'error',
      }));

      // Filter by sessionId
      const sessionA = await store.query({ sessionId: 'session-a' });
      expect(sessionA).toHaveLength(2);

      // Filter by eventType
      const toolEntries = await store.query({ eventType: 'tool.execute' });
      expect(toolEntries).toHaveLength(2);

      // Filter by result
      const errors = await store.query({ result: 'error' });
      expect(errors).toHaveLength(1);

      // Filter by sessionId + eventType
      const combined = await store.query({
        sessionId: 'session-a',
        eventType: 'tool.execute',
      });
      expect(combined).toHaveLength(2);

      // Filter with limit
      const limited = await store.query({ limit: 1 });
      expect(limited).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------
  // TC-005: verifyIntegrity() valid chain should return true
  // ----------------------------------------------------------

  describe('verifyIntegrity', () => {
    it('TC-005: valid chain should return valid=true', async () => {
      await store.append(createTestEntry({ action: 'first' }));
      await store.append(createTestEntry({ action: 'second' }));
      await store.append(createTestEntry({ action: 'third' }));

      const report = await store.verifyIntegrity();
      expect(report.valid).toBe(true);
      expect(report.totalEntries).toBe(3);
      expect(report.brokenAt).toBeUndefined();
    });

    // ----------------------------------------------------------
    // TC-006: verifyIntegrity() broken chain should return false
    // ----------------------------------------------------------

    it('TC-006: broken chain should return valid=false', async () => {
      await store.append(createTestEntry({ action: 'first' }));
      await store.append(createTestEntry({ action: 'second' }));
      await store.append(createTestEntry({ action: 'third' }));

      // Tamper with the second entry's hash directly in the database
      store.tamperWithEntry(1, 'tampered-hash');

      const report = await store.verifyIntegrity();
      expect(report.valid).toBe(false);
      expect(report.totalEntries).toBe(3);
      expect(report.brokenAt).toBeDefined();
    });
  });

  // ----------------------------------------------------------
  // TC-007: export() JSON format
  // ----------------------------------------------------------

  describe('export', () => {
    it('TC-007: JSON format should be correct', async () => {
      await store.append(createTestEntry({ action: 'read' }));
      await store.append(createTestEntry({ action: 'write' }));

      const json = await store.export('json');
      const parsed: unknown = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      const arr = parsed as AuditEntry[];
      expect(arr).toHaveLength(2);
      expect(arr[0]!.action).toBe('read');
      expect(arr[1]!.action).toBe('write');
    });

    // ----------------------------------------------------------
    // TC-008: export() CSV format
    // ----------------------------------------------------------

    it('TC-008: CSV format should be correct', async () => {
      await store.append(createTestEntry({
        action: 'read',
        resource: '/file.txt',
      }));

      const csv = await store.export('csv');
      const lines = csv.split('\n').filter(l => l.trim());
      expect(lines.length).toBeGreaterThanOrEqual(2); // header + 1 data row

      // Header should contain key fields
      const header = lines[0]!;
      expect(header).toContain('id');
      expect(header).toContain('timestamp');
      expect(header).toContain('action');
      expect(header).toContain('result');
    });
  });

  // ----------------------------------------------------------
  // TC-009: count() should return correct count
  // ----------------------------------------------------------

  describe('count', () => {
    it('TC-009: should return correct count', async () => {
      expect(await store.count()).toBe(0);

      await store.append(createTestEntry());
      expect(await store.count()).toBe(1);

      await store.append(createTestEntry());
      expect(await store.count()).toBe(2);

      await store.append(createTestEntry());
      expect(await store.count()).toBe(3);
    });
  });
});
