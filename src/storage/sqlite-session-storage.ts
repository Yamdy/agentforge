/**
 * SQLite-backed SessionStorage implementation
 *
 * Persists agent session state to a SQLite database using better-sqlite3.
 * Supports `:memory:` for testing.
 *
 * @module
 */

import Database from 'better-sqlite3';
import { type AgentState, AgentStateSchema } from '../core/state.js';
import type { SessionStorage } from '../contracts/mpu-interfaces.js';

/**
 * SQLite implementation of SessionStorage
 */
export class SqliteSessionStorage implements SessionStorage {
  private readonly db: Database.Database;
  private readonly saveStmt: Database.Statement;
  private readonly loadStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;
  private readonly listStmt: Database.Statement;
  private readonly listLimitedStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    // WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.saveStmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (session_id, data, updated_at)
      VALUES (?, ?, ?)
    `);

    this.loadStmt = this.db.prepare(`
      SELECT data FROM sessions
      WHERE session_id = ?
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM sessions
      WHERE session_id = ?
    `);

    this.listStmt = this.db.prepare(`
      SELECT session_id FROM sessions
      ORDER BY updated_at DESC
    `);

    this.listLimitedStmt = this.db.prepare(`
      SELECT session_id FROM sessions
      ORDER BY updated_at DESC
      LIMIT ?
    `);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async save(sessionId: string, state: AgentState): Promise<void> {
    this.saveStmt.run(sessionId, JSON.stringify(state), Date.now());
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async load(sessionId: string): Promise<AgentState | null> {
    const row = this.loadStmt.get(sessionId) as { data: string } | undefined;

    if (!row) return null;

    const parsed: unknown = JSON.parse(row.data);
    return AgentStateSchema.parse(parsed);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(sessionId: string): Promise<void> {
    this.deleteStmt.run(sessionId);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async list(limit?: number): Promise<string[]> {
    const rows: Array<{ session_id: string }> =
      limit !== undefined
        ? (this.listLimitedStmt.all(limit) as Array<{ session_id: string }>)
        : (this.listStmt.all() as Array<{ session_id: string }>);

    return rows.map(row => row.session_id);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
