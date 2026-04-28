/**
 * SQLite Checkpoint Storage (M1)
 *
 * Persists agent state to SQLite for pause/resume capability.
 */

import type { CheckpointStorage, Checkpoint } from 'agentforge';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { cwd } from 'node:process';

export class SQLiteCheckpointStorage implements CheckpointStorage {
  private db: Database.Database;

  constructor(dbPath: string = join(cwd(), 'agentforge.db')) {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        step INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_id ON checkpoints(agent_id);
      CREATE INDEX IF NOT EXISTS idx_created_at ON checkpoints(created_at);
    `);
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO checkpoints (id, agent_id, created_at, step, data) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(checkpoint.id, checkpoint.agentId, checkpoint.createdAt, checkpoint.step, JSON.stringify(checkpoint));
  }

  async load(id: string): Promise<Checkpoint | null> {
    const stmt = this.db.prepare('SELECT data FROM checkpoints WHERE id = ?');
    const row = stmt.get(id) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as Checkpoint;
  }

  async list(agentId?: string): Promise<Checkpoint[]> {
    const stmt = agentId
      ? this.db.prepare('SELECT data FROM checkpoints WHERE agent_id = ? ORDER BY created_at DESC')
      : this.db.prepare('SELECT data FROM checkpoints ORDER BY created_at DESC');
    const rows = agentId ? stmt.all(agentId) : stmt.all();
    return (rows as { data: string }[]).map((row) => JSON.parse(row.data) as Checkpoint);
  }

  async delete(id: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM checkpoints WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export const checkpointStorage = new SQLiteCheckpointStorage();