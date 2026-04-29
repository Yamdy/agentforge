/**
 * AgentForge Persistent Memory Store
 *
 * Interface for persisting and restoring conversation sessions.
 * Provides cross-session memory continuity for agents.
 *
 * Design note: This is a separate interface from MemoryStore because:
 * - MemoryStore is synchronous (add/getAll) for in-session message storage
 * - PersistentMemoryStore is async (persist/restore) for I/O-bound persistence
 * They serve different layers and should not share an inheritance hierarchy.
 *
 * @module
 */

import type { Message } from '../core/events.js';

// ============================================================
// Session Metadata
// ============================================================

/**
 * Metadata for a persisted session
 */
export interface SessionMetadata {
  /** Unique session ID */
  sessionId: string;

  /** Agent name */
  agentName: string;

  /** Creation timestamp (ms) */
  createdAt: number;

  /** Last update timestamp (ms) */
  updatedAt: number;

  /** Number of messages in the session */
  messageCount: number;
}

// ============================================================
// Persisted Session
// ============================================================

/**
 * A fully persisted session with messages and metadata
 */
export interface PersistedSession {
  /** Session metadata */
  metadata: SessionMetadata;

  /** Conversation messages */
  messages: Message[];
}

// ============================================================
// Persistent Memory Store Interface
// ============================================================

/**
 * Persistent Memory Store
 *
 * Enables conversation persistence across sessions.
 * Implementations may use SQLite, PostgreSQL, file systems, etc.
 *
 * Note: This interface does NOT extend MemoryStore because:
 * - MemoryStore is synchronous (add/getAll) — for in-session use
 * - PersistentMemoryStore is async (persist/restore) — for I/O-bound persistence
 * They operate at different abstraction levels.
 */
export interface PersistentMemoryStore {
  /**
   * Persist the current session messages
   *
   * @param sessionId - Unique session identifier
   * @param messages - Current conversation messages
   * @returns Whether persist succeeded
   */
  persist(sessionId: string, messages: Message[]): Promise<boolean>;

  /**
   * Restore messages from a persisted session
   *
   * @param sessionId - Session to restore
   * @returns Restored messages, or empty array if not found
   */
  restore(sessionId: string): Promise<Message[]>;

  /**
   * List available sessions (optional)
   *
   * @param limit - Max sessions to return
   * @returns Session metadata list, most recent first
   */
  listSessions?(limit?: number): Promise<SessionMetadata[]>;

  /**
   * Delete a persisted session
   *
   * @param sessionId - Session to delete
   * @returns Whether delete succeeded
   */
  delete?(sessionId: string): Promise<boolean>;
}
