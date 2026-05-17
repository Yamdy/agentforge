import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemSessionStorage } from '../src/session-storage.js';
import type { SessionEvent } from '@primo-ai/sdk';

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
      expect(events[0]).toEqual(event);
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
      expect(events[0]).toEqual(e1);
      expect(events[1]).toEqual(e2);
      expect(events[2]).toEqual(e3);
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
});
