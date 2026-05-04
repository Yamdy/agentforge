/**
 * Unit tests for src/storage/sqlite-checkpoint-storage.ts
 *
 * Tests SQLite-backed CheckpointStorage implementation.
 * Uses :memory: database for isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteCheckpointStorage } from '../../src/storage/sqlite-checkpoint-storage.js';
import type { Checkpoint } from '../../src/core/checkpoint.js';
import { createCheckpoint } from '../../src/core/checkpoint.js';
import { createInitialState } from '../../src/core/state.js';
import type { AgentState } from '../../src/core/state.js';

// ============================================================
// Test Helpers
// ============================================================

function createTestState(sessionId: string): AgentState {
  return createInitialState({
    sessionId,
    agentName: 'assistant',
    model: { provider: 'openai', model: 'gpt-4' },
  });
}

function createTestCheckpoint(
  id: string,
  sessionId: string,
  timestamp?: number,
): Checkpoint {
  const cp = createCheckpoint({
    id,
    sessionId,
    position: 'after_llm',
    state: createTestState(sessionId),
  });
  if (timestamp !== undefined) {
    return { ...cp, timestamp };
  }
  return cp;
}

// ============================================================
// Basic CRUD Tests
// ============================================================

describe('SqliteCheckpointStorage', () => {
  let storage: SqliteCheckpointStorage;

  beforeEach(() => {
    storage = new SqliteCheckpointStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  // ----------------------------------------------------------
  // save + load
  // ----------------------------------------------------------

  describe('save / load', () => {
    it('should save and load a checkpoint by id', async () => {
      const cp = createTestCheckpoint('cp-1', 'session-1');
      await storage.save(cp);

      const loaded = await storage.load('session-1', 'cp-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('cp-1');
      expect(loaded!.sessionId).toBe('session-1');
      expect(loaded!.position).toBe('after_llm');
      expect(loaded!.state.sessionId).toBe('session-1');
    });

    it('should return null when checkpoint does not exist', async () => {
      const loaded = await storage.load('session-1', 'nonexistent');
      expect(loaded).toBeNull();
    });

    it('should return null when session has no checkpoints', async () => {
      const loaded = await storage.load('empty-session');
      expect(loaded).toBeNull();
    });

    it('should return latest checkpoint when checkpointId is omitted', async () => {
      const base = Date.now();
      const cp1 = createTestCheckpoint('cp-1', 'session-1', base);
      const cp2 = createTestCheckpoint('cp-2', 'session-1', base + 100);

      await storage.save(cp1);
      await storage.save(cp2);

      const loaded = await storage.load('session-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('cp-2');
    });

    it('should overwrite checkpoint with same id', async () => {
      const cp1 = createCheckpoint({
        id: 'cp-1',
        sessionId: 'session-1',
        position: 'before_llm',
        state: createTestState('session-1'),
      });
      const cp2 = createCheckpoint({
        id: 'cp-1',
        sessionId: 'session-1',
        position: 'after_tool',
        state: createTestState('session-1'),
      });

      await storage.save(cp1);
      await storage.save(cp2);

      const loaded = await storage.load('session-1', 'cp-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.position).toBe('after_tool');
    });

    it('should preserve all checkpoint fields including arrays', async () => {
      const cp = createCheckpoint({
        id: 'cp-full',
        sessionId: 'session-1',
        position: 'after_tool',
        state: createTestState('session-1'),
        executedTools: [
          {
            toolCallId: 'tc-1',
            toolName: 'weather',
            idempotencyKey: 'session-1:tc-1',
            executedAt: Date.now(),
          },
        ],
        pendingA2A: [
          {
            requestId: 'req-1',
            targetAgent: 'researcher',
            requestType: 'request',
            payload: { query: 'test' },
            sentAt: Date.now(),
            status: 'pending',
          },
        ],
        recoveryMetadata: {
          recoveryCount: 1,
          originalSessionId: 'session-0',
        },
      });

      await storage.save(cp);
      const loaded = await storage.load('session-1', 'cp-full');

      expect(loaded).not.toBeNull();
      expect(loaded!.executedTools).toHaveLength(1);
      expect(loaded!.executedTools![0]!.toolCallId).toBe('tc-1');
      expect(loaded!.pendingA2A).toHaveLength(1);
      expect(loaded!.pendingA2A![0]!.requestId).toBe('req-1');
      expect(loaded!.recoveryMetadata?.recoveryCount).toBe(1);
    });
  });

  // ----------------------------------------------------------
  // list
  // ----------------------------------------------------------

  describe('list', () => {
    it('should list checkpoints for a session ordered by timestamp desc', async () => {
      const base = Date.now();
      const cp1 = createTestCheckpoint('cp-1', 'session-1', base);
      const cp2 = createTestCheckpoint('cp-2', 'session-1', base + 100);
      const cp3 = createTestCheckpoint('cp-3', 'session-1', base + 200);

      await storage.save(cp1);
      await storage.save(cp2);
      await storage.save(cp3);

      const list = await storage.list('session-1');
      expect(list).toHaveLength(3);
      // Descending order: cp3 first (most recent)
      expect(list[0]!.id).toBe('cp-3');
      expect(list[1]!.id).toBe('cp-2');
      expect(list[2]!.id).toBe('cp-1');
    });

    it('should return empty array for session with no checkpoints', async () => {
      const list = await storage.list('empty-session');
      expect(list).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      vi.useFakeTimers();
      for (let i = 1; i <= 5; i++) {
        await storage.save(createTestCheckpoint(`cp-${i}`, 'session-1'));
        await vi.advanceTimersByTimeAsync(5);
      }

      const list = await storage.list('session-1', 2);
      vi.useRealTimers();
      expect(list).toHaveLength(2);
    });

    it('should not list checkpoints from other sessions', async () => {
      await storage.save(createTestCheckpoint('cp-a1', 'session-a'));
      await storage.save(createTestCheckpoint('cp-b1', 'session-b'));

      const listA = await storage.list('session-a');
      expect(listA).toHaveLength(1);
      expect(listA[0]!.id).toBe('cp-a1');
    });
  });

  // ----------------------------------------------------------
  // delete
  // ----------------------------------------------------------

  describe('delete', () => {
    it('should delete a checkpoint', async () => {
      const cp = createTestCheckpoint('cp-1', 'session-1');
      await storage.save(cp);

      await storage.delete('session-1', 'cp-1');

      const loaded = await storage.load('session-1', 'cp-1');
      expect(loaded).toBeNull();
    });

    it('should not throw when deleting non-existent checkpoint', async () => {
      await expect(
        storage.delete('session-1', 'nonexistent'),
      ).resolves.toBeUndefined();
    });

    it('should only delete the specified checkpoint', async () => {
      await storage.save(createTestCheckpoint('cp-1', 'session-1'));
      await storage.save(createTestCheckpoint('cp-2', 'session-1'));

      await storage.delete('session-1', 'cp-1');

      const list = await storage.list('session-1');
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe('cp-2');
    });
  });

  // ----------------------------------------------------------
  // Auto-create database / table
  // ----------------------------------------------------------

  describe('auto-create', () => {
    it('should auto-create tables on construction', async () => {
      // Already tested by all above tests using :memory:
      // This is an explicit verification
      const cp = createTestCheckpoint('cp-1', 'session-1');
      await storage.save(cp);
      const loaded = await storage.load('session-1', 'cp-1');
      expect(loaded).not.toBeNull();
    });
  });

  // ----------------------------------------------------------
  // Concurrent writes
  // ----------------------------------------------------------

  describe('concurrent writes', () => {
    it('should handle multiple concurrent saves', async () => {
      const checkpoints = Array.from({ length: 10 }, (_, i) =>
        createTestCheckpoint(`cp-${i}`, 'session-1'),
      );

      await Promise.all(checkpoints.map(cp => storage.save(cp)));

      const list = await storage.list('session-1');
      expect(list).toHaveLength(10);
    });
  });
});
