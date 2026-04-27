import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySessionStore } from '../src/session-store.js';
import type { ChatMessage } from '../src/types.js';

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it('should create a session with id and empty messages/events', () => {
    const session = store.create('test-agent');
    expect(session.id).toBeTruthy();
    expect(session.id.startsWith('sess-')).toBe(true);
    expect(session.agentConfigId).toBe('test-agent');
    expect(session.messages).toEqual([]);
    expect(session.events).toEqual([]);
    expect(session.hitlController).toBeDefined();
    expect(session.activeRun).toBeNull();
    expect(session.createdAt).toBeTruthy();
    expect(session.updatedAt).toBeTruthy();
  });

  it('should get a session by id', () => {
    const created = store.create('test-agent');
    const fetched = store.get(created.id);
    expect(fetched).toBe(created);
  });

  it('should return undefined for unknown id', () => {
    const result = store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should list all sessions', () => {
    const s1 = store.create('agent-1');
    const s2 = store.create('agent-2');
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id)).toContain(s1.id);
    expect(list.map((s) => s.id)).toContain(s2.id);
  });

  it('should delete a session', () => {
    const session = store.create('test-agent');
    const deleted = store.delete(session.id);
    expect(deleted).toBe(true);
    expect(store.get(session.id)).toBeUndefined();
  });

  it('should return false when deleting nonexistent session', () => {
    const deleted = store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('should abort active run when deleting session', () => {
    const session = store.create('test-agent');
    const abortController = new AbortController();
    session.activeRun = abortController;

    // Verify abort controller is not aborted yet
    expect(abortController.signal.aborted).toBe(false);

    store.delete(session.id);

    // Verify abort controller was triggered
    expect(abortController.signal.aborted).toBe(true);
  });

  it('should add a message to a session', () => {
    const session = store.create('test-agent');
    const message: ChatMessage = {
      role: 'user',
      content: 'Hello',
      timestamp: new Date().toISOString(),
    };
    store.addMessage(session.id, message);

    const fetched = store.get(session.id)!;
    expect(fetched.messages).toHaveLength(1);
    expect(fetched.messages[0]!.content).toBe('Hello');
  });

  it('should add an event to a session', () => {
    const session = store.create('test-agent');
    const event = {
      type: 'agent.step' as const,
      timestamp: new Date().toISOString(),
      sessionId: session.id,
      step: 1,
      maxSteps: 5,
    };
    store.addEvent(session.id, event);

    const fetched = store.get(session.id)!;
    expect(fetched.events).toHaveLength(1);
  });

  it('should clear messages and events but keep session', () => {
    const session = store.create('test-agent');
    store.addMessage(session.id, {
      role: 'user',
      content: 'Hello',
      timestamp: new Date().toISOString(),
    });
    store.addEvent(session.id, {
      type: 'agent.step',
      timestamp: new Date().toISOString(),
      sessionId: session.id,
      step: 1,
      maxSteps: 5,
    });

    store.clear(session.id);

    const fetched = store.get(session.id)!;
    expect(fetched.messages).toEqual([]);
    expect(fetched.events).toEqual([]);
    // Session still exists
    expect(fetched.id).toBe(session.id);
  });

  it('should not add message to nonexistent session', () => {
    // Should not throw
    store.addMessage('nonexistent', {
      role: 'user',
      content: 'test',
      timestamp: new Date().toISOString(),
    });
  });

  it('should not add event to nonexistent session', () => {
    // Should not throw
    store.addEvent('nonexistent', {
      type: 'agent.step',
      timestamp: new Date().toISOString(),
      sessionId: 'nonexistent',
      step: 1,
      maxSteps: 5,
    });
  });

  it('should accept config overrides', () => {
    const overrides = { maxSteps: 20, systemPrompt: 'You are helpful.' };
    const session = store.create('test-agent', overrides);
    expect(session.configOverrides).toEqual(overrides);
  });
});