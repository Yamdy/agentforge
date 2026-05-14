import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventSystem, REPLAY_SENTINEL } from '../src/event-system.js';
import { StorageReplayBackend } from '../src/storage-replay-backend.js';
import { EventBus } from '../src/event-bus.js';
import { FilesystemSessionStorage } from '../src/session-storage.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionEvent } from '@agentforge/sdk';

// ---------------------------------------------------------------------------
// EventSystem — emit/subscribe delegation
// ---------------------------------------------------------------------------

describe('EventSystem', () => {
  it('delegates emit/subscribe to internal EventBus', () => {
    const sys = new EventSystem();
    const received: unknown[] = [];

    sys.subscribe('agent:start', (data) => received.push(data));
    sys.emit('agent:start', { sessionId: 's1' });

    expect(received).toEqual([{ sessionId: 's1' }]);
  });

  it('unsubscribe works through EventSystem', () => {
    const sys = new EventSystem();
    const received: unknown[] = [];

    const unsub = sys.subscribe('agent:start', (data) => received.push(data));
    sys.emit('agent:start', 'first');
    unsub();
    sys.emit('agent:start', 'second');

    expect(received).toEqual(['first']);
  });

  it('bus getter returns underlying EventBus', () => {
    const sys = new EventSystem();
    expect(sys.bus).toBeInstanceOf(EventBus);
  });

  it('handler errors are forwarded to onError callback', () => {
    const errors: unknown[] = [];
    const sys = new EventSystem((err) => errors.push(err));

    sys.subscribe('evt', () => { throw new Error('boom'); });
    sys.emit('evt');

    expect(errors).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // EventSystem — query / replay without backend
  // ---------------------------------------------------------------------------

  it('query returns empty array when no backend is set', async () => {
    const sys = new EventSystem();
    const events = await sys.query('s1');
    expect(events).toEqual([]);
  });

  it('replay is a no-op when no backend is set', async () => {
    const sys = new EventSystem();
    const received: unknown[] = [];
    sys.subscribe('agent:start', (data) => received.push(data));

    await sys.replay('s1');
    expect(received).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // EventSystem — query / replay with backend
  // ---------------------------------------------------------------------------

  describe('with StorageReplayBackend', () => {
    let basePath: string;
    let storage: FilesystemSessionStorage;

    beforeEach(() => {
      basePath = mkdtempSync(join(tmpdir(), 'event-system-test-'));
      storage = new FilesystemSessionStorage(basePath);
    });

    afterEach(() => {
      rmSync(basePath, { recursive: true, force: true });
    });

    it('query reads events from backend', async () => {
      const events: SessionEvent[] = [
        { seq: 1, timestamp: new Date().toISOString(), type: 'agent:start', payload: { sessionId: 's1', input: 'hello' } },
        { seq: 2, timestamp: new Date().toISOString(), type: 'agent:end', payload: { sessionId: 's1', status: 'done' } },
      ];
      for (const e of events) await storage.append('s1', e);

      const sys = new EventSystem();
      sys.setReplayBackend(new StorageReplayBackend(storage));

      const result = await sys.query('s1');
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('agent:start');
      expect(result[1].type).toBe('agent:end');
    });

    it('replay re-emits historical events to subscribers', async () => {
      const events: SessionEvent[] = [
        { seq: 1, timestamp: new Date().toISOString(), type: 'agent:start', payload: { sessionId: 's1', input: 'hello' } },
        { seq: 2, timestamp: new Date().toISOString(), type: 'tool:after', payload: { sessionId: 's1', toolName: 'echo' } },
      ];
      for (const e of events) await storage.append('s1', e);

      const sys = new EventSystem();
      sys.setReplayBackend(new StorageReplayBackend(storage));

      const starts: unknown[] = [];
      const tools: unknown[] = [];
      sys.subscribe('agent:start', (data) => starts.push(data));
      sys.subscribe('tool:after', (data) => tools.push(data));

      await sys.replay('s1');

      expect(starts).toHaveLength(1);
      expect(tools).toHaveLength(1);
    });

    it('replay adds __replay sentinel to object payloads', async () => {
      const events: SessionEvent[] = [
        { seq: 1, timestamp: new Date().toISOString(), type: 'agent:start', payload: { sessionId: 's1' } },
      ];
      for (const e of events) await storage.append('s1', e);

      const sys = new EventSystem();
      sys.setReplayBackend(new StorageReplayBackend(storage));

      let captured: Record<string, unknown> | undefined;
      sys.subscribe('agent:start', (data) => { captured = data as Record<string, unknown>; });

      await sys.replay('s1');

      expect(captured).toBeDefined();
      expect(captured![REPLAY_SENTINEL]).toBe(true);
      expect(captured!.sessionId).toBe('s1');
    });

    it('replay does not mutate original payload beyond adding sentinel', async () => {
      const original = { sessionId: 's1', nested: { key: 'value' } };
      const events: SessionEvent[] = [
        { seq: 1, timestamp: new Date().toISOString(), type: 'agent:start', payload: original },
      ];
      for (const e of events) await storage.append('s1', e);

      const sys = new EventSystem();
      sys.setReplayBackend(new StorageReplayBackend(storage));

      let captured: Record<string, unknown> | undefined;
      sys.subscribe('agent:start', (data) => { captured = data as Record<string, unknown>; });

      await sys.replay('s1');

      // Original should not be mutated
      expect(REPLAY_SENTINEL in original).toBe(false);
      // Captured should have the sentinel
      expect(captured![REPLAY_SENTINEL]).toBe(true);
    });

    it('replay filters by eventTypes', async () => {
      const events: SessionEvent[] = [
        { seq: 1, timestamp: new Date().toISOString(), type: 'agent:start', payload: { sessionId: 's1' } },
        { seq: 2, timestamp: new Date().toISOString(), type: 'tool:after', payload: { sessionId: 's1' } },
        { seq: 3, timestamp: new Date().toISOString(), type: 'agent:end', payload: { sessionId: 's1' } },
      ];
      for (const e of events) await storage.append('s1', e);

      const sys = new EventSystem();
      sys.setReplayBackend(new StorageReplayBackend(storage));

      const received: string[] = [];
      sys.subscribe('agent:start', () => received.push('agent:start'));
      sys.subscribe('tool:after', () => received.push('tool:after'));
      sys.subscribe('agent:end', () => received.push('agent:end'));

      await sys.replay('s1', { eventTypes: ['agent:start', 'agent:end'] });

      expect(received).toEqual(['agent:start', 'agent:end']);
    });

    it('replay filters by fromSeq/toSeq', async () => {
      const events: SessionEvent[] = [
        { seq: 1, timestamp: new Date().toISOString(), type: 'agent:start', payload: {} },
        { seq: 2, timestamp: new Date().toISOString(), type: 'stage:after', payload: {} },
        { seq: 3, timestamp: new Date().toISOString(), type: 'tool:after', payload: {} },
        { seq: 4, timestamp: new Date().toISOString(), type: 'agent:end', payload: {} },
      ];
      for (const e of events) await storage.append('s1', e);

      const sys = new EventSystem();
      sys.setReplayBackend(new StorageReplayBackend(storage));

      const received: string[] = [];
      sys.subscribe('agent:start', () => received.push('agent:start'));
      sys.subscribe('stage:after', () => received.push('stage:after'));
      sys.subscribe('tool:after', () => received.push('tool:after'));
      sys.subscribe('agent:end', () => received.push('agent:end'));

      await sys.replay('s1', { fromSeq: 2, toSeq: 3 });

      expect(received).toEqual(['stage:after', 'tool:after']);
    });

    it('replay handles non-object payloads (strings, numbers, null)', async () => {
      const events: SessionEvent[] = [
        { seq: 1, timestamp: new Date().toISOString(), type: 'test:string', payload: 'hello' },
        { seq: 2, timestamp: new Date().toISOString(), type: 'test:number', payload: 42 },
        { seq: 3, timestamp: new Date().toISOString(), type: 'test:null', payload: null },
      ];
      for (const e of events) await storage.append('s1', e);

      const sys = new EventSystem();
      sys.setReplayBackend(new StorageReplayBackend(storage));

      const received: unknown[] = [];
      sys.subscribe('test:string', (d) => received.push(d));
      sys.subscribe('test:number', (d) => received.push(d));
      sys.subscribe('test:null', (d) => received.push(d));

      await sys.replay('s1');

      expect(received).toEqual(['hello', 42, null]);
    });
  });
});

// ---------------------------------------------------------------------------
// StorageReplayBackend
// ---------------------------------------------------------------------------

describe('StorageReplayBackend', () => {
  let basePath: string;
  let storage: FilesystemSessionStorage;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'replay-backend-test-'));
    storage = new FilesystemSessionStorage(basePath);
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  it('reads events from SessionStorage', async () => {
    const events: SessionEvent[] = [
      { seq: 1, timestamp: '2026-01-01T00:00:00Z', type: 'agent:start', payload: { sessionId: 's1' } },
      { seq: 2, timestamp: '2026-01-01T00:01:00Z', type: 'agent:end', payload: { sessionId: 's1' } },
    ];
    for (const e of events) await storage.append('s1', e);

    const backend = new StorageReplayBackend(storage);
    const result = await backend.query('s1');

    expect(result).toHaveLength(2);
    expect(result[0].seq).toBe(1);
    expect(result[1].seq).toBe(2);
  });

  it('returns empty array for unknown session', async () => {
    const backend = new StorageReplayBackend(storage);
    const result = await backend.query('nonexistent');
    expect(result).toEqual([]);
  });
});
