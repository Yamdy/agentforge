import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MemoryStorage, WorkingMemory, MemoryEvent, Fact } from '../src/memory/types.js';

let SqliteStore: new (dbPath: string) => MemoryStorage;
let hasSQLite = false;

beforeAll(async () => {
  try {
    const path = '../src/memory/storage/sqlite.js';
    const mod = await import(path);
    SqliteStore = mod.SqliteStore;
    await import('better-sqlite3');
    hasSQLite = true;
  } catch {
    hasSQLite = false;
  }
});

const describeIf = hasSQLite ? describe : describe.skip;

describeIf('SqliteStore', () => {
  let store: MemoryStorage;

  const defaultWorkingMemory: WorkingMemory = {
    userProfile: {
      name: 'Alice',
      preferences: { language: 'zh-CN', theme: 'dark' },
      goals: ['build memory system'],
      constraints: ['time'],
    },
    taskState: {
      currentGoal: 'implement sqlite store',
      progress: 0,
      blockers: [],
      nextSteps: ['write tests', 'implement code'],
    },
    injection: {
      template: '# Working Memory\n{{content}}',
      scope: 'thread',
    },
  };

  beforeAll(() => {
    store = new SqliteStore(':memory:');
  });

  afterAll(() => {
    // cleanup handled by :memory: disposal
  });

  // ── Working Memory ──────────────────────────────────

  describe('Working Memory', () => {
    it('returns undefined for unset scope', async () => {
      const wm = await store.getWorkingMemory('session-1');
      expect(wm).toBeUndefined();
    });

    it('stores and retrieves working memory', async () => {
      await store.setWorkingMemory('session-1', defaultWorkingMemory);
      const wm = await store.getWorkingMemory('session-1');
      expect(wm).toEqual(defaultWorkingMemory);
    });

    it('isolates working memory by scope', async () => {
      await store.setWorkingMemory('session-1', defaultWorkingMemory);
      const modified = {
        ...defaultWorkingMemory,
        userProfile: { ...defaultWorkingMemory.userProfile, name: 'Bob' },
      };
      await store.setWorkingMemory('session-2', modified);

      const wm1 = await store.getWorkingMemory('session-1');
      const wm2 = await store.getWorkingMemory('session-2');
      expect(wm1?.userProfile.name).toBe('Alice');
      expect(wm2?.userProfile.name).toBe('Bob');
    });

    it('overwrites existing working memory', async () => {
      await store.setWorkingMemory('session-1', defaultWorkingMemory);
      const updated = {
        ...defaultWorkingMemory,
        taskState: { ...defaultWorkingMemory.taskState, progress: 50 },
      };
      await store.setWorkingMemory('session-1', updated);
      const wm = await store.getWorkingMemory('session-1');
      expect(wm?.taskState.progress).toBe(50);
    });
  });

  // ── Episodic Memory ─────────────────────────────────

  describe('Episodic Memory', () => {
    const sampleEvent: MemoryEvent = {
      id: 'evt-1',
      timestamp: '2026-05-21T10:00:00Z',
      type: 'user_input',
      content: 'Build a memory system for AgentForge',
      importance: 0.8,
    };

    it('returns empty array for scope with no events', async () => {
      const events = await store.getEvents('session-1');
      expect(events).toEqual([]);
    });

    it('appends and retrieves events', async () => {
      await store.appendEvent('session-1', sampleEvent);
      const events = await store.getEvents('session-1');
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-1');
    });

    it('filters events by time range', async () => {
      await store.appendEvent('session-1', sampleEvent);
      await store.appendEvent('session-1', {
        ...sampleEvent,
        id: 'evt-2',
        timestamp: '2026-05-22T10:00:00Z',
      });

      const events = await store.getEvents('session-1', {
        timeRange: { start: '2026-05-21T00:00:00Z', end: '2026-05-21T23:59:59Z' },
      });
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-1');
    });

    it('filters events by min importance', async () => {
      await store.appendEvent('session-1', sampleEvent);
      await store.appendEvent('session-1', {
        ...sampleEvent,
        id: 'evt-2',
        importance: 0.3,
      });

      const events = await store.getEvents('session-1', { minImportance: 0.5 });
      expect(events).toHaveLength(1);
    });

    it('filters events by type', async () => {
      await store.appendEvent('session-1', sampleEvent);
      await store.appendEvent('session-1', {
        ...sampleEvent,
        id: 'evt-2',
        type: 'decision',
      });

      const events = await store.getEvents('session-1', { types: ['decision'] });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('decision');
    });

    it('limits returned events', async () => {
      for (let i = 0; i < 10; i++) {
        await store.appendEvent('session-1', { ...sampleEvent, id: `evt-${i}` });
      }
      const events = await store.getEvents('session-1', { limit: 3 });
      expect(events).toHaveLength(3);
    });

    it('stores and retrieves events with metadata', async () => {
      await store.appendEvent('session-1', {
        ...sampleEvent,
        id: 'evt-meta',
        metadata: { tool: 'search', duration: 150 },
      });
      const events = await store.getEvents('session-1');
      expect(events[0].metadata).toEqual({ tool: 'search', duration: 150 });
    });
  });

  // ── Semantic Memory ─────────────────────────────────

  describe('Semantic Memory', () => {
    const sampleFact: Fact = {
      id: 'fact-1',
      content: 'AgentForge uses a pipeline processor model',
      scope: '/project/agentforge',
      categories: ['architecture', 'agent'],
      importance: 0.9,
      createdAt: '2026-05-21T10:00:00Z',
      lastAccessed: '2026-05-21T10:00:00Z',
      accessCount: 1,
    };

    it('returns empty array when no facts match', async () => {
      const facts = await store.searchFacts('nothing');
      expect(facts).toEqual([]);
    });

    it('upserts and searches facts by content', async () => {
      await store.upsertFact('/project/agentforge', sampleFact);
      const facts = await store.searchFacts('pipeline processor');
      expect(facts).toHaveLength(1);
      expect(facts[0].id).toBe('fact-1');
    });

    it('filters facts by scope', async () => {
      await store.upsertFact('/project/alpha', sampleFact);
      await store.upsertFact('/project/beta', {
        ...sampleFact,
        id: 'fact-2',
        content: 'Beta uses React',
      });

      const alphaFacts = await store.getFacts('/project/alpha');
      expect(alphaFacts).toHaveLength(1);

      const betaFacts = await store.getFacts('/project/beta');
      expect(betaFacts).toHaveLength(1);
    });

    it('updates existing fact on upsert', async () => {
      await store.upsertFact('/project/agentforge', sampleFact);
      await store.upsertFact('/project/agentforge', {
        ...sampleFact,
        content: 'AgentForge uses a pipeline model (updated)',
        accessCount: 5,
      });

      const facts = await store.searchFacts('pipeline model');
      expect(facts).toHaveLength(1);
      expect(facts[0].content).toContain('updated');
      expect(facts[0].accessCount).toBe(5);
    });

    it('deletes a fact by id', async () => {
      await store.upsertFact('/project/agentforge', sampleFact);
      await store.deleteFact('/project/agentforge', 'fact-1');
      const facts = await store.getFacts('/project/agentforge');
      expect(facts).toHaveLength(0);
    });

    it('case-insensitive search', async () => {
      await store.upsertFact('/project/agentforge', sampleFact);
      const facts = await store.searchFacts('PIPELINE PROCESSOR');
      expect(facts).toHaveLength(1);
    });

    it('respects topK limit on getFacts', async () => {
      for (let i = 0; i < 5; i++) {
        await store.upsertFact('/project/agentforge', {
          ...sampleFact,
          id: `fact-${i}`,
          content: `Fact number ${i}`,
        });
      }
      const facts = await store.getFacts('/project/agentforge', { topK: 2 });
      expect(facts).toHaveLength(2);
    });
  });

  // ── Entity & Relation ───────────────────────────────

  describe('Entities & Relations', () => {
    it('upserts and retrieves an entity', async () => {
      await store.upsertEntity({ id: 'e-1', name: 'MemorySystem', type: 'class', attributes: {} });
      const entity = await store.getEntity('e-1');
      expect(entity?.name).toBe('MemorySystem');
    });

    it('returns undefined for unknown entity', async () => {
      const entity = await store.getEntity('no-such-id');
      expect(entity).toBeUndefined();
    });

    it('upserts and retrieves relations', async () => {
      await store.upsertRelation({ from: 'e-1', to: 'e-2', type: 'depends_on', weight: 1.0 });
      const relations = await store.getRelations('e-1');
      expect(relations).toHaveLength(1);
      expect(relations[0].type).toBe('depends_on');
    });

    it('filters relations by source and target', async () => {
      await store.upsertRelation({ from: 'e-1', to: 'e-2', type: 'depends_on', weight: 1.0 });
      await store.upsertRelation({ from: 'e-1', to: 'e-3', type: 'uses', weight: 0.5 });

      const fromE1 = await store.getRelations('e-1');
      expect(fromE1).toHaveLength(2);

      const toE2 = await store.getRelations(undefined, 'e-2');
      expect(toE2).toHaveLength(1);
    });

    it('updates entity attributes on upsert', async () => {
      await store.upsertEntity({ id: 'e-1', name: 'MemorySystem', type: 'class', attributes: { version: '1.0' } });
      await store.upsertEntity({ id: 'e-1', name: 'MemorySystem', type: 'class', attributes: { version: '2.0', status: 'active' } });
      const entity = await store.getEntity('e-1');
      expect(entity?.attributes).toEqual({ version: '2.0', status: 'active' });
    });
  });
});
