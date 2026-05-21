import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySystem } from '../src/memory/memory-system.js';
import { InMemoryStore } from '../src/memory/storage/in-memory.js';
import type { MemoryStorage, WorkingMemory } from '../src/memory/types.js';

describe('MemorySystem', () => {
  let storage: MemoryStorage;
  let system: MemorySystem;

  const defaultWorkingMemory: WorkingMemory = {
    userProfile: {
      name: 'Alice',
      preferences: { language: 'zh-CN' },
      goals: ['build memory system'],
      constraints: [],
    },
    taskState: {
      currentGoal: 'implement core',
      progress: 0,
      blockers: [],
      nextSteps: ['define types', 'write tests'],
    },
    injection: {
      template: '# Working Memory\n{{content}}',
      scope: 'thread',
    },
  };

  beforeEach(async () => {
    storage = new InMemoryStore();
    system = new MemorySystem({ storage });
    await storage.setWorkingMemory('session-1', defaultWorkingMemory);
  });

  // ── remember() ──────────────────────────────────────

  describe('remember()', () => {
    it('stores a fact with explicit metadata', async () => {
      await system.remember('AgentForge uses TypeScript', {
        scope: '/project/agentforge',
        categories: ['tech-stack'],
        importance: 0.9,
        type: 'fact',
      });

      const facts = await storage.getFacts('/project/agentforge');
      expect(facts).toHaveLength(1);
      expect(facts[0].content).toBe('AgentForge uses TypeScript');
      expect(facts[0].categories).toContain('tech-stack');
      expect(facts[0].importance).toBe(0.9);
    });

    it('stores an event', async () => {
      await system.remember('User asked about TDD', {
        type: 'event',
        scope: 'session-1',
      });

      const events = await storage.getEvents('session-1');
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe('User asked about TDD');
      expect(events[0].type).toBe('user_input');
    });

    it('generates a unique id for each memory', async () => {
      const id1 = await system.remember('fact one', { type: 'fact', scope: '/test' });
      const id2 = await system.remember('fact two', { type: 'fact', scope: '/test' });
      expect(id1).not.toBe(id2);
    });

    it('stores multiple events for same scope', async () => {
      await system.remember('event 1', { type: 'event', scope: 'session-1' });
      await system.remember('event 2', { type: 'event', scope: 'session-1' });
      await system.remember('event 3', { type: 'event', scope: 'session-1' });

      const events = await storage.getEvents('session-1');
      expect(events).toHaveLength(3);
    });
  });

  // ── recall() ────────────────────────────────────────

  describe('recall()', () => {
    beforeEach(async () => {
      await system.remember('AgentForge has a pipeline architecture', {
        type: 'fact',
        scope: '/project/agentforge',
        categories: ['architecture'],
        importance: 0.9,
      });
      await system.remember('The pipeline has 10 stages', {
        type: 'fact',
        scope: '/project/agentforge',
        categories: ['architecture'],
        importance: 0.7,
      });
      await system.remember('React is used for the UI', {
        type: 'fact',
        scope: '/project/agentforge',
        categories: ['frontend'],
        importance: 0.5,
      });
    });

    it('recalls facts by text query', async () => {
      const results = await system.recall('pipeline architecture');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].type).toBe('fact');
    });

    it('respects topK limit', async () => {
      const results = await system.recall('architecture', { topK: 1 });
      expect(results).toHaveLength(1);
    });

    it('filters by scope', async () => {
      await system.remember('Python is used for CI', {
        type: 'fact',
        scope: '/project/ci',
        categories: ['devops'],
        importance: 0.6,
      });

      const results = await system.recall('architecture', { scope: '/project/agentforge' });
      expect(results.every((r) => r.content.includes('AgentForge') || r.content.includes('pipeline') || r.content.includes('React'))).toBe(true);
    });

    it('returns empty array when nothing matches', async () => {
      const results = await system.recall('completely unrelated topic xyz');
      expect(results).toHaveLength(0);
    });

    it('includes events in recall results', async () => {
      await system.remember('System started successfully', {
        type: 'event',
        scope: 'session-1',
      });

      const results = await system.recall('started');
      const hasEvent = results.some((r) => r.type === 'event');
      expect(hasEvent).toBe(true);
    });

    it('ranks higher importance entries first', async () => {
      await system.remember('Low importance architecture note', {
        type: 'fact', scope: '/project/agentforge', importance: 0.3,
      });
      await system.remember('Critical architecture decision', {
        type: 'fact', scope: '/project/agentforge', importance: 0.95,
      });

      const results = await system.recall('architecture');
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Higher importance should rank higher
      expect(results[0].importance).toBeGreaterThanOrEqual(results[1].importance);
    });

    it('scores recent events higher than older ones', async () => {
      // Store an old event directly in storage
      await storage.appendEvent('session-1', {
        id: 'evt-old', timestamp: '2026-01-01T00:00:00Z',
        type: 'user_input', content: 'system startup', importance: 0.9,
      });
      // Store a recent event via system
      await system.remember('system startup completed', {
        type: 'event', scope: 'session-1', importance: 0.9,
      });

      const results = await system.recall('startup');
      const eventResults = results.filter((r) => r.type === 'event');
      if (eventResults.length >= 2) {
        // Recent event should rank higher due to recency score
        expect(eventResults[0].timestamp >= eventResults[1].timestamp).toBe(true);
      }
    });

    it('filters recall by time range', async () => {
      await storage.appendEvent('session-1', {
        id: 'evt-old', timestamp: '2026-01-01T00:00:00Z',
        type: 'user_input', content: 'old deployment process', importance: 0.8,
      });
      await storage.appendEvent('session-1', {
        id: 'evt-new', timestamp: '2026-06-01T00:00:00Z',
        type: 'user_input', content: 'recent deployment process', importance: 0.8,
      });

      const results = await system.recall('deployment', {
        timeRange: { start: '2026-05-01T00:00:00Z', end: '2026-07-01T00:00:00Z' },
      });
      expect(results.every((r) => !r.content.startsWith('old'))).toBe(true);
    });

    it('ranks facts by embedding similarity over pure importance', async () => {
      await system.remember('build bundling esbuild system for modules', {
        type: 'fact', scope: '/project/agentforge', importance: 0.5,
      });
      await system.remember('completely different topic about weather patterns', {
        type: 'fact', scope: '/project/agentforge', importance: 0.9,
      });

      const results = await system.recall('bundling build system');
      expect(results.length).toBeGreaterThan(0);
      // The build/bundling fact should outrank weather despite lower importance
      // because embedding similarity contributes more to the composite score
      const buildIndex = results.findIndex((r) => r.content.includes('bundling'));
      const weatherIndex = results.findIndex((r) => r.content.includes('weather'));
      if (buildIndex >= 0 && weatherIndex >= 0) {
        expect(buildIndex).toBeLessThan(weatherIndex);
      }
    });
  });

  // ── forget() ────────────────────────────────────────

  describe('forget()', () => {
    it('deletes a fact by id', async () => {
      const id = await system.remember('temporary fact', { type: 'fact', scope: '/test' });
      const deleted = await system.forget(id);
      expect(deleted).toBe(true);

      const facts = await storage.getFacts('/test');
      expect(facts).toHaveLength(0);
    });

    it('returns false for non-existent id', async () => {
      const deleted = await system.forget('no-such-id');
      expect(deleted).toBe(false);
    });
  });

  // ── getWorkingMemory() ──────────────────────────────

  describe('getWorkingMemory()', () => {
    it('returns the working memory for a scope', async () => {
      const wm = await system.getWorkingMemory('session-1');
      expect(wm?.userProfile.name).toBe('Alice');
      expect(wm?.userProfile.goals).toContain('build memory system');
    });

    it('returns undefined for unknown scope', async () => {
      const wm = await system.getWorkingMemory('unknown-scope');
      expect(wm).toBeUndefined();
    });
  });

  // ── updateWorkingMemory() ───────────────────────────

  describe('updateWorkingMemory()', () => {
    it('updates profile fields', async () => {
      await system.updateWorkingMemory('session-1', {
        userProfile: { name: 'Bob', preferences: {}, goals: [], constraints: [] },
      });

      const wm = await system.getWorkingMemory('session-1');
      expect(wm?.userProfile.name).toBe('Bob');
    });

    it('updates task state', async () => {
      await system.updateWorkingMemory('session-1', {
        taskState: { currentGoal: 'new goal', progress: 50, blockers: [], nextSteps: [] },
      });

      const wm = await system.getWorkingMemory('session-1');
      expect(wm?.taskState.currentGoal).toBe('new goal');
      expect(wm?.taskState.progress).toBe(50);
    });

    it('merges partial updates', async () => {
      await system.updateWorkingMemory('session-1', {
        userProfile: { name: 'Charlie', preferences: {}, goals: [], constraints: [] },
      });

      const wm = await system.getWorkingMemory('session-1');
      // task state should be preserved
      expect(wm?.taskState.currentGoal).toBe('implement core');
      expect(wm?.userProfile.name).toBe('Charlie');
    });
  });
});
