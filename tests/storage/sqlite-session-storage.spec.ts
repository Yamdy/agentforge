/**
 * Unit tests for src/storage/sqlite-session-storage.ts
 *
 * Tests SQLite-backed SessionStorage implementation.
 * Uses :memory: database for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteSessionStorage } from '../../src/storage/sqlite-session-storage.js';
import { createInitialState, type AgentState } from '../../src/core/state.js';

// ============================================================
// Test Helpers
// ============================================================

function createTestState(sessionId: string, overrides?: Partial<AgentState>): AgentState {
  return {
    ...createInitialState({
      sessionId,
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    }),
    ...overrides,
  };
}

// ============================================================
// Basic CRUD Tests
// ============================================================

describe('SqliteSessionStorage', () => {
  let storage: SqliteSessionStorage;

  beforeEach(() => {
    storage = new SqliteSessionStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  // ----------------------------------------------------------
  // save + load
  // ----------------------------------------------------------

  describe('save / load', () => {
    it('should save and load a session', async () => {
      const state = createTestState('session-1');
      await storage.save('session-1', state);

      const loaded = await storage.load('session-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe('session-1');
      expect(loaded!.agentName).toBe('assistant');
      expect(loaded!.model.provider).toBe('openai');
    });

    it('should return null for non-existent session', async () => {
      const loaded = await storage.load('nonexistent');
      expect(loaded).toBeNull();
    });

    it('should overwrite existing session on save', async () => {
      const state1 = createTestState('session-1', { step: 0, output: '' });
      const state2 = createTestState('session-1', { step: 5, output: 'hello' });

      await storage.save('session-1', state1);
      await storage.save('session-1', state2);

      const loaded = await storage.load('session-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.step).toBe(5);
      expect(loaded!.output).toBe('hello');
    });

    it('should preserve messages', async () => {
      const state = createTestState('session-1', {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });

      await storage.save('session-1', state);
      const loaded = await storage.load('session-1');

      expect(loaded).not.toBeNull();
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.messages[0]!.content).toBe('Hello');
      expect(loaded!.messages[1]!.content).toBe('Hi there!');
    });

    it('should preserve token stats', async () => {
      const state = createTestState('session-1', {
        tokens: { prompt: 100, completion: 50 },
      });

      await storage.save('session-1', state);
      const loaded = await storage.load('session-1');

      expect(loaded!.tokens.prompt).toBe(100);
      expect(loaded!.tokens.completion).toBe(50);
    });

    it('should preserve optional fields when present', async () => {
      const state = createTestState('session-1', {
        batchContext: {
          batchId: 'batch-1',
          totalCalls: 3,
          completedCalls: 1,
          startedAt: Date.now(),
        },
        contextManagement: {
          totalTokens: 500,
          compactionCount: 2,
        },
      });

      await storage.save('session-1', state);
      const loaded = await storage.load('session-1');

      expect(loaded!.batchContext).toBeDefined();
      expect(loaded!.batchContext!.batchId).toBe('batch-1');
      expect(loaded!.contextManagement).toBeDefined();
      expect(loaded!.contextManagement!.totalTokens).toBe(500);
    });
  });

  // ----------------------------------------------------------
  // delete
  // ----------------------------------------------------------

  describe('delete', () => {
    it('should delete a session', async () => {
      const state = createTestState('session-1');
      await storage.save('session-1', state);

      await storage.delete('session-1');

      const loaded = await storage.load('session-1');
      expect(loaded).toBeNull();
    });

    it('should not throw when deleting non-existent session', async () => {
      await expect(storage.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('should not affect other sessions', async () => {
      await storage.save('session-a', createTestState('session-a'));
      await storage.save('session-b', createTestState('session-b'));

      await storage.delete('session-a');

      const loadedB = await storage.load('session-b');
      expect(loadedB).not.toBeNull();
      expect(loadedB!.sessionId).toBe('session-b');
    });
  });

  // ----------------------------------------------------------
  // list
  // ----------------------------------------------------------

  describe('list', () => {
    it('should list all session ids', async () => {
      await storage.save('session-1', createTestState('session-1'));
      await storage.save('session-2', createTestState('session-2'));
      await storage.save('session-3', createTestState('session-3'));

      const ids = await storage.list();
      expect(ids).toHaveLength(3);
      expect(ids).toContain('session-1');
      expect(ids).toContain('session-2');
      expect(ids).toContain('session-3');
    });

    it('should return empty array when no sessions exist', async () => {
      const ids = await storage.list();
      expect(ids).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      for (let i = 1; i <= 5; i++) {
        await storage.save(`session-${i}`, createTestState(`session-${i}`));
      }

      const ids = await storage.list(2);
      expect(ids).toHaveLength(2);
    });

    it('should not list deleted sessions', async () => {
      await storage.save('session-1', createTestState('session-1'));
      await storage.save('session-2', createTestState('session-2'));

      await storage.delete('session-1');

      const ids = await storage.list();
      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe('session-2');
    });
  });

  // ----------------------------------------------------------
  // Auto-create database / table
  // ----------------------------------------------------------

  describe('auto-create', () => {
    it('should auto-create tables on construction', async () => {
      const state = createTestState('session-1');
      await storage.save('session-1', state);
      const loaded = await storage.load('session-1');
      expect(loaded).not.toBeNull();
    });
  });

  // ----------------------------------------------------------
  // Concurrent writes
  // ----------------------------------------------------------

  describe('concurrent writes', () => {
    it('should handle multiple concurrent saves', async () => {
      const sessions = Array.from({ length: 10 }, (_, i) => ({
        id: `session-${i}`,
        state: createTestState(`session-${i}`),
      }));

      await Promise.all(
        sessions.map(s => storage.save(s.id, s.state)),
      );

      const ids = await storage.list();
      expect(ids).toHaveLength(10);
    });
  });
});
