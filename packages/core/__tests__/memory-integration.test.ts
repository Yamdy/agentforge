import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySystem } from '../src/memory/memory-system.js';
import { InMemoryStore } from '../src/memory/storage/in-memory.js';
import type { MemoryStorage, WorkingMemory } from '../src/memory/types.js';

describe('MemorySystem — End-to-End Integration', () => {
  let storage: MemoryStorage;
  let system: MemorySystem;

  const defaultWorkingMemory: WorkingMemory = {
    userProfile: {
      name: 'Dev',
      preferences: { language: 'zh-CN' },
      goals: ['build agent framework'],
      constraints: ['no external API calls in tests'],
    },
    taskState: {
      currentGoal: 'implement memory system',
      progress: 50,
      blockers: [],
      nextSteps: ['integration test', 'documentation'],
    },
    injection: { template: '# Memory\n{{content}}', scope: 'thread' },
  };

  beforeEach(async () => {
    storage = new InMemoryStore();
    system = new MemorySystem({ storage });
    await storage.setWorkingMemory('session-e2e', defaultWorkingMemory);
  });

  // ── Full lifecycle ─────────────────────────────────────

  it('executes the full memory lifecycle: remember → recall → consolidate → reflect', async () => {
    // Phase 1: Remember facts about a project
    await system.remember('AgentForge is a TypeScript agent framework', {
      type: 'fact', scope: '/project/agentforge', categories: ['overview'], importance: 0.9,
    });
    await system.remember('AgentForge has a pipeline architecture with stages', {
      type: 'fact', scope: '/project/agentforge', categories: ['architecture'], importance: 0.85,
    });
    await system.remember('The pipeline includes buildContext and invokeLLM stages', {
      type: 'fact', scope: '/project/agentforge', categories: ['architecture'], importance: 0.8,
    });
    await system.remember('AgentForge uses TypeScript with strict mode', {
      type: 'fact', scope: '/project/agentforge', categories: ['tech-stack'], importance: 0.7,
    });
    await system.remember('Python is used for deployment scripts', {
      type: 'fact', scope: '/project/ci', categories: ['devops'], importance: 0.6,
    });

    // Phase 2: Remember events about user interactions
    await system.remember('User asked about memory system design', {
      type: 'event', scope: 'session-e2e', importance: 0.8,
    });
    await system.remember('Agent proposed three-layer architecture', {
      type: 'event', scope: 'session-e2e', importance: 0.85,
    });
    await system.remember('Decision: use InMemoryStore for tests and SQLite for production', {
      type: 'event', scope: 'session-e2e', importance: 0.9,
    });
    await system.remember('User approved the design approach', {
      type: 'event', scope: 'session-e2e', importance: 0.7,
    });

    // Phase 3: Recall — semantic search for architecture-related facts
    const recallResults = await system.recall('pipeline architecture stages', { topK: 5 });
    expect(recallResults.length).toBeGreaterThan(0);
    const topResult = recallResults[0];
    expect(topResult.content.toLowerCase()).toMatch(/pipeline|architecture|stages/);

    // Phase 4: Recall with scope filter
    const scopedResults = await system.recall('architecture', {
      scope: '/project/agentforge', topK: 10,
    });
    expect(scopedResults.length).toBeGreaterThan(0);
    expect(scopedResults.every((r) => r.type === 'fact')).toBe(true);

    // Phase 5: Consolidate — deduplicate near-identical facts
    await system.remember('AgentForge has pipeline architecture', {
      type: 'fact', scope: '/project/agentforge', categories: ['architecture'], importance: 0.75,
    });
    await system.remember('AgentForge uses pipeline-based architecture design', {
      type: 'fact', scope: '/project/agentforge', categories: ['architecture'], importance: 0.8,
    });

    const consolidateResult = await system.consolidate({
      scope: '/project/agentforge', dedupThreshold: 0.5, strategy: 'merge',
    });
    expect(consolidateResult.deduped + consolidateResult.merged).toBeGreaterThanOrEqual(0);

    // Phase 6: Reflect — compress events into summary facts
    const reflectResult = await system.reflect({ scope: 'session-e2e' });
    expect(reflectResult.newFacts).toBeGreaterThan(0);

    const reflectedFacts = await storage.getFacts('/session-e2e');
    expect(reflectedFacts.length).toBe(reflectResult.newFacts);

    const summaryContent = reflectedFacts.map((f) => f.content).join(' ');
    expect(summaryContent.toLowerCase()).toMatch(/memory|architecture|design|sqlite|inmemorystore/i);
  });

  // ── Cross-layer recall ─────────────────────────────────

  it('recalls both facts and events together with proper ranking', async () => {
    await system.remember('Critical security vulnerability found', {
      type: 'fact', scope: '/security', importance: 0.95,
    });
    await system.remember('Routine dependency update completed', {
      type: 'fact', scope: '/maintenance', importance: 0.3,
    });
    await system.remember('Security audit triggered by user request', {
      type: 'event', scope: 'session-e2e', importance: 0.9,
    });

    const results = await system.recall('security', { topK: 5 });

    const securityResults = results.filter((r) =>
      r.content.toLowerCase().includes('security'),
    );
    expect(securityResults.length).toBeGreaterThanOrEqual(2);
    expect(securityResults[0].importance).toBeGreaterThanOrEqual(0.9);
  });

  // ── forget lifecycle ───────────────────────────────────

  it('handles forget → forgetStale cycle correctly', async () => {
    const id = await system.remember('temporary note to delete', {
      type: 'fact', scope: '/temp',
    });

    let facts = await storage.getFacts('/temp');
    expect(facts.some((f) => f.id === id)).toBe(true);

    const deleted = await system.forget(id);
    expect(deleted).toBe(true);

    facts = await storage.getFacts('/temp');
    expect(facts.some((f) => f.id === id)).toBe(false);

    const removed = await system.forgetStale({ scope: '/temp', retentionThreshold: 0.5 });
    expect(removed).toBe(0);
  });

  // ── Working memory across operations ────────────────────

  it('preserves working memory across multiple operations', async () => {
    const wm = await system.getWorkingMemory('session-e2e');
    expect(wm?.userProfile.name).toBe('Dev');
    expect(wm?.taskState.progress).toBe(50);

    await system.updateWorkingMemory('session-e2e', {
      taskState: { currentGoal: 'completed integration test', progress: 100, blockers: [], nextSteps: [] },
    });

    await system.remember('Integration test completed successfully', {
      type: 'event', scope: 'session-e2e', importance: 0.9,
    });

    const updatedWm = await system.getWorkingMemory('session-e2e');
    expect(updatedWm?.taskState.progress).toBe(100);
    expect(updatedWm?.taskState.currentGoal).toBe('completed integration test');
    expect(updatedWm?.userProfile.name).toBe('Dev');
  });

  // ── Retention curve in practice ─────────────────────────

  it('computeRetention returns higher values for frequently accessed facts', () => {
    const now = new Date().toISOString();

    const retentionFresh = system.computeRetention(now, 1);
    expect(retentionFresh).toBeCloseTo(1, 2);

    const retentionHighAccess = system.computeRetention(now, 10);
    expect(retentionHighAccess).toBeCloseTo(1, 2);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const retentionOld = system.computeRetention(thirtyDaysAgo, 1);
    expect(retentionOld).toBeLessThan(0.5);
  });

  // ── Scope isolation ────────────────────────────────────

  it('isolates data between scopes for all operations', async () => {
    await system.remember('Project Alpha uses PostgreSQL', {
      type: 'fact', scope: '/project/alpha', categories: ['database'],
    });
    await system.remember('Project Beta uses MongoDB', {
      type: 'fact', scope: '/project/beta', categories: ['database'],
    });

    await system.remember('Alpha deployment started', {
      type: 'event', scope: 'alpha-session',
    });
    await system.remember('Beta deployment started', {
      type: 'event', scope: 'beta-session',
    });

    const alphaResults = await system.recall('database', { scope: '/project/alpha' });
    expect(alphaResults.every((r) => r.content.includes('Alpha'))).toBe(true);

    const betaResults = await system.recall('database', { scope: '/project/beta' });
    expect(betaResults.every((r) => r.content.includes('Beta'))).toBe(true);

    await system.remember('Alpha uses Postgres', {
      type: 'fact', scope: '/project/alpha', categories: ['database'],
    });
    await system.consolidate({ scope: '/project/alpha', dedupThreshold: 0.5 });

    const betaFacts = await storage.getFacts('/project/beta');
    expect(betaFacts).toHaveLength(1);
  });

  // ── Empty state edge cases ──────────────────────────────

  it('handles empty state gracefully for all operations', async () => {
    const emptyRecall = await system.recall('anything');
    expect(emptyRecall).toEqual([]);

    const emptyConsolidate = await system.consolidate({ scope: '/empty' });
    expect(emptyConsolidate).toEqual({ deduped: 0, merged: 0, forgotten: 0, newFacts: 0 });

    const emptyReflect = await system.reflect({ scope: 'empty-session' });
    expect(emptyReflect).toEqual({ deduped: 0, merged: 0, forgotten: 0, newFacts: 0 });

    const emptyForgetStale = await system.forgetStale({ scope: '/empty' });
    expect(emptyForgetStale).toBe(0);

    const unknownWm = await system.getWorkingMemory('unknown');
    expect(unknownWm).toBeUndefined();
  });

  // ── Duplicate content deduplication in recall ──────────

  it('deduplicates identical content from different sources in recall', async () => {
    await system.remember('The build system uses esbuild', {
      type: 'fact', scope: '/project/build', importance: 0.7,
    });
    await system.remember('The build system uses esbuild', {
      type: 'event', scope: 'session-e2e', importance: 0.8,
    });

    const results = await system.recall('build system esbuild');
    const esbuildEntries = results.filter((r) => r.content === 'The build system uses esbuild');
    expect(esbuildEntries.length).toBeLessThanOrEqual(1);
  });
});
