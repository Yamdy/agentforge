import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/memory/storage/in-memory.js';
import { EpisodicMemory } from '../src/memory/episodic-memory.js';
import type { MemoryStorage, MemoryEvent } from '../src/memory/types.js';

describe('EpisodicMemory', () => {
  let storage: MemoryStorage;
  let episodic: EpisodicMemory;

  beforeEach(() => {
    storage = new InMemoryStore();
    episodic = new EpisodicMemory(storage);
  });

  // ── addEvent() ──────────────────────────────────────

  describe('addEvent()', () => {
    it('stores an event and returns an id', async () => {
      const id = await episodic.addEvent('session-1', 'User asked about TDD');
      expect(id).toBeTruthy();
      expect(id).toMatch(/^evt-/);
    });

    it('stores event with explicit type', async () => {
      await episodic.addEvent('session-1', 'Tool called: search', {
        type: 'tool_call',
      });
      const events = await storage.getEvents('session-1');
      expect(events[0].type).toBe('tool_call');
      expect(events[0].content).toBe('Tool called: search');
    });

    it('stores event with custom importance', async () => {
      await episodic.addEvent('session-1', 'Important decision made', {
        importance: 0.95,
      });
      const events = await storage.getEvents('session-1');
      expect(events[0].importance).toBe(0.95);
    });

    it('stores event with metadata', async () => {
      await episodic.addEvent('session-1', 'Event with metadata', {
        metadata: { tool: 'search', duration: 150 },
      });
      const events = await storage.getEvents('session-1');
      expect(events[0].metadata).toEqual({ tool: 'search', duration: 150 });
    });

    it('defaults to user_input type with 0.5 importance', async () => {
      await episodic.addEvent('session-1', 'Default event');
      const events = await storage.getEvents('session-1');
      expect(events[0].type).toBe('user_input');
      expect(events[0].importance).toBe(0.5);
    });

    it('generates unique ids for each event', async () => {
      const id1 = await episodic.addEvent('session-1', 'Event one');
      const id2 = await episodic.addEvent('session-1', 'Event two');
      expect(id1).not.toBe(id2);
    });

    it('sets timestamp to ISO format', async () => {
      const before = new Date().toISOString();
      await episodic.addEvent('session-1', 'Timestamped event');
      const events = await storage.getEvents('session-1');
      expect(events[0].timestamp >= before).toBe(true);
    });
  });

  // ── query() ─────────────────────────────────────────

  describe('query()', () => {
    beforeEach(async () => {
      await episodic.addEvent('session-1', 'User: start project', { type: 'user_input', importance: 0.7 });
      await episodic.addEvent('session-1', 'Agent: analyze requirements', { type: 'agent_response', importance: 0.8 });
      await episodic.addEvent('session-1', 'Tool: search codebase', { type: 'tool_call', importance: 0.5 });
      await episodic.addEvent('session-1', 'Decision: use TypeScript', { type: 'decision', importance: 0.9 });
    });

    it('returns all events for a scope', async () => {
      const events = await episodic.query('session-1');
      expect(events).toHaveLength(4);
    });

    it('returns empty array for unknown scope', async () => {
      const events = await episodic.query('unknown-scope');
      expect(events).toEqual([]);
    });

    it('filters by time range', async () => {
      const now = new Date().toISOString();
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const events = await episodic.query('session-1', {
        timeRange: { start: yesterday, end: now },
      });
      expect(events).toHaveLength(4);
    });

    it('filters by event types', async () => {
      const events = await episodic.query('session-1', {
        types: ['decision', 'tool_call'],
      });
      expect(events).toHaveLength(2);
      const types = events.map((e: MemoryEvent) => e.type);
      expect(types).toContain('decision');
      expect(types).toContain('tool_call');
    });

    it('filters by min importance', async () => {
      const events = await episodic.query('session-1', { minImportance: 0.8 });
      expect(events).toHaveLength(2);
      expect(events.every((e: MemoryEvent) => e.importance >= 0.8)).toBe(true);
    });

    it('combines multiple filters', async () => {
      const events = await episodic.query('session-1', {
        types: ['decision', 'agent_response'],
        minImportance: 0.8,
      });
      expect(events).toHaveLength(2);
    });

    it('limits results', async () => {
      const events = await episodic.query('session-1', { limit: 2 });
      expect(events).toHaveLength(2);
    });

    it('returns all events when query is empty', async () => {
      const events = await episodic.query('session-1', {});
      expect(events).toHaveLength(4);
    });
  });

  // ── getTimeline() ───────────────────────────────────

  describe('getTimeline()', () => {
    it('returns events sorted by timestamp ascending', async () => {
      await episodic.addEvent('session-1', 'First event');
      await new Promise((r) => setTimeout(r, 5));
      await episodic.addEvent('session-1', 'Second event');
      await new Promise((r) => setTimeout(r, 5));
      await episodic.addEvent('session-1', 'Third event');

      const timeline = await episodic.getTimeline('session-1');
      expect(timeline).toHaveLength(3);
      expect(timeline[0].content).toBe('First event');
      expect(timeline[1].content).toBe('Second event');
      expect(timeline[2].content).toBe('Third event');
    });

    it('filters timeline by time range', async () => {
      await storage.appendEvent('session-1', {
        id: 'evt-early', timestamp: '2026-05-20T10:00:00Z', type: 'user_input',
        content: 'Event 1', importance: 0.5,
      });
      await storage.appendEvent('session-1', {
        id: 'evt-late', timestamp: '2026-05-22T10:00:00Z', type: 'user_input',
        content: 'Event 2', importance: 0.5,
      });

      const timeline = await episodic.getTimeline('session-1', {
        start: '2026-05-21T00:00:00Z',
        end: '2026-05-23T00:00:00Z',
      });
      expect(timeline).toHaveLength(1);
      expect(timeline[0].content).toBe('Event 2');
    });

    it('limits timeline entries', async () => {
      for (let i = 0; i < 10; i++) {
        await episodic.addEvent('session-1', `Event ${i}`);
      }
      const timeline = await episodic.getTimeline('session-1', { limit: 3 });
      expect(timeline).toHaveLength(3);
    });

    it('returns empty array for scope with no events', async () => {
      const timeline = await episodic.getTimeline('empty-scope');
      expect(timeline).toEqual([]);
    });
  });

  // ── getRecent() ─────────────────────────────────────

  describe('getRecent()', () => {
    it('returns most recent events first', async () => {
      await episodic.addEvent('session-1', 'Old event');
      await new Promise((r) => setTimeout(r, 5));
      await episodic.addEvent('session-1', 'New event');

      const recent = await episodic.getRecent('session-1', 2);
      expect(recent).toHaveLength(2);
      expect(recent[0].content).toBe('New event');
      expect(recent[1].content).toBe('Old event');
    });

    it('defaults to last 10 events', async () => {
      for (let i = 0; i < 20; i++) {
        await episodic.addEvent('session-1', `Event ${i}`);
      }
      const recent = await episodic.getRecent('session-1');
      expect(recent.length).toBeLessThanOrEqual(10);
      expect(recent[0].content).toBe('Event 19');
    });
  });

  // ── count() ─────────────────────────────────────────

  describe('count()', () => {
    it('counts all events in a scope', async () => {
      await episodic.addEvent('session-1', 'Event 1');
      await episodic.addEvent('session-1', 'Event 2');
      await episodic.addEvent('session-1', 'Event 3');

      const count = await episodic.count('session-1');
      expect(count).toBe(3);
    });

    it('counts events matching query filters', async () => {
      await episodic.addEvent('session-1', 'User event', { type: 'user_input' });
      await episodic.addEvent('session-1', 'Decision event', { type: 'decision' });
      await episodic.addEvent('session-1', 'Another decision', { type: 'decision' });

      const count = await episodic.count('session-1', { types: ['decision'] });
      expect(count).toBe(2);
    });

    it('returns 0 for unknown scope', async () => {
      const count = await episodic.count('unknown-scope');
      expect(count).toBe(0);
    });
  });

  // ── summarize() ─────────────────────────────────────

  describe('summarize()', () => {
    it('returns summary with total and byType counts', async () => {
      await episodic.addEvent('session-1', 'User input', { type: 'user_input' });
      await episodic.addEvent('session-1', 'Agent response', { type: 'agent_response' });
      await episodic.addEvent('session-1', 'Tool call', { type: 'tool_call' });
      await episodic.addEvent('session-1', 'Another user input', { type: 'user_input' });

      const summary = await episodic.summarize('session-1');
      expect(summary.total).toBe(4);
      expect(summary.byType).toEqual({
        user_input: 2,
        agent_response: 1,
        tool_call: 1,
      });
    });

    it('includes oldest and newest timestamps', async () => {
      await episodic.addEvent('session-1', 'Oldest');
      await new Promise((r) => setTimeout(r, 5));
      await episodic.addEvent('session-1', 'Newest');

      const summary = await episodic.summarize('session-1');
      expect(summary.oldest).toBeTruthy();
      expect(summary.newest).toBeTruthy();
      expect(summary.oldest!).toBeTruthy();
      expect(summary.newest!).toBeTruthy();
      expect(summary.oldest! <= summary.newest!).toBe(true);
    });

    it('filters summary by time range', async () => {
      await storage.appendEvent('session-1', {
        id: 'evt-early', timestamp: '2026-05-20T10:00:00Z', type: 'user_input',
        content: 'Event 1', importance: 0.5,
      });
      await storage.appendEvent('session-1', {
        id: 'evt-late', timestamp: '2026-05-22T10:00:00Z', type: 'user_input',
        content: 'Event 2', importance: 0.5,
      });

      const summary = await episodic.summarize('session-1', {
        start: '2026-05-21T00:00:00Z',
        end: '2026-05-23T00:00:00Z',
      });
      expect(summary.total).toBe(1);
    });

    it('returns zero total for empty scope', async () => {
      const summary = await episodic.summarize('empty-scope');
      expect(summary.total).toBe(0);
      expect(summary.byType).toEqual({});
    });
  });
});
