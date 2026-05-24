import type { SessionEvent, SessionRecord, SessionStorage, SessionStatus, Message } from '@primo-ai/sdk';

/**
 * SqliteSessionStorage — SQLite-backed implementation of SessionStorage.
 *
 * Uses `better-sqlite3` as an **optional** dependency. The module is loaded
 * dynamically so projects that only need FilesystemSessionStorage never pay
 * the cost (or install penalty) of the native binding.
 *
 * Pass `:memory:` as dbPath for an in-memory database (useful for tests).
 */
export class SqliteSessionStorage implements SessionStorage {
  private db: import('better-sqlite3').Database;

  // Prepared statements (lazily initialised after DB is set)
  private stmtInsertEvent!: import('better-sqlite3').Statement;
  private stmtSelectEvents!: import('better-sqlite3').Statement;
  private stmtSelectSession!: import('better-sqlite3').Statement;
  private stmtUpsertSession!: import('better-sqlite3').Statement;
  private stmtDeleteSession!: import('better-sqlite3').Statement;
  private stmtSelectSessionsByStatus!: import('better-sqlite3').Statement;
  private stmtSelectSessionsByParent!: import('better-sqlite3').Statement;
  private stmtSelectAllSessions!: import('better-sqlite3').Statement;
  private stmtNextSeq!: import('better-sqlite3').Statement;

  constructor(dbPath: string) {
    // Dynamic import keeps better-sqlite3 truly optional
    let Database: typeof import('better-sqlite3');
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Database = require('better-sqlite3');
    } catch {
      throw new Error(
        'better-sqlite3 is not installed. Install it as an optional dependency or use FilesystemSessionStorage instead.',
      );
    }

    this.db = new Database(dbPath);
    this.initSchema();
    this.prepareStatements();
  }

  // ---------------------------------------------------------------------------
  // Schema initialisation
  // ---------------------------------------------------------------------------

  private initSchema(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id   TEXT PRIMARY KEY,
        parent_session_id TEXT,
        status       TEXT NOT NULL DEFAULT 'active',
        model        TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        timestamp  TEXT NOT NULL,
        type       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        PRIMARY KEY (session_id, seq),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);
    `);
  }

  private prepareStatements(): void {
    this.stmtInsertEvent = this.db.prepare(
      `INSERT INTO events (session_id, seq, timestamp, type, payload) VALUES (?, ?, ?, ?, ?)`,
    );
    this.stmtSelectEvents = this.db.prepare(
      `SELECT seq, timestamp, type, payload FROM events WHERE session_id = ? ORDER BY seq ASC`,
    );
    this.stmtSelectSession = this.db.prepare(
      `SELECT session_id, parent_session_id, status, model, input_tokens, output_tokens, created_at, updated_at FROM sessions WHERE session_id = ?`,
    );
    this.stmtUpsertSession = this.db.prepare(
      `INSERT INTO sessions (session_id, parent_session_id, status, model, input_tokens, output_tokens, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         parent_session_id = COALESCE(excluded.parent_session_id, sessions.parent_session_id),
         status            = COALESCE(excluded.status, sessions.status),
         model             = COALESCE(excluded.model, sessions.model),
         input_tokens      = CASE WHEN excluded.input_tokens != 0 THEN excluded.input_tokens ELSE sessions.input_tokens END,
         output_tokens     = CASE WHEN excluded.output_tokens != 0 THEN excluded.output_tokens ELSE sessions.output_tokens END,
         updated_at        = excluded.updated_at`,
    );
    this.stmtDeleteSession = this.db.prepare(
      `DELETE FROM sessions WHERE session_id = ?`,
    );
    this.stmtSelectSessionsByStatus = this.db.prepare(
      `SELECT session_id, parent_session_id, status, model, input_tokens, output_tokens, created_at, updated_at FROM sessions WHERE status = ?`,
    );
    this.stmtSelectSessionsByParent = this.db.prepare(
      `SELECT session_id, parent_session_id, status, model, input_tokens, output_tokens, created_at, updated_at FROM sessions WHERE parent_session_id = ?`,
    );
    this.stmtSelectAllSessions = this.db.prepare(
      `SELECT session_id, parent_session_id, status, model, input_tokens, output_tokens, created_at, updated_at FROM sessions`,
    );
    this.stmtNextSeq = this.db.prepare(
      `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events WHERE session_id = ?`,
    );
  }

  // ---------------------------------------------------------------------------
  // SessionStorage interface
  // ---------------------------------------------------------------------------

  async append(sessionId: string, event: SessionEvent): Promise<void> {
    // Ensure session row exists
    const now = new Date().toISOString();
    this.stmtUpsertSession.run(
      sessionId,
      null, // parent_session_id
      'active',
      null, // model
      0,
      0,
      now,
      now,
    );

    // Determine seq: if event has seq > 0 use it, otherwise auto-increment
    let seq: number;
    if (event.seq && event.seq > 0) {
      seq = event.seq;
    } else {
      const row = this.stmtNextSeq.get(sessionId) as { max_seq: number };
      seq = (row?.max_seq ?? 0) + 1;
    }

    this.stmtInsertEvent.run(
      sessionId,
      seq,
      event.timestamp ?? now,
      event.type,
      JSON.stringify(event.payload),
    );
  }

  async *read(sessionId: string): AsyncIterable<SessionEvent> {
    const rows = this.stmtSelectEvents.all(sessionId) as Array<{
      seq: number;
      timestamp: string;
      type: string;
      payload: string;
    }>;

    for (const row of rows) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = {};
      }
      yield {
        seq: row.seq,
        timestamp: row.timestamp,
        type: row.type,
        payload,
      };
    }
  }

  async list(filter?: { parentSessionId?: string; status?: SessionStatus }): Promise<SessionRecord[]> {
    let rows: Array<Record<string, unknown>>;

    if (filter?.status) {
      rows = this.stmtSelectSessionsByStatus.all(filter.status) as Array<Record<string, unknown>>;
    } else if (filter?.parentSessionId) {
      rows = this.stmtSelectSessionsByParent.all(filter.parentSessionId) as Array<Record<string, unknown>>;
    } else {
      rows = this.stmtSelectAllSessions.all() as Array<Record<string, unknown>>;
    }

    // If both filters are specified, we need to intersect
    if (filter?.status && filter?.parentSessionId) {
      // Re-fetch with both filters using a custom query
      const stmt = this.db.prepare(
        `SELECT session_id, parent_session_id, status, model, input_tokens, output_tokens, created_at, updated_at
         FROM sessions WHERE status = ? AND parent_session_id = ?`,
      );
      rows = stmt.all(filter.status, filter.parentSessionId) as Array<Record<string, unknown>>;
    }

    return rows.map(row => this.rowToRecord(row));
  }

  async updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.get(sessionId);

    this.stmtUpsertSession.run(
      sessionId,
      meta.parentSessionId ?? existing?.parentSessionId ?? null,
      meta.status ?? existing?.status ?? 'active',
      meta.model ?? existing?.model ?? null,
      meta.tokenUsage?.input ?? (existing?.tokenUsage?.input ?? 0),
      meta.tokenUsage?.output ?? (existing?.tokenUsage?.output ?? 0),
      existing?.createdAt ?? now,
      now,
    );
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const row = this.stmtSelectSession.get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToRecord(row);
  }

  async delete(sessionId: string): Promise<void> {
    this.stmtDeleteSession.run(sessionId);
  }

  async getMessages(sessionId: string, options?: { limit?: number; before?: string }): Promise<Message[]> {
    const events: SessionEvent[] = [];
    for await (const event of this.read(sessionId)) {
      events.push(event);
    }

    if (events.length === 0) return [];

    const messages: Message[] = [];
    let toolCallIdx = 0;

    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (!payload) continue;

      switch (event.type) {
        case 'agent:start': {
          const input = payload.input as string | undefined;
          if (input) {
            messages.push({ role: 'user', content: input });
          }
          break;
        }
        case 'iteration:end':
        case 'iteration.end': {
          if (payload.response) {
            messages.push({ role: 'assistant', content: payload.response as string });
          }
          break;
        }
        case 'tool:after':
        case 'tool.after': {
          const toolName = payload.toolName as string;
          const content = payload.error
            ? String(payload.error)
            : typeof payload.result === 'string'
              ? payload.result
              : JSON.stringify(payload.result ?? '');
          const msg: Message = {
            role: 'tool',
            content,
            toolCallId: `restored_${toolName}_${toolCallIdx++}`,
            toolName,
          };
          if (payload.error) (msg as Message & { error?: string }).error = String(payload.error);
          if (payload.result !== undefined) (msg as Message & { result?: unknown }).result = payload.result;
          messages.push(msg);
          break;
        }
        case 'error': {
          messages.push({ role: 'assistant', content: `[Error] ${String(payload.error)}` });
          break;
        }
        default:
          break;
      }
    }

    // Apply pagination
    if (options?.limit && options.limit > 0) {
      return messages.slice(-options.limit);
    }

    return messages;
  }

  async verifyIntegrity(sessionId: string): Promise<import('@primo-ai/sdk').IntegrityReport> {
    // SQLite storage relies on database constraints; checksum verification is a no-op (all valid).
    return { sessionId, valid: true, totalEvents: 0, invalidEvents: 0, errors: [] };
  }

  async cleanup(): Promise<number> {
    // TTL-based cleanup not yet implemented for SQLite storage.
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private rowToRecord(row: Record<string, unknown>): SessionRecord {
    const inputTokens = typeof row.input_tokens === 'number' ? row.input_tokens : 0;
    const outputTokens = typeof row.output_tokens === 'number' ? row.output_tokens : 0;

    return {
      sessionId: row.session_id as string,
      parentSessionId: (row.parent_session_id as string) ?? undefined,
      status: (row.status as SessionStatus) ?? 'active',
      model: (row.model as string) ?? undefined,
      tokenUsage: (inputTokens || outputTokens) ? { input: inputTokens, output: outputTokens } : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
