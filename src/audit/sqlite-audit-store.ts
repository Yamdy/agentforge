/**
 * SQLite-backed Audit Store Implementation
 *
 * Append-only audit log with SHA-256 hash chain integrity.
 * Uses better-sqlite3 for persistence.
 *
 * Design principles:
 * - Append-only: No update or delete operations
 * - Hash chain: Each entry links to previous via SHA-256
 * - Query support: Filter by eventType, sessionId, result, time range
 * - Export: JSON and CSV formats
 *
 * @module
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AuditStore,
  AuditEntry,
  AuditFilter,
  IntegrityReport,
} from '../contracts/mpu-interfaces.js';
import { computeEntryHash, verifyChain } from './hash-chain.js';

/**
 * SQLite implementation of AuditStore.
 *
 * Supports `:memory:` for testing.
 */
export class SqliteAuditStore implements AuditStore {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly countStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    // WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_entries (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        result TEXT NOT NULL,
        details TEXT NOT NULL,
        previous_hash TEXT,
        hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_session
        ON audit_entries (session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type
        ON audit_entries (event_type, timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_result
        ON audit_entries (result, timestamp);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO audit_entries (id, timestamp, session_id, agent_name, event_type, action, resource, result, details, previous_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.countStmt = this.db.prepare('SELECT COUNT(*) as cnt FROM audit_entries');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async append(entry: Omit<AuditEntry, 'id' | 'hash' | 'previousHash'>): Promise<void> {
    // Get the last entry's hash for chaining
    const lastRow = this.db
      .prepare('SELECT hash FROM audit_entries ORDER BY rowid DESC LIMIT 1')
      .get() as { hash: string } | undefined;

    const previousHash = lastRow?.hash;
    const id = randomUUID();

    const hash = computeEntryHash(
      {
        timestamp: entry.timestamp,
        sessionId: entry.sessionId,
        agentName: entry.agentName,
        eventType: entry.eventType,
        action: entry.action,
        resource: entry.resource,
        result: entry.result,
        details: entry.details,
      },
      previousHash ?? ''
    );

    this.insertStmt.run(
      id,
      entry.timestamp,
      entry.sessionId,
      entry.agentName,
      entry.eventType,
      entry.action,
      entry.resource,
      entry.result,
      JSON.stringify(entry.details),
      previousHash ?? null,
      hash
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.eventType !== undefined) {
      conditions.push('event_type = ?');
      params.push(filter.eventType);
    }
    if (filter.sessionId !== undefined) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter.result !== undefined) {
      conditions.push('result = ?');
      params.push(filter.result);
    }
    if (filter.since !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit !== undefined ? `LIMIT ${filter.limit}` : '';

    const sql = `SELECT * FROM audit_entries ${where} ORDER BY rowid ASC ${limit}`;
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      timestamp: string;
      session_id: string;
      agent_name: string;
      event_type: string;
      action: string;
      resource: string;
      result: string;
      details: string;
      previous_hash: string | null;
      hash: string;
    }>;

    return rows.map(row => {
      const entry: AuditEntry = {
        id: row.id,
        timestamp: row.timestamp,
        sessionId: row.session_id,
        agentName: row.agent_name,
        eventType: row.event_type as AuditEntry['eventType'],
        action: row.action,
        resource: row.resource,
        result: row.result as AuditEntry['result'],
        details: JSON.parse(row.details) as Record<string, unknown>,
        hash: row.hash,
      };

      if (row.previous_hash !== null) {
        entry.previousHash = row.previous_hash;
      }

      return entry;
    });
  }

  async verifyIntegrity(): Promise<IntegrityReport> {
    const entries = await this.query({});
    const totalEntries = entries.length;

    if (totalEntries === 0) {
      return { valid: true, totalEntries: 0 };
    }

    const result = verifyChain(entries);

    const brokenAt = result.brokenAt !== undefined ? result.brokenAt + 1 : undefined;

    const report: IntegrityReport = {
      valid: result.valid,
      totalEntries,
    };

    if (brokenAt !== undefined) {
      report.brokenAt = brokenAt;
    }

    return report;
  }

  async export(format: 'json' | 'csv'): Promise<string> {
    const entries = await this.query({});

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    // CSV format
    const headers = [
      'id',
      'timestamp',
      'sessionId',
      'agentName',
      'eventType',
      'action',
      'resource',
      'result',
      'details',
      'previousHash',
      'hash',
    ];

    const csvLines = [headers.join(',')];

    for (const entry of entries) {
      const row = [
        entry.id,
        entry.timestamp,
        entry.sessionId,
        entry.agentName,
        entry.eventType,
        entry.action,
        entry.resource,
        entry.result,
        JSON.stringify(entry.details),
        entry.previousHash ?? '',
        entry.hash,
      ].map(field => `"${String(field).replace(/"/g, '""')}"`);

      csvLines.push(row.join(','));
    }

    return csvLines.join('\n');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async count(): Promise<number> {
    const row = this.countStmt.get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Tamper with an entry's hash for integrity testing.
   * This method exists solely for testing broken hash chains.
   *
   * @internal
   */
  tamperWithEntry(index: number, fakeHash: string): void {
    const rows = this.db.prepare('SELECT id FROM audit_entries ORDER BY rowid ASC').all() as Array<{
      id: string;
    }>;

    const target = rows[index];
    if (!target) {
      throw new Error(`No entry at index ${index}`);
    }

    this.db.prepare('UPDATE audit_entries SET hash = ? WHERE id = ?').run(fakeHash, target.id);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
