import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FilesystemSessionStorage } from '../src/session-storage.js';
import type { SessionEvent, IntegrityReport } from '@primo-ai/sdk';
import { EventBus } from '../src/event-bus.js';

describe('FilesystemSessionStorage', () => {
  let basePath: string;
  let storage: FilesystemSessionStorage;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'session-test-'));
    storage = new FilesystemSessionStorage(basePath);
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  const makeEvent = (seq: number, type: string, payload?: unknown): SessionEvent => ({
    seq,
    timestamp: new Date().toISOString(),
    type,
    payload: payload ?? {},
  });

  describe('append + read', () => {
    it('writes one event and reads it back as valid JSONL', async () => {
      const event = makeEvent(1, 'agent:start', { sessionId: 's1' });

      await storage.append('s1', event);

      const events: SessionEvent[] = [];
      for await (const e of storage.read('s1')) {
        events.push(e);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject(event);
      expect(events[0].checksum).toBeDefined();
      expect(typeof events[0].checksum).toBe('string');
    });

    it('writes multiple events and reads them in order', async () => {
      const e1 = makeEvent(1, 'agent:start', { sessionId: 's1' });
      const e2 = makeEvent(2, 'stage:after', { stage: 'processInput' });
      const e3 = makeEvent(3, 'agent:end', { status: 'ok' });

      await storage.append('s1', e1);
      await storage.append('s1', e2);
      await storage.append('s1', e3);

      const events: SessionEvent[] = [];
      for await (const e of storage.read('s1')) {
        events.push(e);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject(e1);
      expect(events[1]).toMatchObject(e2);
      expect(events[2]).toMatchObject(e3);
      // Verify checksums are present
      expect(events[0].checksum).toBeDefined();
      expect(events[1].checksum).toBeDefined();
      expect(events[2].checksum).toBeDefined();
    });

    it('read on non-existent session yields empty', async () => {
      const events: SessionEvent[] = [];
      for await (const e of storage.read('no-such-session')) {
        events.push(e);
      }

      expect(events).toHaveLength(0);
    });
  });

  describe('list + updateMeta', () => {
    it('updateMeta creates and retrieves session metadata', async () => {
      await storage.updateMeta('s1', { status: 'active' });

      const list = await storage.list();
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe('s1');
      expect(list[0].status).toBe('active');
    });

    it('list filters by status', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      await storage.updateMeta('s2', { status: 'completed' });

      const active = await storage.list({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].sessionId).toBe('s1');
    });

    it('list filters by parentSessionId', async () => {
      await storage.updateMeta('child1', { parentSessionId: 'parent' });
      await storage.updateMeta('child2', { parentSessionId: 'parent' });
      await storage.updateMeta('orphan', { status: 'active' });

      const children = await storage.list({ parentSessionId: 'parent' });
      expect(children).toHaveLength(2);
      const ids = children.map(r => r.sessionId).sort();
      expect(ids).toEqual(['child1', 'child2']);
    });

    it('updateMeta merges fields on subsequent calls', async () => {
      await storage.updateMeta('s1', { status: 'active', model: 'gpt-4' });
      await storage.updateMeta('s1', { status: 'suspended' });

      const list = await storage.list();
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe('suspended');
      expect(list[0].model).toBe('gpt-4');
    });

    it('list returns empty when no sessions exist', async () => {
      const list = await storage.list();
      expect(list).toEqual([]);
    });
  });

  describe('corrupted JSONL handling', () => {
    it('skips malformed lines and yields valid events', async () => {
      const e1 = makeEvent(1, 'agent:start', { sessionId: 's1' });
      const e2 = makeEvent(2, 'agent:end', { status: 'ok' });

      await storage.append('s1', e1);

      // Manually write a corrupted line (truncated JSON)
      mkdirSync(join(basePath, 's1'), { recursive: true });
      writeFileSync(join(basePath, 's1', 'events.jsonl'), '\n{broken json\n', { flag: 'a' });

      await storage.append('s1', e2);

      const events: SessionEvent[] = [];
      for await (const e of storage.read('s1')) {
        events.push(e);
      }

      // Should yield valid events, skip the corrupted line
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
    });
  });

  describe('sessionId validation', () => {
    it('rejects sessionId with path traversal', async () => {
      await expect(storage.append('../etc/passwd', makeEvent(1, 'test'))).rejects.toThrow(/invalid/i);
    });

    it('rejects sessionId with path separators', async () => {
      await expect(storage.append('foo/bar', makeEvent(1, 'test'))).rejects.toThrow(/invalid/i);
      await expect(storage.append('foo\\bar', makeEvent(1, 'test'))).rejects.toThrow(/invalid/i);
    });

    it('accepts valid UUID sessionIds', async () => {
      const id = crypto.randomUUID();
      await expect(storage.append(id, makeEvent(1, 'test'))).resolves.toBeUndefined();
    });
  });

  describe('get', () => {
    it('returns SessionRecord for existing session', async () => {
      await storage.updateMeta('s1', { status: 'active', model: 'gpt-4' });

      const record = await storage.get('s1');
      expect(record).toBeDefined();
      expect(record!.sessionId).toBe('s1');
      expect(record!.status).toBe('active');
      expect(record!.model).toBe('gpt-4');
    });

    it('returns undefined for non-existent session', async () => {
      const record = await storage.get('no-such-session');
      expect(record).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('removes session directory and all files', async () => {
      await storage.updateMeta('s1', { status: 'active' });
      await storage.append('s1', makeEvent(1, 'agent:start', { sessionId: 's1' }));

      const dirBefore = join(basePath, 's1');
      expect(existsSync(dirBefore)).toBe(true);

      await storage.delete('s1');

      expect(existsSync(dirBefore)).toBe(false);
      const record = await storage.get('s1');
      expect(record).toBeUndefined();
    });

    it('is a no-op for non-existent session', async () => {
      // Should not throw
      await expect(storage.delete('no-such-session')).resolves.toBeUndefined();
    });
  });

  describe('getMessages', () => {
    it('reconstructs Message[] from events', async () => {
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'iteration:end', {
        step: 0,
        response: 'Hi there!',
        tokenUsage: { input: 10, output: 5 },
      }));
      await storage.append('s1', makeEvent(3, 'tool:after', {
        toolName: 'echo',
        result: 'pong',
      }));
      await storage.append('s1', makeEvent(4, 'iteration:end', {
        step: 1,
        response: 'Done',
      }));

      const messages = await storage.getMessages('s1');
      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
      expect(messages[2]).toEqual(expect.objectContaining({
        role: 'tool',
        content: 'pong',
        toolName: 'echo',
      }));
      expect(messages[3]).toEqual({ role: 'assistant', content: 'Done' });
    });

    it('returns only last N messages with limit option', async () => {
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'iteration:end', { step: 0, response: 'First' }));
      await storage.append('s1', makeEvent(3, 'iteration:end', { step: 1, response: 'Second' }));
      await storage.append('s1', makeEvent(4, 'iteration:end', { step: 2, response: 'Third' }));

      const messages = await storage.getMessages('s1', { limit: 2 });
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'assistant', content: 'Second' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'Third' });
    });

    it('returns empty array for empty session', async () => {
      // Create a session with meta but no events
      await storage.updateMeta('s1', { status: 'active' });

      const messages = await storage.getMessages('s1');
      expect(messages).toEqual([]);
    });

    it('returns empty array for non-existent session', async () => {
      const messages = await storage.getMessages('no-such-session');
      expect(messages).toEqual([]);
    });

    it('handles error events', async () => {
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'error', { error: 'Something went wrong' }));

      const messages = await storage.getMessages('s1');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(messages[1]).toEqual({ role: 'assistant', content: '[Error] Something went wrong' });
    });

    it('handles tool:after with error result', async () => {
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'tool:after', {
        toolName: 'failing-tool',
        error: 'Tool crashed',
      }));

      const messages = await storage.getMessages('s1');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(messages[1].role).toBe('tool');
      expect(messages[1].content).toBe('Tool crashed');
    });

    it('handles iteration.end (dot notation) event variant', async () => {
      await storage.append('s1', makeEvent(1, 'agent:start', { input: 'Hello' }));
      await storage.append('s1', makeEvent(2, 'iteration.end', {
        step: 0,
        response: 'Dot notation response',
      }));

      const messages = await storage.getMessages('s1');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'Dot notation response' });
    });
  });

  describe('C1: checksum integrity', () => {
    const computeChecksum = (event: SessionEvent): string => {
      return createHash('sha256').update(JSON.stringify({ seq: event.seq, timestamp: event.timestamp, type: event.type, payload: event.payload })).digest('hex');
    };

    it('append auto-computes checksum', async () => {
      const event = makeEvent(1, 'agent:start', { sessionId: 's1' });
      await storage.append('s1', event);
      const expectedChecksum = computeChecksum(event);

      const raw = readFileSync(join(basePath, 's1', 'events.jsonl'), 'utf-8');
      const parsed = JSON.parse(raw.trim()) as SessionEvent;
      expect(parsed.checksum).toBe(expectedChecksum);
    });

    it('read validates checksum by default and emits integrity_error on mismatch', async () => {
      const bus = new EventBus();
      storage = new FilesystemSessionStorage(basePath, { eventBus: bus });

      const received: unknown[] = [];
      bus.subscribe('session:integrity_error', (data) => received.push(data));

      const event = makeEvent(1, 'agent:start', { sessionId: 's1' });
      await storage.append('s1', event);

      // Tamper the event file
      const eventsPath = join(basePath, 's1', 'events.jsonl');
      const content = readFileSync(eventsPath, 'utf-8');
      const tampered = content.replace('"seq":1', '"seq":999');
      writeFileSync(eventsPath, tampered, 'utf-8');

      // Flush knownEvents cache
      const events: SessionEvent[] = [];
      for await (const e of storage.read('s1')) {
        events.push(e);
      }

      expect(events).toHaveLength(0);
      expect(received).toHaveLength(1);
    });

    it('read skips checksum validation when configured', async () => {
      storage = new FilesystemSessionStorage(basePath, { skipChecksum: true });

      const event = makeEvent(1, 'agent:start', { sessionId: 's1' });
      await storage.append('s1', event);

      const eventsPath = join(basePath, 's1', 'events.jsonl');
      const content = readFileSync(eventsPath, 'utf-8');
      const tampered = content.replace('"seq":1', '"seq":999');
      writeFileSync(eventsPath, tampered, 'utf-8');

      const events: SessionEvent[] = [];
      for await (const e of storage.read('s1')) {
        events.push(e);
      }

      expect(events).toHaveLength(1);
      expect((events[0] as unknown as Record<string, unknown>).seq).toBe(999);
    });

    it('verifyIntegrity returns valid=true for untampered events', async () => {
      await storage.append('s1', makeEvent(1, 'agent:start', { sessionId: 's1' }));
      await storage.append('s1', makeEvent(2, 'agent:end', { status: 'ok' }));

      const report = await storage.verifyIntegrity('s1');
      expect(report.valid).toBe(true);
      expect(report.totalEvents).toBe(2);
      expect(report.invalidEvents).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('verifyIntegrity detects tampered events', async () => {
      await storage.append('s1', makeEvent(1, 'agent:start', { sessionId: 's1' }));
      await storage.append('s1', makeEvent(2, 'agent:end', { status: 'ok' }));

      // Tamper the file
      const eventsPath = join(basePath, 's1', 'events.jsonl');
      const content = readFileSync(eventsPath, 'utf-8');
      const tampered = content.replace('"status":"ok"', '"status":"hacked"');
      writeFileSync(eventsPath, tampered, 'utf-8');

      const report = await storage.verifyIntegrity('s1');
      expect(report.valid).toBe(false);
      expect(report.totalEvents).toBe(2);
      expect(report.invalidEvents).toBe(1);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].seq).toBe(2);
    });

    it('verifyIntegrity returns invalid for events missing checksum', async () => {
      // Write an event without checksum directly
      const event = makeEvent(1, 'test', {});
      delete (event as { checksum?: string }).checksum;
      const raw = JSON.stringify(event) + '\n';
      const dir = join(basePath, 's1');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'events.jsonl'), raw, 'utf-8');

      const report = await storage.verifyIntegrity('s1');
      expect(report.valid).toBe(false);
      expect(report.invalidEvents).toBe(1);
      expect(report.errors[0].expected).toBe('checksum_missing');
    });

    it('verifyIntegrity for non-existent session returns empty report', async () => {
      const report = await storage.verifyIntegrity('no-such-session');
      expect(report.valid).toBe(true);
      expect(report.totalEvents).toBe(0);
      expect(report.invalidEvents).toBe(0);
    });
  });

  describe('C3: session TTL and GC', () => {
    beforeEach(async () => {
      // Set up storage with 1-hour TTL
      storage = new FilesystemSessionStorage(basePath, { ttl: 3600 });
    });

    it('list filters out expired completed sessions', async () => {
      // Create an expired session by setting updatedAt far in the past
      const oldDate = new Date(Date.now() - 7200_000).toISOString(); // 2 hours ago
      await storage.updateMeta('expired-session', { status: 'completed' });
      // Manually override the updatedAt
      writeFileSync(
        join(basePath, 'expired-session', 'meta.json'),
        JSON.stringify({ sessionId: 'expired-session', status: 'completed', createdAt: oldDate, updatedAt: oldDate }),
        'utf-8',
      );

      await storage.updateMeta('active-session', { status: 'active' });

      const all = await storage.list();
      const ids = all.map(r => r.sessionId);
      expect(ids).not.toContain('expired-session');
      expect(ids).toContain('active-session');
    });

    it('cleanup deletes expired sessions and returns count', async () => {
      const oldDate = new Date(Date.now() - 7200_000).toISOString();
      await storage.updateMeta('expired-1', { status: 'completed' });
      writeFileSync(
        join(basePath, 'expired-1', 'meta.json'),
        JSON.stringify({ sessionId: 'expired-1', status: 'completed', createdAt: oldDate, updatedAt: oldDate }),
        'utf-8',
      );

      await storage.updateMeta('expired-2', { status: 'error' });
      writeFileSync(
        join(basePath, 'expired-2', 'meta.json'),
        JSON.stringify({ sessionId: 'expired-2', status: 'error', createdAt: oldDate, updatedAt: oldDate }),
        'utf-8',
      );

      await storage.updateMeta('fresh', { status: 'active' });

      const deleted = await storage.cleanup();
      expect(deleted).toBe(2);

      const remaining = await storage.list();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].sessionId).toBe('fresh');
    });

    it('cleanup does not delete sessions within TTL', async () => {
      const recentDate = new Date(Date.now() - 1800_000).toISOString(); // 30 min ago
      await storage.updateMeta('recent-session', { status: 'completed' });
      writeFileSync(
        join(basePath, 'recent-session', 'meta.json'),
        JSON.stringify({ sessionId: 'recent-session', status: 'completed', createdAt: recentDate, updatedAt: recentDate }),
        'utf-8',
      );

      const deleted = await storage.cleanup();
      expect(deleted).toBe(0);

      const all = await storage.list();
      expect(all).toHaveLength(1);
    });

    it('cleanup with no TTL does nothing', async () => {
      storage = new FilesystemSessionStorage(basePath); // no ttl
      const oldDate = new Date(Date.now() - 7200_000).toISOString();
      await storage.updateMeta('old-session', { status: 'completed' });
      writeFileSync(
        join(basePath, 'old-session', 'meta.json'),
        JSON.stringify({ sessionId: 'old-session', status: 'completed', createdAt: oldDate, updatedAt: oldDate }),
        'utf-8',
      );

      const deleted = await storage.cleanup();
      expect(deleted).toBe(0);
    });
  });
});
