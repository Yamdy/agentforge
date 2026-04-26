/**
 * SQLite-backed CheckpointStorage implementation
 *
 * Persists checkpoints to a SQLite database using better-sqlite3.
 * Supports `:memory:` for testing.
 *
 * @module
 */

import Database from 'better-sqlite3';
import { type Checkpoint, CheckpointSchema } from '../core/checkpoint.js';
import type { CheckpointStorage } from '../contracts/mpu-interfaces.js';

/**
 * SQLite implementation of CheckpointStorage
 */
export class SqliteCheckpointStorage implements CheckpointStorage {
  private readonly db: Database.Database;
  private readonly saveStmt: Database.Statement;
  private readonly loadByIdStmt: Database.Statement;
  private readonly loadLatestStmt: Database.Statement;
  private readonly listStmt: Database.Statement;
  private readonly listLimitedStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    // WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        position TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (id, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session
        ON checkpoints (session_id, timestamp DESC);
    `);

    this.saveStmt = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints (id, session_id, timestamp, position, data)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.loadByIdStmt = this.db.prepare(`
      SELECT data FROM checkpoints
      WHERE session_id = ? AND id = ?
    `);

    this.loadLatestStmt = this.db.prepare(`
      SELECT data FROM checkpoints
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    this.listStmt = this.db.prepare(`
      SELECT data FROM checkpoints
      WHERE session_id = ?
      ORDER BY timestamp DESC
    `);

    this.listLimitedStmt = this.db.prepare(`
      SELECT data FROM checkpoints
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM checkpoints
      WHERE session_id = ? AND id = ?
    `);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async save(checkpoint: Checkpoint): Promise<void> {
    this.saveStmt.run(
      checkpoint.id,
      checkpoint.sessionId,
      checkpoint.timestamp,
      checkpoint.position,
      JSON.stringify(checkpoint)
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async load(sessionId: string, checkpointId?: string): Promise<Checkpoint | null> {
    const row = checkpointId
      ? (this.loadByIdStmt.get(sessionId, checkpointId) as { data: string } | undefined)
      : (this.loadLatestStmt.get(sessionId) as { data: string } | undefined);

    if (!row) return null;

    const parsed: unknown = JSON.parse(row.data);
    return CheckpointSchema.parse(parsed);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async list(sessionId: string, limit?: number): Promise<Checkpoint[]> {
    const rows: Array<{ data: string }> =
      limit !== undefined
        ? (this.listLimitedStmt.all(sessionId, limit) as Array<{ data: string }>)
        : (this.listStmt.all(sessionId) as Array<{ data: string }>);

    return rows
      .map(row => {
        const parsed: unknown = JSON.parse(row.data);
        return CheckpointSchema.safeParse(parsed);
      })
      .filter((result): result is { success: true; data: Checkpoint } => result.success)
      .map(result => result.data);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(sessionId: string, checkpointId: string): Promise<void> {
    this.deleteStmt.run(sessionId, checkpointId);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
