import initSqlJs, { Database, QueryExecResult } from 'sql.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import type {
  MemoryStorage,
  Thread,
  Observation,
  WorkingMemory,
  ListThreadsOptions,
  AgentState,
} from '../memory/types.js';
import type { Checkpoint } from '../session/types.js';
import type { Message } from '../types.js';
import {
  StorageNotInitializedError,
  DatabaseWriteError,
  StorageParseError,
  type StorageOperation,
} from '../errors/index.js';
import { isAppError } from '../errors/guards.js';

export class SQLiteMemoryStorage implements MemoryStorage {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string = './data/agentforge.db') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    try {
      const SQL = await initSqlJs();
      let buffer: Buffer | undefined;

      if (fsSync.existsSync(this.dbPath)) {
        buffer = await fs.readFile(this.dbPath);
      }

      this.db = new SQL.Database(buffer);
      await this.createTables();
      this.initialized = true;
    } catch (err) {
      if (isAppError(err)) throw err;
      throw new DatabaseWriteError('initialize', 'Failed to initialize database', {
        cause: err instanceof Error ? err : undefined,
        context: { dbPath: this.dbPath },
      });
    }
  }

  async close(): Promise<void> {
    if (!this.db) return;

    const data = this.db.export();
    const buffer = Buffer.from(data);
    try {
      await fs.writeFile(this.dbPath, buffer);
    } catch (writeError) {
      // Log but don't throw on close — best-effort persistence
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

      // AgentState table
      `CREATE TABLE IF NOT EXISTS agent_state (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL,
        step INTEGER NOT NULL,
        max_steps INTEGER NOT NULL,
        error TEXT,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL,
        UNIQUE(session_id, agent_name)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_agent_state_session_id ON agent_state(session_id);`,

      // Checkpoints table
      `CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        messages TEXT NOT NULL,
        tool_calls TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at REAL NOT NULL,
        metadata TEXT
      );`,
      `CREATE INDEX IF NOT EXISTS idx_checkpoints_session_id ON checkpoints(session_id);`,
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

  private ensureInitialized(operation: StorageOperation = 'getThread'): void {
    if (!this.initialized || !this.db) {
      throw new StorageNotInitializedError(operation);
    }
  }

  // Thread operations
  async getThread(threadId: string): Promise<Thread | null> {
    this.ensureInitialized('getThread');
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
    this.ensureInitialized('saveThread');
    this.db!.run(
      `INSERT OR REPLACE INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [thread.id, thread.title ?? null, thread.createdAt.getTime(), thread.updatedAt.getTime()]
    );
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    this.ensureInitialized('deleteThread');
    // Delete in correct order: child tables first, then parent
    // 1. Delete agent_state (references session_id = threadId)
    this.db!.run('DELETE FROM agent_state WHERE session_id = ?', [threadId]);
    // 2. Delete checkpoints (references session_id = threadId)
    this.db!.run('DELETE FROM checkpoints WHERE session_id = ?', [threadId]);
    // 3. Delete messages (has FK CASCADE, but delete explicitly for clarity)
    this.db!.run('DELETE FROM messages WHERE thread_id = ?', [threadId]);
    // 4. Delete working_memory (has FK CASCADE, but delete explicitly for clarity)
    this.db!.run('DELETE FROM working_memory WHERE thread_id = ?', [threadId]);
    // 5. Delete observations (has FK CASCADE, but delete explicitly for clarity)
    this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);
    // 6. Finally delete the thread itself
    this.db!.run('DELETE FROM threads WHERE id = ?', [threadId]);
  }

  async listThreads(options: ListThreadsOptions = {}): Promise<Thread[]> {
    this.ensureInitialized('listThreads');
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
    this.ensureInitialized('getMessages');
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
    this.ensureInitialized('addMessage');
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
    this.ensureInitialized('getWorkingMemory');
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
    this.ensureInitialized('saveWorkingMemory');
    this.db!.run(
      `INSERT OR REPLACE INTO working_memory (thread_id, content, updated_at) VALUES (?, ?, ?)`,
      [threadId, memory.content, memory.updatedAt.getTime()]
    );
  }

  // Observational memory
  async getObservationalMemory(threadId: string): Promise<Observation[] | null> {
    this.ensureInitialized('getObservationalMemory');
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
    this.ensureInitialized('saveObservationalMemory');

    // Delete existing and insert new ones
    this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);

    for (const obs of observations) {
      this.db!.run(
        'INSERT INTO observations (id, thread_id, content, timestamp, compression_level) VALUES (?, ?, ?, ?, ?)',
        [obs.id, threadId, obs.content, obs.timestamp.getTime(), obs.compressionLevel ?? null]
      );
    }
  }

  // ========== AgentState operations ==========

  async getAgentState(sessionId: string, agentName: string): Promise<AgentState | null> {
    this.ensureInitialized('getAgentState');
    const result = this.db!.exec(
      `SELECT id, session_id, agent_name, status, step, max_steps, error, created_at, updated_at
       FROM agent_state WHERE session_id = ? AND agent_name = ?`,
      [sessionId, agentName]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const [id, sessionIdDb, agentNameDb, status, step, maxSteps, error, createdAt, updatedAt] = result[0].values[0];
    return {
      id: id as string,
      sessionId: sessionIdDb as string,
      agentName: agentNameDb as string,
      status: status as AgentState['status'],
      step: step as number,
      maxSteps: maxSteps as number,
      error: error ? (error as string) : undefined,
      createdAt: new Date(createdAt as number),
      updatedAt: new Date(updatedAt as number),
    };
  }

  async saveAgentState(state: AgentState): Promise<AgentState> {
    this.ensureInitialized('saveAgentState');
    this.db!.run(
      `INSERT OR REPLACE INTO agent_state
       (id, session_id, agent_name, status, step, max_steps, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state.id,
        state.sessionId,
        state.agentName,
        state.status,
        state.step,
        state.maxSteps,
        state.error ?? null,
        state.createdAt.getTime(),
        state.updatedAt.getTime(),
      ]
    );
    return state;
  }

  async deleteAgentState(sessionId: string, agentName: string): Promise<void> {
    this.ensureInitialized('deleteAgentState');
    this.db!.run('DELETE FROM agent_state WHERE session_id = ? AND agent_name = ?', [sessionId, agentName]);
  }

  async listAgentStates(sessionId: string): Promise<AgentState[]> {
    this.ensureInitialized('listAgentStates');
    const result = this.db!.exec(
      `SELECT id, session_id, agent_name, status, step, max_steps, error, created_at, updated_at
       FROM agent_state WHERE session_id = ? ORDER BY updated_at DESC`,
      [sessionId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(([id, sessionIdDb, agentName, status, step, maxSteps, error, createdAt, updatedAt]) => ({
      id: id as string,
      sessionId: sessionIdDb as string,
      agentName: agentName as string,
      status: status as AgentState['status'],
      step: step as number,
      maxSteps: maxSteps as number,
      error: error ? (error as string) : undefined,
      createdAt: new Date(createdAt as number),
      updatedAt: new Date(updatedAt as number),
    }));
  }

  // ========== Checkpoint operations ==========

  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    this.ensureInitialized('getCheckpoint');
    const result = this.db!.exec(
      `SELECT id, session_id, step_index, messages, tool_calls, state, created_at, metadata
       FROM checkpoints WHERE id = ?`,
      [checkpointId]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const [id, sessionId, stepIndex, messages, toolCalls, state, createdAt, metadata] = result[0].values[0];
    try {
      return {
        id: id as string,
        sessionId: sessionId as string,
        stepIndex: stepIndex as number,
        messages: JSON.parse(messages as string),
        toolCalls: JSON.parse(toolCalls as string),
        state: JSON.parse(state as string),
        createdAt: createdAt as number,
        metadata: metadata ? JSON.parse(metadata as string) : undefined,
      };
    } catch (err) {
      throw new StorageParseError('getCheckpoint', 'checkpoint data', err instanceof Error ? err : undefined);
    }
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<Checkpoint> {
    this.ensureInitialized('saveCheckpoint');
    this.db!.run(
      `INSERT OR REPLACE INTO checkpoints
       (id, session_id, step_index, messages, tool_calls, state, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        checkpoint.id,
        checkpoint.sessionId,
        checkpoint.stepIndex,
        JSON.stringify(checkpoint.messages),
        JSON.stringify(checkpoint.toolCalls),
        JSON.stringify(checkpoint.state),
        checkpoint.createdAt,
        checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null,
      ]
    );
    return checkpoint;
  }

  async listCheckpoints(sessionId: string): Promise<Checkpoint[]> {
    this.ensureInitialized('listCheckpoints');
    const result = this.db!.exec(
      `SELECT id, session_id, step_index, messages, tool_calls, state, created_at, metadata
       FROM checkpoints WHERE session_id = ? ORDER BY step_index DESC`,
      [sessionId]
    );

    if (result.length === 0) return [];

    return result[0].values.map(([id, sessionIdDb, stepIndex, messages, toolCalls, state, createdAt, metadata]) => {
      try {
        return {
          id: id as string,
          sessionId: sessionIdDb as string,
          stepIndex: stepIndex as number,
          messages: JSON.parse(messages as string),
          toolCalls: JSON.parse(toolCalls as string),
          state: JSON.parse(state as string),
          createdAt: createdAt as number,
          metadata: metadata ? JSON.parse(metadata as string) : undefined,
        };
      } catch (err) {
        throw new StorageParseError('listCheckpoints', 'checkpoint data', err instanceof Error ? err : undefined);
      }
    });
  }

  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    this.ensureInitialized('deleteCheckpoint');
    const existing = await this.getCheckpoint(checkpointId);
    if (!existing) return false;

    this.db!.run('DELETE FROM checkpoints WHERE id = ?', [checkpointId]);
    return true;
  }
}
