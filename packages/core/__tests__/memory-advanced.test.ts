import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySystem } from '../src/memory/memory-system.js';
import { InMemoryStore } from '../src/memory/storage/in-memory.js';
import type { MemoryStorage, WorkingMemory } from '../src/memory/types.js';

describe('MemorySystem — Advanced Operations', () => {
  let storage: MemoryStorage;
  let system: MemorySystem;

  const defaultWorkingMemory: WorkingMemory = {
    userProfile: { name: 'Test', preferences: {}, goals: [], constraints: [] },
    taskState: { currentGoal: 'test', progress: 0, blockers: [], nextSteps: [] },
    injection: { template: '', scope: 'thread' },
  };

  beforeEach(async () => {
    storage = new InMemoryStore();
    system = new MemorySystem({ storage });
    await storage.setWorkingMemory('session-1', defaultWorkingMemory);
  });

  // ── consolidate() ────────────────────────────────────

  describe('consolidate()', () => {
    it('returns zero results when no duplicates exist', async () => {
      await system.remember('unique fact one', { type: 'fact', scope: '/test' });
      await system.remember('unique fact two', { type: 'fact', scope: '/test' });

      const result = await system.consolidate({ scope: '/test' });
      expect(result.deduped).toBe(0);
      expect(result.merged).toBe(0);
    });

    it('deduplicates near-identical facts', async () => {
      await system.remember('AgentForge is a TypeScript agent framework', {
        type: 'fact', scope: '/test',
      });
      await system.remember('AgentForge is a TypeScript agent framework for building agents', {
        type: 'fact', scope: '/test',
      });

      const result = await system.consolidate({ scope: '/test', dedupThreshold: 0.5 });
      expect(result.deduped + result.merged).toBeGreaterThanOrEqual(1);
    });

    it('keeps dissimilar facts when threshold is high', async () => {
      await system.remember('pipeline architecture pattern', {
        type: 'fact', scope: '/test',
      });
      await system.remember('weather forecast for tomorrow', {
        type: 'fact', scope: '/test',
      });

      const result = await system.consolidate({ scope: '/test', dedupThreshold: 0.95 });
      expect(result.deduped + result.merged).toBe(0);
    });

    it('respects scope filter', async () => {
      await system.remember('TypeScript framework', { type: 'fact', scope: '/alpha' });
      await system.remember('TypeScript framework v2', { type: 'fact', scope: '/alpha' });
      await system.remember('Python script', { type: 'fact', scope: '/beta' });

      const result = await system.consolidate({ scope: '/alpha', dedupThreshold: 0.5 });
      const betaFacts = await storage.getFacts('/beta');
      expect(betaFacts).toHaveLength(1);
      expect(result.deduped + result.merged).toBeGreaterThanOrEqual(0);
    });

    it('merge strategy combines facts into fewer entries', async () => {
      await system.remember('the build tool is esbuild', {
        type: 'fact', scope: '/test', importance: 0.6,
      });
      await system.remember('esbuild is used as the build tool for bundling', {
        type: 'fact', scope: '/test', importance: 0.8,
      });

      const result = await system.consolidate({
        scope: '/test',
        dedupThreshold: 0.6,
        strategy: 'merge',
      });
      const facts = await storage.getFacts('/test');
      expect(facts.length).toBeLessThan(2);
      expect(result.merged).toBeGreaterThanOrEqual(1);
    });
  });

  // ── computeRetention (Ebbinghaus) ────────────────────

  describe('computeRetention()', () => {
    it('returns ~1 for a fact just accessed', () => {
      const retention = system.computeRetention(new Date().toISOString(), 1);
      expect(retention).toBeCloseTo(1, 2);
    });

    it('returns near 0 for ancient fact with few reviews', () => {
      const retention = system.computeRetention('2020-01-01T00:00:00Z', 1);
      expect(retention).toBeLessThan(0.1);
    });

    it('higher access count slows forgetting', () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const retention1 = system.computeRetention(weekAgo, 1);
      const retention5 = system.computeRetention(weekAgo, 5);
      expect(retention5).toBeGreaterThan(retention1);
    });

    it('returns value between 0 and 1', () => {
      const r = system.computeRetention(new Date().toISOString(), 3);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    });
  });

  // ── forgetStale() ────────────────────────────────────

  describe('forgetStale()', () => {
    it('removes facts with low retention', async () => {
      await system.remember('fresh fact', { type: 'fact', scope: '/test' });
      await storage.upsertFact('/test', {
        id: 'old-fact',
        content: 'very old outdated information',
        scope: '/test',
        categories: [],
        importance: 0.5,
        createdAt: '2020-01-01T00:00:00Z',
        lastAccessed: '2020-01-01T00:00:00Z',
        accessCount: 1,
      });

      const count = await system.forgetStale({ scope: '/test', retentionThreshold: 0.1 });
      expect(count).toBeGreaterThanOrEqual(1);

      const facts = await storage.getFacts('/test');
      expect(facts.every((f) => f.id !== 'old-fact')).toBe(true);
    });

    it('keeps facts with retention above threshold', async () => {
      await system.remember('important fresh fact', {
        type: 'fact', scope: '/test', importance: 0.9,
      });

      const before = (await storage.getFacts('/test')).length;
      const count = await system.forgetStale({ scope: '/test', retentionThreshold: 0.1 });
      const after = (await storage.getFacts('/test')).length;
      expect(after).toBe(before - count);
    });

    it('returns 0 when no facts are stale', async () => {
      await system.remember('fresh fact', { type: 'fact', scope: '/test' });
      const count = await system.forgetStale({ scope: '/test', retentionThreshold: 0.01 });
      expect(count).toBe(0);
    });
  });

  // ── reflect() ────────────────────────────────────────

  describe('reflect()', () => {
    beforeEach(async () => {
      await system.remember('User asked about memory system architecture', {
        type: 'event', scope: 'session-1',
      });
      await system.remember('Agent recommended three-layer design', {
        type: 'event', scope: 'session-1', importance: 0.8,
      });
      await system.remember('Decision: use SQLite for storage', {
        type: 'event', scope: 'session-1', importance: 0.9,
      });
      await system.remember('User approved the architecture plan', {
        type: 'event', scope: 'session-1', importance: 0.7,
      });
    });

    it('compresses events into facts', async () => {
      const result = await system.reflect({ scope: 'session-1' });
      expect(result.newFacts).toBeGreaterThan(0);
      const facts = await storage.getFacts('/session-1');
      expect(facts.length).toBe(result.newFacts);
    });

    it('generates facts summarizing event content', async () => {
      await system.reflect({ scope: 'session-1' });
      const facts = await storage.getFacts('/session-1');
      expect(facts.length).toBeGreaterThan(0);
      const allContent = facts.map((f) => f.content).join(' ');
      expect(allContent.toLowerCase()).toMatch(/memory|architecture|design|sqlite|storage/i);
    });

    it('respects time range', async () => {
      await storage.appendEvent('session-1', {
        id: 'evt-old', timestamp: '2020-01-01T00:00:00Z',
        type: 'user_input', content: 'old irrelevant message', importance: 0.1,
      });

      const result = await system.reflect({
        scope: 'session-1',
        timeRange: { start: '2025-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z' },
      });
      expect(result.newFacts).toBeGreaterThan(0);
    });

    it('returns zero new facts when no events exist', async () => {
      const result = await system.reflect({ scope: 'empty-scope' });
      expect(result.newFacts).toBe(0);
    });
  });
});
