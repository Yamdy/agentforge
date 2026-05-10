import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/event-bus.js';

describe('EventBus', () => {
  it('subscribers receive emitted events', () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribe('agent:start', (data) => received.push(data));
    bus.emit('agent:start', { sessionId: 's1' });

    expect(received).toEqual([{ sessionId: 's1' }]);
  });

  it('unsubscribe stops receiving events', () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    const unsub = bus.subscribe('agent:start', (data) => received.push(data));
    bus.emit('agent:start', 'first');
    unsub();
    bus.emit('agent:start', 'second');

    expect(received).toEqual(['first']);
  });

  it('emit with no subscribers does not throw', () => {
    const bus = new EventBus();
    expect(() => bus.emit('agent:end', { status: 'ok' })).not.toThrow();
  });
});
