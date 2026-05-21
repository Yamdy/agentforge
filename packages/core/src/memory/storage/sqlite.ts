import Database from 'better-sqlite3';
import type {
  MemoryStorage,
  WorkingMemory,
  MemoryEvent,
  EventQuery,
  Fact,
  SearchOptions,
  Entity,
  Relation,
} from '../types.js';

export class SqliteStore implements MemoryStorage {
  private db: ReturnType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS working_memory (
        scope TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_scope ON events(scope);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT,
        categories TEXT DEFAULT '[]',
        importance REAL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        last_accessed TEXT NOT NULL,
        access_count INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope);

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        attributes TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS relations (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL DEFAULT 1.0
      );
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
    `);
  }

  // ── Working Memory ──────────────────────────────────────────

  async getWorkingMemory(scope: string): Promise<WorkingMemory | undefined> {
    const row = this.db.prepare('SELECT data FROM working_memory WHERE scope = ?').get(scope) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    return JSON.parse(row.data) as WorkingMemory;
  }

  async setWorkingMemory(scope: string, memory: WorkingMemory): Promise<void> {
    const data = JSON.stringify(memory);
    this.db
      .prepare('INSERT OR REPLACE INTO working_memory (scope, data) VALUES (?, ?)')
      .run(scope, data);
  }

  // ── Episodic Memory ─────────────────────────────────────────

  async appendEvent(scope: string, event: MemoryEvent): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO events (id, scope, timestamp, type, content, importance, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        scope,
        event.timestamp,
        event.type,
        event.content,
        event.importance,
        event.metadata ? JSON.stringify(event.metadata) : null,
      );
  }

  async getEvents(scope: string, query?: EventQuery): Promise<MemoryEvent[]> {
    const conditions: string[] = ['scope = ?'];
    const params: unknown[] = [scope];

    if (query?.timeRange) {
      conditions.push('timestamp >= ? AND timestamp <= ?');
      params.push(query.timeRange.start, query.timeRange.end);
    }
    if (query?.minImportance !== undefined) {
      conditions.push('importance >= ?');
      params.push(query.minImportance);
    }
    if (query?.types && query.types.length > 0) {
      const placeholders = query.types.map(() => '?').join(', ');
      conditions.push(`type IN (${placeholders})`);
      params.push(...query.types);
    }

    let sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY timestamp ASC`;
    if (query?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      scope: string;
      timestamp: string;
      type: string;
      content: string;
      importance: number;
      metadata: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      type: r.type as MemoryEvent['type'],
      content: r.content,
      importance: r.importance,
      metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
    }));
  }

  // ── Semantic Memory ─────────────────────────────────────────

  async upsertFact(scope: string, fact: Fact): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO facts (id, scope, content, embedding, categories, importance, created_at, last_accessed, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fact.id,
        scope,
        fact.content,
        fact.embedding ? JSON.stringify(fact.embedding) : null,
        JSON.stringify(fact.categories),
        fact.importance,
        fact.createdAt,
        fact.lastAccessed,
        fact.accessCount,
      );
  }

  async getFacts(scope: string, query?: SearchOptions): Promise<Fact[]> {
    const conditions: string[] = ['scope = ?'];
    const params: unknown[] = [scope];

    if (query?.minImportance !== undefined) {
      conditions.push('importance >= ?');
      params.push(query.minImportance);
    }

    let sql = `SELECT * FROM facts WHERE ${conditions.join(' AND ')} ORDER BY importance DESC`;
    if (query?.topK !== undefined) {
      sql += ' LIMIT ?';
      params.push(query.topK);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      scope: string;
      content: string;
      embedding: string | null;
      categories: string;
      importance: number;
      created_at: string;
      last_accessed: string;
      access_count: number;
    }>;

    return rows.map((r) => rowToFact(r));
  }

  async searchFacts(query: string, options?: SearchOptions): Promise<Fact[]> {
    const conditions: string[] = ['content LIKE ?'];
    const params: unknown[] = [`%${query}%`];

    if (options?.scope) {
      conditions.push('scope = ?');
      params.push(options.scope);
    }
    if (options?.minImportance !== undefined) {
      conditions.push('importance >= ?');
      params.push(options.minImportance);
    }

    let sql = `SELECT * FROM facts WHERE ${conditions.join(' AND ')} ORDER BY importance DESC`;
    if (options?.topK !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.topK);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      scope: string;
      content: string;
      embedding: string | null;
      categories: string;
      importance: number;
      created_at: string;
      last_accessed: string;
      access_count: number;
    }>;

    return rows.map((r) => rowToFact(r));
  }

  async deleteFact(scope: string, factId: string): Promise<void> {
    this.db.prepare('DELETE FROM facts WHERE scope = ? AND id = ?').run(scope, factId);
  }

  // ── Entity & Relation ───────────────────────────────────────

  async upsertEntity(entity: Entity): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO entities (id, name, type, attributes)
       VALUES (?, ?, ?, ?)`,
      )
      .run(entity.id, entity.name, entity.type, JSON.stringify(entity.attributes));
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as
      | {
          id: string;
          name: string;
          type: string;
          attributes: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      attributes: JSON.parse(row.attributes) as Record<string, unknown>,
    };
  }

  async upsertRelation(relation: Relation): Promise<void> {
    const existing = this.db
      .prepare('SELECT rowid FROM relations WHERE from_id = ? AND to_id = ? AND type = ?')
      .get(relation.from, relation.to, relation.type);

    if (existing) {
      this.db
        .prepare('UPDATE relations SET weight = ? WHERE from_id = ? AND to_id = ? AND type = ?')
        .run(relation.weight, relation.from, relation.to, relation.type);
    } else {
      this.db
        .prepare('INSERT INTO relations (from_id, to_id, type, weight) VALUES (?, ?, ?, ?)')
        .run(relation.from, relation.to, relation.type, relation.weight);
    }
  }

  async getRelations(from?: string, to?: string): Promise<Relation[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (from) {
      conditions.push('from_id = ?');
      params.push(from);
    }
    if (to) {
      conditions.push('to_id = ?');
      params.push(to);
    }

    let sql = 'SELECT * FROM relations';
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      from_id: string;
      to_id: string;
      type: string;
      weight: number;
    }>;

    return rows.map((r) => ({
      from: r.from_id,
      to: r.to_id,
      type: r.type,
      weight: r.weight,
    }));
  }
}

function rowToFact(r: {
  id: string;
  content: string;
  embedding: string | null;
  categories: string;
  importance: number;
  created_at: string;
  last_accessed: string;
  access_count: number;
}): Fact {
  return {
    id: r.id,
    content: r.content,
    embedding: r.embedding ? (JSON.parse(r.embedding) as number[]) : undefined,
    scope: '',
    categories: JSON.parse(r.categories) as string[],
    importance: r.importance,
    createdAt: r.created_at,
    lastAccessed: r.last_accessed,
    accessCount: r.access_count,
  };
}
