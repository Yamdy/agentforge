import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventBus } from '../src/event-bus.js';
import { FilesystemSessionStorage } from '../src/session-storage.js';
import { SessionPersistence } from '../src/session-persistence.js';
import { SessionManagerImpl } from '../src/session-manager.js';
import type { SessionEvent, Message } from '@agentforge/sdk';

describe('SessionManager restore — message format compliance', () => {
  let basePath: string;
  let bus: EventBus;
  let storage: FilesystemSessionStorage;
  let persistence: SessionPersistence;
  let manager: SessionManagerImpl;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'session-restore-msg-'));
    bus = new EventBus();
    storage = new FilesystemSessionStorage(basePath);
    persistence = new SessionPersistence(bus, storage);
    manager = new SessionManagerImpl(storage, bus);
  });

  afterEach(async () => {
    await persistence.stop();
    rmSync(basePath, { recursive: true, force: true });
  });

  it('restores iteration responses as assistant Message entries', async () => {
    const sessionId = 'msg-format-test';
    const now = new Date().toISOString();

    const events: SessionEvent[] = [
      { seq: 1, timestamp: now, type: 'agent:start', payload: { sessionId, input: 'hello' } },
      { seq: 2, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 0, response: 'hi there' } },
      { seq: 3, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 1, response: 'done' } },
    ];
    for (const event of events) {
      await storage.append(sessionId, event);
    }

    const ctx = await manager.restore(sessionId);

    const history = ctx.session.messageHistory;
    expect(history).toHaveLength(2);
    // Every entry must be a valid Message (role-based)
    for (const msg of history) {
      const m = msg as Message;
      expect(['user', 'assistant', 'tool']).toContain(m.role);
    }
    expect((history[0] as Message).role).toBe('assistant');
    expect((history[0] as Message & { content: string }).content).toBe('hi there');
    expect((history[1] as Message).role).toBe('assistant');
    expect((history[1] as Message & { content: string }).content).toBe('done');
  });

  it('restores tool events as tool Message entries with toolName', async () => {
    const sessionId = 'msg-tool-test';
    const now = new Date().toISOString();

    const events: SessionEvent[] = [
      { seq: 1, timestamp: now, type: 'agent:start', payload: { sessionId, input: 'use tool' } },
      { seq: 2, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 0, response: 'let me check' } },
      { seq: 3, timestamp: now, type: 'tool.before', payload: { sessionId, toolName: 'search', args: { q: 'test' } } },
      { seq: 4, timestamp: now, type: 'tool.after', payload: { sessionId, toolName: 'search', result: 'found 3 items' } },
    ];
    for (const event of events) {
      await storage.append(sessionId, event);
    }

    const ctx = await manager.restore(sessionId);

    const history = ctx.session.messageHistory;
    // assistant message + tool message
    expect(history).toHaveLength(2);

    const assistantMsg = history[0] as Message;
    expect(assistantMsg.role).toBe('assistant');
    expect((assistantMsg as { content: string }).content).toBe('let me check');

    const toolMsg = history[1] as Message;
    expect(toolMsg.role).toBe('tool');
    expect((toolMsg as { toolName: string }).toolName).toBe('search');
    expect((toolMsg as { content: string }).content).toContain('found 3 items');
  });

  it('restores tool error events as tool Message entries with error field', async () => {
    const sessionId = 'msg-tool-error';
    const now = new Date().toISOString();

    const events: SessionEvent[] = [
      { seq: 1, timestamp: now, type: 'agent:start', payload: { sessionId, input: 'bad tool' } },
      { seq: 2, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 0, response: 'trying' } },
      { seq: 3, timestamp: now, type: 'tool.before', payload: { sessionId, toolName: 'fail', args: {} } },
      { seq: 4, timestamp: now, type: 'tool.after', payload: { sessionId, toolName: 'fail', error: 'timeout' } },
    ];
    for (const event of events) {
      await storage.append(sessionId, event);
    }

    const ctx = await manager.restore(sessionId);

    const toolMsg = ctx.session.messageHistory[1] as Message;
    expect(toolMsg.role).toBe('tool');
    expect((toolMsg as { toolName: string }).toolName).toBe('fail');
    expect((toolMsg as { error: string }).error).toBe('timeout');
  });

  it('restores error events as assistant Message entries', async () => {
    const sessionId = 'msg-error-test';
    const now = new Date().toISOString();

    const events: SessionEvent[] = [
      { seq: 1, timestamp: now, type: 'agent:start', payload: { sessionId, input: 'fail test' } },
      { seq: 2, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 0, response: 'ok' } },
      { seq: 3, timestamp: now, type: 'error', payload: { sessionId, error: 'something broke' } },
    ];
    for (const event of events) {
      await storage.append(sessionId, event);
    }

    const ctx = await manager.restore(sessionId);

    const history = ctx.session.messageHistory;
    expect(history).toHaveLength(2);

    // error should be an assistant message with error content
    const errorMsg = history[1] as Message;
    expect(errorMsg.role).toBe('assistant');
    expect((errorMsg as { content: string }).content).toContain('something broke');
  });

  it('all restored history entries are valid Message types (no raw event shapes)', async () => {
    const sessionId = 'msg-no-raw-shapes';
    const now = new Date().toISOString();

    const events: SessionEvent[] = [
      { seq: 1, timestamp: now, type: 'agent:start', payload: { sessionId, input: 'comprehensive' } },
      { seq: 2, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 0, response: 'first' } },
      { seq: 3, timestamp: now, type: 'tool.before', payload: { sessionId, toolName: 'echo', args: { text: 'hi' } } },
      { seq: 4, timestamp: now, type: 'tool.after', payload: { sessionId, toolName: 'echo', result: 'hi' } },
      { seq: 5, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 1, response: 'second' } },
      { seq: 6, timestamp: now, type: 'error', payload: { sessionId, error: 'oops' } },
      { seq: 7, timestamp: now, type: 'iteration.end', payload: { sessionId, step: 2, response: 'final' } },
    ];
    for (const event of events) {
      await storage.append(sessionId, event);
    }

    const ctx = await manager.restore(sessionId);
    const history = ctx.session.messageHistory as Message[];

    // No raw shapes like { step, response }, { type: 'tool_call' }, { type: 'error' }
    for (const msg of history) {
      expect(msg).toHaveProperty('role');
      expect(['user', 'assistant', 'tool']).toContain(msg.role);
      // Must NOT have raw event markers
      expect(msg).not.toHaveProperty('type');
      expect(msg).not.toHaveProperty('step');
    }
  });
});
