import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventBus } from '../src/event-bus.js';
import { FilesystemSessionStorage } from '../src/session-storage.js';
import { SessionPersistence } from '../src/session-persistence.js';
import { SessionManagerImpl } from '../src/session-manager.js';
import type { SessionEvent } from '@agentforge/sdk';

describe('SessionManager', () => {
  let basePath: string;
  let bus: EventBus;
  let storage: FilesystemSessionStorage;
  let persistence: SessionPersistence;
  let manager: SessionManagerImpl;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'session-mgr-'));
    bus = new EventBus();
    storage = new FilesystemSessionStorage(basePath);
    persistence = new SessionPersistence(bus, storage);
    manager = new SessionManagerImpl(storage, bus);
  });

  afterEach(async () => {
    await persistence.stop();
    rmSync(basePath, { recursive: true, force: true });
  });

  describe('start', () => {
    it('creates a new session record with active status', async () => {
      const record = await manager.start('Hello agent');

      expect(record.sessionId).toBeTruthy();
      expect(record.status).toBe('active');
      expect(record.createdAt).toBeTruthy();
    });

    it('emits agent:start event on the bus', async () => {
      const received: unknown[] = [];
      bus.subscribe('agent:start', (data) => received.push(data));

      await manager.start('Hello');

      expect(received).toHaveLength(1);
      expect((received[0] as { input: string }).input).toBe('Hello');
    });

    it('persists session metadata to storage', async () => {
      const record = await manager.start('test');

      const list = await storage.list();
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe(record.sessionId);
      expect(list[0].status).toBe('active');
    });
  });

  describe('restore', () => {
    it('reconstructs PipelineContext from event replay', async () => {
      const sessionId = 'restore-test';
      const now = new Date().toISOString();

      // Seed events simulating a partial agent run
      const events: SessionEvent[] = [
        { seq: 1, timestamp: now, type: 'agent:start', payload: { sessionId, input: 'What is 2+2?' } },
        { seq: 2, timestamp: now, type: 'stage.complete', payload: { sessionId, stage: 'processInput' } },
        { seq: 3, timestamp: now, type: 'stage.complete', payload: { sessionId, stage: 'buildContext' } },
        { seq: 4, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 0, response: '4' } },
      ];
      for (const event of events) {
        await storage.append(sessionId, event);
      }

      const ctx = await manager.restore(sessionId);

      expect(ctx.request.sessionId).toBe(sessionId);
      expect(ctx.request.input).toBe('What is 2+2?');
      expect(ctx.session).toBeDefined();
    });

    it('replays iteration state including message history and step count', async () => {
      const sessionId = 'restore-iter';
      const now = new Date().toISOString();

      const events: SessionEvent[] = [
        { seq: 1, timestamp: now, type: 'agent:start', payload: { sessionId, input: 'hello' } },
        { seq: 2, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 0, response: 'hi' } },
        { seq: 3, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 1, response: 'done' } },
      ];
      for (const event of events) {
        await storage.append(sessionId, event);
      }

      const ctx = await manager.restore(sessionId);

      // Should restore to last iteration + 1, ready to continue loop
      expect(ctx.iteration.step).toBe(2);
      expect(ctx.session.messageHistory).toBeDefined();
      const history = ctx.session.messageHistory as unknown as Array<Record<string, unknown>>;
      expect(history).toHaveLength(2);
    });

    it('throws on non-existent session', async () => {
      await expect(manager.restore('no-such-session')).rejects.toThrow(/not found/i);
    });
  });

  describe('suspend + resume', () => {
    it('suspend emits session:suspended through EventBus', async () => {
      const record = await manager.start('do something');
      const sessionId = record.sessionId;

      await manager.suspend(sessionId, 'waiting for approval');

      const list = await storage.list({ status: 'suspended' });
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe(sessionId);

      // Verify suspend event was written via EventBus → Persistence
      await persistence.stop();
      const events: SessionEvent[] = [];
      for await (const e of storage.read(sessionId)) {
        events.push(e);
      }
      const suspendEvent = events.find(e => e.type === 'session:suspended');
      expect(suspendEvent).toBeDefined();
      expect((suspendEvent!.payload as Record<string, unknown>).reason).toBe('waiting for approval');
    });

    it('suspend seq numbers are consistent with EventBus events', async () => {
      const record = await manager.start('seq test');
      const sessionId = record.sessionId;

      // Emit events through EventBus while persistence is active
      bus.emit('iteration.end', { sessionId, step: 0, response: 'partial' });
      bus.emit('iteration.end', { sessionId, step: 1, response: 'more' });

      // Suspend also emits through EventBus — all go through same seq counter
      await manager.suspend(sessionId, 'need input');

      await persistence.stop();

      const allEvents: SessionEvent[] = [];
      for await (const e of storage.read(sessionId)) allEvents.push(e);

      // agent:start(1), iteration.end(2), iteration.end(3), session:suspended(4)
      expect(allEvents).toHaveLength(4);
      const seqs = allEvents.map(e => e.seq);
      expect(seqs).toEqual([1, 2, 3, 4]);
    });

    it('resume restores context and continues with new input', async () => {
      const record = await manager.start('first task');
      const sessionId = record.sessionId;

      await manager.suspend(sessionId, 'need input');

      // Resume with new input
      const newSessionId = await manager.resume(sessionId, 'approved!');

      expect(newSessionId).toBeTruthy();
      expect(newSessionId).not.toBe(sessionId);

      const children = await storage.list({ parentSessionId: sessionId });
      expect(children).toHaveLength(1);
      expect(children[0].sessionId).toBe(newSessionId);
      expect(children[0].status).toBe('active');

      const original = await storage.list({ status: 'completed' });
      expect(original.some(r => r.sessionId === sessionId)).toBe(true);
    });
  });

  describe('tree branching', () => {
    it('start with parentSessionId creates a child session', async () => {
      const parent = await manager.start('parent task');
      const child = await manager.start('child task', { parentSessionId: parent.sessionId });

      expect(child.parentSessionId).toBe(parent.sessionId);

      const children = await manager.list({ parentSessionId: parent.sessionId });
      expect(children).toHaveLength(1);
      expect(children[0].sessionId).toBe(child.sessionId);
    });

    it('supports multi-level tree: parent → child → grandchild', async () => {
      const parent = await manager.start('level 0');
      const child = await manager.start('level 1', { parentSessionId: parent.sessionId });
      const grandchild = await manager.start('level 2', { parentSessionId: child.sessionId });

      expect(child.parentSessionId).toBe(parent.sessionId);
      expect(grandchild.parentSessionId).toBe(child.sessionId);

      // Parent has one direct child
      const directChildren = await manager.list({ parentSessionId: parent.sessionId });
      expect(directChildren).toHaveLength(1);
      expect(directChildren[0].sessionId).toBe(child.sessionId);

      // Child has one direct child (grandchild)
      const grandChildren = await manager.list({ parentSessionId: child.sessionId });
      expect(grandChildren).toHaveLength(1);
      expect(grandChildren[0].sessionId).toBe(grandchild.sessionId);
    });
  });
});
