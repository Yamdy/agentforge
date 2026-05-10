import Database from 'better-sqlite3';
import type { MemoryBackend, MemoryEntry } from './backend.js';

export class SQLiteBackend implements MemoryBackend {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries(session_id, timestamp)
    `);
  }

  async store(sessionId: string, entry: MemoryEntry): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT INTO memory_entries (session_id, role, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(
      sessionId,
      entry.role,
      entry.content,
      entry.timestamp,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    );
  }

  async retrieve(sessionId: string, query?: { limit?: number; since?: string }): Promise<MemoryEntry[]> {
    let sql = 'SELECT * FROM memory_entries WHERE session_id = ?';
    const params: unknown[] = [sessionId];

    if (query?.since) {
      sql += ' AND timestamp > ?';
      params.push(query.since);
    }
    sql += ' ORDER BY timestamp ASC';

    if (query?.limit) {
      // Get the last N entries
      const countSql = 'SELECT COUNT(*) as total FROM memory_entries WHERE session_id = ?';
      const countRow = this.db.prepare(countSql).get(sessionId) as { total: number };
      const offset = Math.max(0, countRow.total - query.limit);
      sql += ` LIMIT ? OFFSET ?`;
      params.push(query.limit, offset);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      role: string;
      content: string;
      timestamp: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      role: row.role as MemoryEntry['role'],
      content: row.content,
      timestamp: row.timestamp,
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
    }));
  }

  async search(query: string, options?: { limit?: number }): Promise<MemoryEntry[]> {
    let sql = 'SELECT * FROM memory_entries WHERE content LIKE ? ORDER BY timestamp ASC';
    const params: unknown[] = [`%${query}%`];

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      session_id: string;
      role: string;
      content: string;
      timestamp: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      role: row.role as MemoryEntry['role'],
      content: row.content,
      timestamp: row.timestamp,
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
    }));
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}
