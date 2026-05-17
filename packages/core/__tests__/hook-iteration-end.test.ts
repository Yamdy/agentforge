import { describe, it, expect, beforeEach } from 'vitest';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';

describe('HookManager iteration.end bridging', () => {
  let eventBus: EventBus;
  let manager: HookManager;

  beforeEach(() => {
    eventBus = new EventBus();
    manager = new HookManager(eventBus);
  });

  it('bridges iteration.end hook point to iteration:end event', async () => {
    const events: string[] = [];
    eventBus.subscribe('iteration:end', (data) => {
      events.push('iteration:end');
    });

    await manager.invoke('iteration.end', { step: 1, sessionId: 's1' }, {});

    expect(events).toContain('iteration:end');
  });

  it('emits iteration:end event with step and sessionId data', async () => {
    const captured: unknown[] = [];
    eventBus.subscribe('iteration:end', (data) => {
      captured.push(data);
    });

    await manager.invoke('iteration.end', { step: 2, sessionId: 'test-session' }, {});

    expect(captured).toHaveLength(1);
    const payload = captured[0] as { step: number; sessionId: string };
    expect(payload.step).toBe(2);
    expect(payload.sessionId).toBe('test-session');
  });
});
