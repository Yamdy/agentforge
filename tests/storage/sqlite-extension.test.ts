import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteMemoryStorage } from '../../src/storage/sqlite-memory.js';
import type { AgentState } from '../../src/memory/types.js';
import type { Checkpoint } from '../../src/session/types.js';
import type { TaskState } from '../../src/types.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

describe('SQLiteMemoryStorage - AgentState & Checkpoint', () => {
  let storage: SQLiteMemoryStorage;
  let dbPath: string;

  beforeEach(async () => {
    // Use a unique temp DB for each test
    const tmpDir = path.join(os.tmpdir(), 'agentforge-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    await fs.mkdir(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');

    storage = new SQLiteMemoryStorage(dbPath);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    // Clean up temp file
    try {
      await fs.unlink(dbPath);
      const dir = path.dirname(dbPath);
      await fs.rmdir(dir);
    } catch {
      // Ignore cleanup errors
    }
  });

  // ========== AgentState Tests ==========

  describe('AgentState', () => {
    const baseState: AgentState = {
      id: 'state-1',
      sessionId: 'session-1',
      agentName: 'test-agent',
      status: 'running',
      step: 3,
      maxSteps: 10,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:01:00Z'),
    };

    it('should save and retrieve agent state', async () => {
      await storage.saveAgentState(baseState);
      const retrieved = await storage.getAgentState('session-1', 'test-agent');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('state-1');
      expect(retrieved!.sessionId).toBe('session-1');
      expect(retrieved!.agentName).toBe('test-agent');
      expect(retrieved!.status).toBe('running');
      expect(retrieved!.step).toBe(3);
      expect(retrieved!.maxSteps).toBe(10);
      expect(retrieved!.error).toBeUndefined();
    });

    it('should return null for non-existent agent state', async () => {
      const result = await storage.getAgentState('non-existent', 'no-agent');
      expect(result).toBeNull();
    });

    it('should save agent state with error', async () => {
      const stateWithError: AgentState = {
        ...baseState,
        id: 'state-err',
        agentName: 'error-agent',
        status: 'error',
        error: 'Something went wrong',
      };
      await storage.saveAgentState(stateWithError);
      const retrieved = await storage.getAgentState('session-1', 'error-agent');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.status).toBe('error');
      expect(retrieved!.error).toBe('Something went wrong');
    });

    it('should upsert agent state (INSERT OR REPLACE)', async () => {
      await storage.saveAgentState(baseState);
      const updated: AgentState = {
        ...baseState,
        step: 5,
        status: 'paused',
        updatedAt: new Date('2026-01-01T00:02:00Z'),
      };
      await storage.saveAgentState(updated);

      const retrieved = await storage.getAgentState('session-1', 'test-agent');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.step).toBe(5);
      expect(retrieved!.status).toBe('paused');
    });

    it('should delete agent state', async () => {
      await storage.saveAgentState(baseState);
      await storage.deleteAgentState('session-1', 'test-agent');

      const retrieved = await storage.getAgentState('session-1', 'test-agent');
      expect(retrieved).toBeNull();
    });

    it('should not throw when deleting non-existent agent state', async () => {
      await expect(storage.deleteAgentState('non-existent', 'no-agent')).resolves.toBeUndefined();
    });

    it('should list agent states for a session', async () => {
      const states: AgentState[] = [
        { ...baseState, id: 'state-a', agentName: 'agent-a', step: 1 },
        { ...baseState, id: 'state-b', agentName: 'agent-b', step: 2 },
        { ...baseState, id: 'state-c', agentName: 'agent-c', step: 3 },
      ];

      for (const state of states) {
        await storage.saveAgentState(state);
      }

      const listed = await storage.listAgentStates('session-1');
      expect(listed).toHaveLength(3);

      const names = listed.map((s) => s.agentName).sort();
      expect(names).toEqual(['agent-a', 'agent-b', 'agent-c']);
    });

    it('should return empty list for session with no states', async () => {
      const listed = await storage.listAgentStates('empty-session');
      expect(listed).toHaveLength(0);
    });

    it('should isolate agent states by session', async () => {
      await storage.saveAgentState(baseState);
      const otherState: AgentState = {
        ...baseState,
        id: 'state-other',
        sessionId: 'session-2',
        agentName: 'test-agent',
      };
      await storage.saveAgentState(otherState);

      const listed1 = await storage.listAgentStates('session-1');
      const listed2 = await storage.listAgentStates('session-2');

      expect(listed1).toHaveLength(1);
      expect(listed1[0].id).toBe('state-1');
      expect(listed2).toHaveLength(1);
      expect(listed2[0].id).toBe('state-other');
    });

    it('should handle all valid status values', async () => {
      const statuses: AgentState['status'][] = [
        'pending', 'running', 'paused', 'completed', 'cancelled', 'error',
      ];

      for (const status of statuses) {
        const state: AgentState = {
          ...baseState,
          id: `state-${status}`,
          agentName: `agent-${status}`,
          status,
          error: status === 'error' ? 'test error' : undefined,
        };
        await storage.saveAgentState(state);

        const retrieved = await storage.getAgentState('session-1', `agent-${status}`);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.status).toBe(status);
      }
    });
  });

  // ========== Checkpoint Tests ==========

  describe('Checkpoint', () => {
    const baseCheckpoint: Checkpoint = {
      id: 'checkpoint-1',
      sessionId: 'session-1',
      stepIndex: 1,
      messages: [
        { role: 'user', content: 'Hello', timestamp: Date.now() },
        { role: 'assistant', content: 'Hi there!' },
      ],
      toolCalls: [
        { id: 'call-1', name: 'read', arguments: '{"filePath":"/test.txt"}' },
      ],
      state: { status: 'running', step: 1, maxSteps: 10 } as TaskState,
      createdAt: Date.now(),
    };

    it('should save and retrieve checkpoint', async () => {
      await storage.saveCheckpoint(baseCheckpoint);
      const retrieved = await storage.getCheckpoint('checkpoint-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('checkpoint-1');
      expect(retrieved!.sessionId).toBe('session-1');
      expect(retrieved!.stepIndex).toBe(1);
      expect(retrieved!.messages).toHaveLength(2);
      expect(retrieved!.messages[0].content).toBe('Hello');
      expect(retrieved!.toolCalls).toHaveLength(1);
      expect(retrieved!.toolCalls[0].name).toBe('read');
      expect(retrieved!.state.status).toBe('running');
    });

    it('should return null for non-existent checkpoint', async () => {
      const result = await storage.getCheckpoint('non-existent');
      expect(result).toBeNull();
    });

    it('should save checkpoint with metadata', async () => {
      const checkpointWithMeta: Checkpoint = {
        ...baseCheckpoint,
        id: 'checkpoint-meta',
        metadata: { reason: 'auto', priority: 'high' },
      };
      await storage.saveCheckpoint(checkpointWithMeta);
      const retrieved = await storage.getCheckpoint('checkpoint-meta');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.metadata).toEqual({ reason: 'auto', priority: 'high' });
    });

    it('should save checkpoint without metadata', async () => {
      await storage.saveCheckpoint(baseCheckpoint);
      const retrieved = await storage.getCheckpoint('checkpoint-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.metadata).toBeUndefined();
    });

    it('should list checkpoints for a session (newest first)', async () => {
      const checkpoints: Checkpoint[] = [
        { ...baseCheckpoint, id: 'cp-1', stepIndex: 1 },
        { ...baseCheckpoint, id: 'cp-2', stepIndex: 2 },
        { ...baseCheckpoint, id: 'cp-3', stepIndex: 3 },
      ];

      for (const cp of checkpoints) {
        await storage.saveCheckpoint(cp);
      }

      const listed = await storage.listCheckpoints('session-1');
      expect(listed).toHaveLength(3);
      // Descending by stepIndex
      expect(listed[0].stepIndex).toBe(3);
      expect(listed[1].stepIndex).toBe(2);
      expect(listed[2].stepIndex).toBe(1);
    });

    it('should return empty list for session with no checkpoints', async () => {
      const listed = await storage.listCheckpoints('empty-session');
      expect(listed).toHaveLength(0);
    });

    it('should delete checkpoint', async () => {
      await storage.saveCheckpoint(baseCheckpoint);
      const deleted = await storage.deleteCheckpoint('checkpoint-1');

      expect(deleted).toBe(true);
      const retrieved = await storage.getCheckpoint('checkpoint-1');
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting non-existent checkpoint', async () => {
      const deleted = await storage.deleteCheckpoint('non-existent');
      expect(deleted).toBe(false);
    });

    it('should isolate checkpoints by session', async () => {
      await storage.saveCheckpoint(baseCheckpoint);
      const otherCheckpoint: Checkpoint = {
        ...baseCheckpoint,
        id: 'cp-other',
        sessionId: 'session-2',
      };
      await storage.saveCheckpoint(otherCheckpoint);

      const listed1 = await storage.listCheckpoints('session-1');
      const listed2 = await storage.listCheckpoints('session-2');

      expect(listed1).toHaveLength(1);
      expect(listed1[0].id).toBe('checkpoint-1');
      expect(listed2).toHaveLength(1);
      expect(listed2[0].id).toBe('cp-other');
    });

    it('should preserve complex state in checkpoint', async () => {
      const complexState: TaskState = {
        status: 'error',
        step: 7,
        maxSteps: 15,
        error: 'Network timeout',
      };
      const checkpoint: Checkpoint = {
        ...baseCheckpoint,
        id: 'cp-complex',
        state: complexState,
      };

      await storage.saveCheckpoint(checkpoint);
      const retrieved = await storage.getCheckpoint('cp-complex');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.state).toEqual(complexState);
    });

    it('should upsert checkpoint (INSERT OR REPLACE)', async () => {
      await storage.saveCheckpoint(baseCheckpoint);
      const updated: Checkpoint = {
        ...baseCheckpoint,
        stepIndex: 5,
        messages: [...baseCheckpoint.messages, { role: 'user', content: 'Follow up' }],
      };
      await storage.saveCheckpoint(updated);

      const retrieved = await storage.getCheckpoint('checkpoint-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.stepIndex).toBe(5);
      expect(retrieved!.messages).toHaveLength(3);
    });
  });

  // ========== Persistence Tests ==========

  describe('Persistence', () => {
    it('should persist data across close/reopen', async () => {
      // Save some data
      const state: AgentState = {
        id: 'persist-state',
        sessionId: 'persist-session',
        agentName: 'persist-agent',
        status: 'completed',
        step: 10,
        maxSteps: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await storage.saveAgentState(state);

      const checkpoint: Checkpoint = {
        id: 'persist-cp',
        sessionId: 'persist-session',
        stepIndex: 5,
        messages: [{ role: 'user', content: 'persist test' }],
        toolCalls: [],
        state: { status: 'running', step: 5, maxSteps: 10 },
        createdAt: Date.now(),
      };
      await storage.saveCheckpoint(checkpoint);

      // Close and reopen
      await storage.close();
      storage = new SQLiteMemoryStorage(dbPath);
      await storage.initialize();

      // Verify data persisted
      const retrievedState = await storage.getAgentState('persist-session', 'persist-agent');
      expect(retrievedState).not.toBeNull();
      expect(retrievedState!.status).toBe('completed');

      const retrievedCp = await storage.getCheckpoint('persist-cp');
      expect(retrievedCp).not.toBeNull();
      expect(retrievedCp!.stepIndex).toBe(5);
    });
  });

  // ========== Cascade Delete Tests ==========

  describe('Cascade Delete', () => {
    describe('deleteThread cascade', () => {
      it('should delete agent_state when thread is deleted', async () => {
        // Setup: create thread and agent_state
        await storage.saveThread({
          id: 'thread-cascade-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await storage.saveAgentState({
          id: 'state-cascade-1',
          sessionId: 'thread-cascade-1',
          agentName: 'test-agent',
          status: 'running',
          step: 1,
          maxSteps: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Verify setup
        const stateBefore = await storage.getAgentState('thread-cascade-1', 'test-agent');
        expect(stateBefore).not.toBeNull();

        // Act: delete thread
        await storage.deleteThread('thread-cascade-1');

        // Assert: agent_state should be deleted
        const state = await storage.getAgentState('thread-cascade-1', 'test-agent');
        expect(state).toBeNull();
      });

      it('should delete checkpoints when thread is deleted', async () => {
        // Setup: create thread and checkpoint
        await storage.saveThread({
          id: 'thread-cascade-2',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await storage.saveCheckpoint({
          id: 'checkpoint-cascade-1',
          sessionId: 'thread-cascade-2',
          stepIndex: 1,
          messages: [],
          toolCalls: [],
          state: { status: 'running', step: 1, maxSteps: 10 },
          createdAt: Date.now(),
        });

        // Verify setup
        const cpBefore = await storage.getCheckpoint('checkpoint-cascade-1');
        expect(cpBefore).not.toBeNull();

        // Act: delete thread
        await storage.deleteThread('thread-cascade-2');

        // Assert: checkpoint should be deleted
        const checkpoint = await storage.getCheckpoint('checkpoint-cascade-1');
        expect(checkpoint).toBeNull();
      });

      it('should delete all related data when thread is deleted', async () => {
        // Setup: create thread with all related data
        const threadId = 'thread-full-cascade';
        await storage.saveThread({
          id: threadId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Add messages
        await storage.addMessage(threadId, { role: 'user', content: 'test' });

        // Add working memory
        await storage.saveWorkingMemory(threadId, {
          content: 'working memory',
          updatedAt: new Date(),
        });

        // Add agent_state
        await storage.saveAgentState({
          id: 'state-full',
          sessionId: threadId,
          agentName: 'agent-1',
          status: 'running',
          step: 1,
          maxSteps: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Add checkpoint
        await storage.saveCheckpoint({
          id: 'checkpoint-full',
          sessionId: threadId,
          stepIndex: 1,
          messages: [],
          toolCalls: [],
          state: { status: 'running', step: 1, maxSteps: 10 },
          createdAt: Date.now(),
        });

        // Act: delete thread
        await storage.deleteThread(threadId);

        // Assert: all related data should be deleted
        const thread = await storage.getThread(threadId);
        expect(thread).toBeNull();

        const messages = await storage.getMessages(threadId);
        expect(messages).toHaveLength(0);

        const wm = await storage.getWorkingMemory(threadId);
        expect(wm).toBeNull();

        const states = await storage.listAgentStates(threadId);
        expect(states).toHaveLength(0);

        const checkpoints = await storage.listCheckpoints(threadId);
        expect(checkpoints).toHaveLength(0);
      });

      it('should not affect other threads data', async () => {
        // Setup: create two threads with data
        await storage.saveThread({
          id: 'thread-keep',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await storage.saveThread({
          id: 'thread-delete',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await storage.saveAgentState({
          id: 'state-keep',
          sessionId: 'thread-keep',
          agentName: 'agent-keep',
          status: 'running',
          step: 1,
          maxSteps: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await storage.saveAgentState({
          id: 'state-delete',
          sessionId: 'thread-delete',
          agentName: 'agent-delete',
          status: 'running',
          step: 1,
          maxSteps: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Act: delete one thread
        await storage.deleteThread('thread-delete');

        // Assert: other thread's data should remain
        const keepState = await storage.getAgentState('thread-keep', 'agent-keep');
        expect(keepState).not.toBeNull();
        expect(keepState!.id).toBe('state-keep');

        const deleteState = await storage.getAgentState('thread-delete', 'agent-delete');
        expect(deleteState).toBeNull();
      });

      it('should handle deleting non-existent thread gracefully', async () => {
        // Act: delete non-existent thread (should not throw)
        await expect(storage.deleteThread('non-existent-thread')).resolves.toBeUndefined();
      });
    });
  });

  // ========== Existing functionality regression ==========

  describe('Existing MemoryStorage regression', () => {
    it('should still handle Thread/Message operations', async () => {
      const thread = await storage.saveThread({
        id: 'thread-1',
        title: 'Test Thread',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(thread.id).toBe('thread-1');

      await storage.addMessage('thread-1', { role: 'user', content: 'Hello' });
      const messages = await storage.getMessages('thread-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('should still handle WorkingMemory operations', async () => {
      await storage.saveThread({
        id: 'thread-2',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.saveWorkingMemory('thread-2', {
        content: 'Working memory content',
        updatedAt: new Date(),
      });

      const wm = await storage.getWorkingMemory('thread-2');
      expect(wm).not.toBeNull();
      expect(wm!.content).toBe('Working memory content');
    });
  });
});
