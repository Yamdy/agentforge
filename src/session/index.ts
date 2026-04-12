import {
  initSessionStorage,
  closeSessionStorage,
  createSession,
  getSession,
  listSessions,
  updateSession,
  addMessageToSession,
  deleteSession,
  markSessionCompacted,
  type Session,
  type SessionMessage,
} from './storage.js';

export { CheckpointManager } from './checkpoint.js';
export { compactMessages, compactSession, applyCompaction, estimateTokens } from './compaction.js';
export type { CompactionOptions, CompactionResult } from './compaction.js';
export type { Checkpoint, SessionConfig, PendingToolCall } from './types.js';

export type { Session, SessionMessage };

export interface SessionAPI {
  init(): Promise<void>;
  close(): void;
  create(options?: {
    title?: string;
    messages?: SessionMessage[];
    parentId?: string;
    projectId?: string;
  }): Promise<Session>;
  get(id: string): Promise<Session | null>;
  list(options?: {
    limit?: number;
    offset?: number;
    parentId?: string;
    projectId?: string;
  }): Promise<Session[]>;
  update(
    id: string,
    updates: Partial<Pick<Session, 'title' | 'messages' | 'parentId' | 'projectId'>>
  ): Promise<Session | null>;
  addMessage(id: string, message: SessionMessage): Promise<Session | null>;
  delete(id: string): Promise<boolean>;
}

export function createSessionAPI(): SessionAPI {
  return {
    async init() {
      await initSessionStorage();
    },
    close() {
      closeSessionStorage();
    },
    async create(options) {
      const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      return createSession(id, options?.title ?? 'New Session', {
        parentId: options?.parentId,
        projectId: options?.projectId,
        messages: options?.messages,
      });
    },
    async get(id) {
      return getSession(id);
    },
    async list(options) {
      return listSessions(options);
    },
    async update(id, updates) {
      return updateSession(id, updates);
    },
    async addMessage(id, message) {
      return addMessageToSession(id, message);
    },
    async delete(id) {
      return deleteSession(id);
    },
  };
}
