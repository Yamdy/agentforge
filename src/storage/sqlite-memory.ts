import initSqlJs, { Database, QueryExecResult } from 'sql.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import type {
  MemoryStorage,
  Thread,
  Observation,
  WorkingMemory,
  ListThreadsOptions,
} from '../memory/types.js';
import type { Message } from '../types.js';

export class SQLiteMemoryStorage implements MemoryStorage {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string = './data/agentforge.db') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();
    let buffer: Buffer | undefined;

    if (fsSync.existsSync(this.dbPath)) {
      buffer = await fs.readFile(this.dbPath);
    }

    this.db = new SQL.Database(buffer);
    await this.createTables();
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (!this.db) return;

    const data = this.db.export();
    const buffer = Buffer.from(data);
    try {
      await fs.writeFile(this.dbPath, buffer);
    } catch (writeError) {
      console.error('Failed to save database to disk:', writeError);
    } finally {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  private async createTables(): Promise<void> {
    const queries = [
      `CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_name TEXT,
        created_at REAL NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS working_memory (
        thread_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at REAL NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp REAL NOT NULL,
        compression_level INTEGER,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );`,
      `CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);`,
      `CREATE INDEX IF NOT EXISTS idx_observations_thread_id ON observations(thread_id);`,
    ];

    for (const query of queries) {
      this.db!.run(query);
    }

    const migrations = [
      'ALTER TABLE messages ADD COLUMN tool_call_id TEXT',
      'ALTER TABLE messages ADD COLUMN tool_name TEXT',
    ];

    for (const migration of migrations) {
      try {
        this.db!.run(migration);
      } catch {
        // Column already exists, ignore
      }
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('SQLiteMemoryStorage not initialized. Call initialize() first.');
    }
  }

  // Thread operations
  async getThread(threadId: string): Promise<Thread | null> {
    this.ensureInitialized();
    const result = this.db!.exec(
      'SELECT id, title, created_at, updated_at FROM threads WHERE id = ?',
      [threadId]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const [id, title, createdAt, updatedAt] = result[0].values[0];
    return {
      id: id as string,
      title: title as string | undefined,
      createdAt: new Date(createdAt as number),
      updatedAt: new Date(updatedAt as number),
    };
  }

  async saveThread(thread: Thread): Promise<Thread> {
    this.ensureInitialized();
    this.db!.run(
      `INSERT OR REPLACE INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [thread.id, thread.title, thread.createdAt.getTime(), thread.updatedAt.getTime()]
    );
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    this.ensureInitialized();
    this.db!.run('DELETE FROM threads WHERE id = ?', [threadId]);
    this.db!.run('DELETE FROM messages WHERE thread_id = ?', [threadId]);
    this.db!.run('DELETE FROM working_memory WHERE thread_id = ?', [threadId]);
    this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);
  }

  async listThreads(options: ListThreadsOptions = {}): Promise<Thread[]> {
    this.ensureInitialized();
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const result = this.db!.exec(
      'SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    return this.rowsToThreads(result);
  }

  private rowsToThreads(result: QueryExecResult[]): Thread[] {
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      title: row[1] as string | undefined,
      createdAt: new Date(row[2] as number),
      updatedAt: new Date(row[3] as number),
    }));
  }

  // Message operations
  async getMessages(threadId: string): Promise<Message[]> {
    this.ensureInitialized();
    const result = this.db!.exec(
      'SELECT role, content, tool_call_id, tool_name FROM messages WHERE thread_id = ? ORDER BY id ASC',
      [threadId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(([role, content, toolCallId, toolName]) => {
      const message: Record<string, unknown> = {
        role: role as 'system' | 'user' | 'assistant' | 'tool',
        content: content as string,
      };
      if (toolCallId) {
        message.toolCallId = toolCallId as string;
      }
      if (toolName) {
        message.toolName = toolName as string;
      }
      return message as Message;
    });
  }

  async addMessage(threadId: string, message: Message): Promise<void> {
    this.ensureInitialized();
    const timestamp = Date.now();
    const toolCallId = (message as Record<string, unknown>).toolCallId as string | undefined;
    const toolName = (message as Record<string, unknown>).toolName as string | undefined;
    this.db!.run(
      'INSERT INTO messages (thread_id, role, content, tool_call_id, tool_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [threadId, message.role, message.content, toolCallId ?? null, toolName ?? null, timestamp]
    );

    this.db!.run('UPDATE threads SET updated_at = ? WHERE id = ?', [timestamp, threadId]);
  }

  // Working memory
  async getWorkingMemory(threadId: string): Promise<WorkingMemory | null> {
    this.ensureInitialized();
    const result = this.db!.exec(
      'SELECT content, updated_at FROM working_memory WHERE thread_id = ?',
      [threadId]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const [content, updatedAt] = result[0].values[0];
    return {
      content: content as string,
      updatedAt: new Date(updatedAt as number),
    };
  }

  async saveWorkingMemory(threadId: string, memory: WorkingMemory): Promise<void> {
    this.ensureInitialized();
    this.db!.run(
      `INSERT OR REPLACE INTO working_memory (thread_id, content, updated_at) VALUES (?, ?, ?)`,
      [threadId, memory.content, memory.updatedAt.getTime()]
    );
  }

  // Observational memory
  async getObservationalMemory(threadId: string): Promise<Observation[] | null> {
    this.ensureInitialized();
    const result = this.db!.exec(
      'SELECT id, content, timestamp, compression_level FROM observations WHERE thread_id = ? ORDER BY timestamp ASC',
      [threadId]
    );

    if (result.length === 0) return null;

    return result[0].values.map(([id, content, timestamp, compressionLevel]) => ({
      id: id as string,
      content: content as string,
      timestamp: new Date(timestamp as number),
      compressionLevel: compressionLevel as 0 | 1 | 2 | 3 | 4 | undefined,
    }));
  }

  async saveObservationalMemory(threadId: string, observations: Observation[]): Promise<void> {
    this.ensureInitialized();

    // Delete existing and insert new ones
    this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);

    for (const obs of observations) {
      this.db!.run(
        'INSERT INTO observations (id, thread_id, content, timestamp, compression_level) VALUES (?, ?, ?, ?, ?)',
        [obs.id, threadId, obs.content, obs.timestamp.getTime(), obs.compressionLevel]
      );
    }
  }
}
