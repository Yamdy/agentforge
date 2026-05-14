import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventBus } from '../src/event-bus.js';
import { FilesystemSessionStorage } from '../src/session-storage.js';
import { SessionPersistence } from '../src/session-persistence.js';
import { REPLAY_SENTINEL } from '../src/event-system.js';
import type { SessionEvent } from '@agentforge/sdk';

describe('SessionPersistence', () => {
  let basePath: string;
  let bus: EventBus;
  let storage: FilesystemSessionStorage;
  let persistence: SessionPersistence;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'session-persist-'));
    bus = new EventBus();
    storage = new FilesystemSessionStorage(basePath);
    persistence = new SessionPersistence(bus, storage);
  });

  afterEach(async () => {
    // stop() is idempotent — safe to call even if already stopped
    try { await persistence.stop(); } catch { /* already stopped */ }
    rmSync(basePath, { recursive: true, force: true });
  });

  it('subscribes to agent events and writes them to JSONL', async () => {
    const sessionId = 'sess-1';

    bus.emit('agent:start', { sessionId, input: 'hello' });
    bus.emit('stage:after', { sessionId, stage: 'processInput' });
    bus.emit('agent:end', { sessionId, status: 'completed' });

    // Wait for write queue to drain
    await persistence.stop();

    const events: SessionEvent[] = [];
    for await (const e of storage.read(sessionId)) {
      events.push(e);
    }

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('agent:start');
    expect(events[1].type).toBe('stage:after');
    expect(events[2].type).toBe('agent:end');
  });

  it('does not propagate storage errors to event emitter', async () => {
    const brokenStorage = new FilesystemSessionStorage('/nonexistent/path/that/should/fail');
    const brokenPersistence = new SessionPersistence(bus, brokenStorage);

    // Should not throw despite broken storage
    expect(() => {
      bus.emit('agent:start', { sessionId: 's1' });
    }).not.toThrow();

    await brokenPersistence.stop();
  });

  it('recovers after transient storage failure', async () => {
    const isolatedBus = new EventBus();
    let hasFailed = false;
    const flakyStorage: import('@agentforge/sdk').SessionStorage = {
      append: async (sessionId, event) => {
        if (!hasFailed) {
          hasFailed = true;
          throw new Error('disk full');
        }
        await storage.append(sessionId, event);
      },
      read: (sessionId) => storage.read(sessionId),
      list: (filter) => storage.list(filter),
      updateMeta: (sessionId, meta) => storage.updateMeta(sessionId, meta),
    };

    const flakyPersistence = new SessionPersistence(isolatedBus, flakyStorage);

    // First event fails silently, second is dropped by queue recovery, third succeeds
    isolatedBus.emit('agent:start', { sessionId: 's1', input: 'first' });
    isolatedBus.emit('agent:start', { sessionId: 's1', input: 'second' });
    await flushAsync();

    isolatedBus.emit('agent:end', { sessionId: 's1', status: 'ok' });
    await flushAsync();

    const events: SessionEvent[] = [];
    for await (const e of storage.read('s1')) {
      events.push(e);
    }

    // Only the third event made it through
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent:end');

    await flakyPersistence.stop();
  });

  it('stop unsubscribes from future events', async () => {
    bus.emit('agent:start', { sessionId: 's1' });

    await persistence.stop();

    bus.emit('agent:end', { sessionId: 's1', status: 'completed' });
    await flushAsync();

    const events: SessionEvent[] = [];
    for await (const e of storage.read('s1')) {
      events.push(e);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent:start');
  });

  it('skips replayed events with __replay sentinel', async () => {
    const sessionId = 's1';

    // Normal event — should be persisted
    bus.emit('agent:start', { sessionId, input: 'hello' });

    // Replayed event — should be skipped
    bus.emit('agent:start', { sessionId, input: 'replayed', [REPLAY_SENTINEL]: true });

    await persistence.stop();

    const events: SessionEvent[] = [];
    for await (const e of storage.read(sessionId)) {
      events.push(e);
    }

    expect(events).toHaveLength(1);
    expect((events[0].payload as Record<string, unknown>).input).toBe('hello');
  });
});

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}
