import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SessionEvent, SessionRecord } from '@primo-ai/sdk';

describe('SqliteSessionStorage', () => {
  // Dynamic import — skip entire suite if better-sqlite3 is unavailable
  let SqliteSessionStorage: typeof import('../src/session-storage-sqlite.js').SqliteSessionStorage;
  let storage: InstanceType<typeof SqliteSessionStorage>;

  beforeEach(async () => {
    try {
      const mod = await import('../src/session-storage-sqlite.js');
      SqliteSessionStorage = mod.SqliteSessionStorage;
    } catch {
      console.warn('better-sqlite3 not available, skipping SqliteSessionStorage tests');
      return;
    }
    // Use in-memory database for tests
    storage = new SqliteSessionStorage(':memory:');
  });

  afterEach(() => {
    storage?.close?.();
  });

  const makeEvent = (seq: number, type: string, payload?: unknown): SessionEvent => ({
    seq,
    timestamp: new Date().toISOString(),
    type,
    payload: payload ?? {},
  });

  describe('append + read round-trip', () => {
    it('writes one event and reads it back', async () => {
      const event = makeEvent(1, 'agent:start', { sessionId: 's1', input: 'Hello' });
      await storage.append('s1', event);

      const events: SessionEvent[] = [];
      for await (const e of storage.read('s1')) {
        events.push(e);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent:start');
      expect(events[0].seq).toBe(1);
      expect(events[0].payload).toEqual({ sessionId: 's1', input: 'Hello' });
    });

    it('writes multiple events and reads them in order', async () => {
      await storage.append('s1', makeEvent(1, 'agent:start', { sessionId: 's1' }));
      await storage.append('s1', makeEvent(2, 'iteration:end', { step: 0, response: 'Hi' }));
      await storage.append('s1', makeEvent(3, 'agent:end', { status: 'ok' }));

      const events: SessionEvent[] = [];
      for await (const e of storage.read('s1')) {
        events.push(e);
      }

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('agent:start');
      expect(events[1].type).toBe('iteration:end');
      expect(events[2].type).toBe('agent:end');
    });

    it('read on non-existent session yields empty', async () => {
      const events: SessionEvent[] = [];
      for await (const e of storage.read('no-such-session')) {
        events.push(e);
      }
      expect(events).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('returns sessions with filter by status', async () => {
      await storage.updateMeta('s1', { status: 'active', model: 'gpt-4' });
      await storage.updateMeta('s2', { status: 'completed' });
      await storage.updateMeta('s3', { status: 'active' });

      const active = await storage.list({ status: 'active' });
      expect(active).toHaveLength(2);
      const ids = active.map(r => r.sessionId).sort();
      expect(ids).toEqual(['s1', 's3']);
    });

    it('returns all sessions when no filter', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      await storage.updateMeta('s2', { status: 'completed' });

      const all = await storage.list();
      expect(all).toHaveLength(2);
    });

    it('filters by parentSessionId', async () => {
      await storage.updateMeta('child1', { parentSessionId: 'parent' });
      await storage.updateMeta('child2', { parentSessionId: 'parent' });
      await storage.updateMeta('orphan', { status: 'active' });

      const children = await storage.list({ parentSessionId: 'parent' });
      expect(children).toHaveLength(2);
    });

    it('returns empty when no sessions', async () => {
      const all = await storage.list();
      expect(all).toEqual([]);
    });
  });

  describe('get', () => {
    it('returns single session by id', async () => {
      await storage.updateMeta('s1', { status: 'active', model: 'gpt-4' });

      const record = await storage.get('s1');
      expect(record).toBeDefined();
      expect(record!.sessionId).toBe('s1');
      expect(record!.status).toBe('active');
      expect(record!.model).toBe('gpt-4');
    });

    it('returns undefined for non-existent session', async () => {
      const record = await storage.get('no-such');
      expect(record).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('removes session and cascades events', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      await storage.append('s1', makeEvent(1, 'agent:start', { sessionId: 's1' }));
      await storage.append('s1', makeEvent(2, 'iteration:end', { step: 0, response: 'Hi' }));

      await storage.delete('s1');

      const record = await storage.get('s1');
      expect(record).toBeUndefined();

      const events: SessionEvent[] = [];
      for await (const e of storage.read('s1')) {
        events.push(e);
      }
      expect(events).toHaveLength(0);
    });

    it('is a no-op for non-existent session', async () => {
      await expect(storage.delete('no-such')).resolves.toBeUndefined();
    });
  });

  describe('getMessages', () => {
    it('reconstructs messages from events with pagination', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'iteration:end', { step: 0, response: 'First' }));
      await storage.append('s1', makeEvent(3, 'tool:after', { toolName: 'echo', result: 'pong' }));
      await storage.append('s1', makeEvent(4, 'iteration:end', { step: 1, response: 'Second' }));
      await storage.append('s1', makeEvent(5, 'iteration:end', { step: 2, response: 'Third' }));

      // All messages
      const all = await storage.getMessages('s1');
      expect(all).toHaveLength(4); // 3 assistant + 1 tool
      expect(all[0]).toEqual({ role: 'assistant', content: 'First' });
      expect(all[1]).toEqual(expect.objectContaining({ role: 'tool', toolName: 'echo', content: 'pong' }));
      expect(all[2]).toEqual({ role: 'assistant', content: 'Second' });
      expect(all[3]).toEqual({ role: 'assistant', content: 'Third' });

      // With limit
      const limited = await storage.getMessages('s1', { limit: 2 });
      expect(limited).toHaveLength(2);
      expect(limited[0]).toEqual({ role: 'assistant', content: 'Second' });
      expect(limited[1]).toEqual({ role: 'assistant', content: 'Third' });
    });

    it('returns empty for session with no events', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      const messages = await storage.getMessages('s1');
      expect(messages).toEqual([]);
    });

    it('returns empty for non-existent session', async () => {
      const messages = await storage.getMessages('no-such');
      expect(messages).toEqual([]);
    });

    it('handles error events', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'error', { error: 'Boom' }));

      const messages = await storage.getMessages('s1');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ role: 'assistant', content: '[Error] Boom' });
    });

    it('handles tool:after with error result', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'tool:after', { toolName: 'fail', error: 'Crashed' }));

      const messages = await storage.getMessages('s1');
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('tool');
      expect(messages[0].content).toBe('Crashed');
    });

    it('handles tool.after (dot notation) variant', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'tool.after', { toolName: 'echo', result: 'pong' }));

      const messages = await storage.getMessages('s1');
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('tool');
    });
  });

  describe('updateMeta', () => {
    it('creates and updates session metadata', async () => {
      await storage.updateMeta('s1', { status: 'active', model: 'gpt-4' });

      let record = await storage.get('s1');
      expect(record!.status).toBe('active');
      expect(record!.model).toBe('gpt-4');

      await storage.updateMeta('s1', { status: 'completed' });

      record = await storage.get('s1');
      expect(record!.status).toBe('completed');
      expect(record!.model).toBe('gpt-4'); // preserved
    });

    it('sets timestamps', async () => {
      await storage.updateMeta('s1', { status: 'active' });

      const record = await storage.get('s1');
      expect(record!.createdAt).toBeDefined();
      expect(record!.updatedAt).toBeDefined();
      expect(new Date(record!.createdAt).getTime()).not.toBeNaN();
    });
  });
});
