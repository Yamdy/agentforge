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

  it('throwing handler does not prevent other handlers from executing', () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribe('evt', () => { throw new Error('boom'); });
    bus.subscribe('evt', (data) => received.push(data));

    expect(() => bus.emit('evt', 'payload')).not.toThrow();
    expect(received).toEqual(['payload']);
  });

  it('all handlers run even when multiple throw', () => {
    const bus = new EventBus();
    let count = 0;

    bus.subscribe('evt', () => { throw new Error('a'); });
    bus.subscribe('evt', () => { count++; });
    bus.subscribe('evt', () => { throw new Error('b'); });
    bus.subscribe('evt', () => { count++; });

    bus.emit('evt');
    expect(count).toBe(2);
  });

  it('calls onError callback when handler throws', () => {
    const errors: Array<{ error: unknown; eventType: string }> = [];
    const bus = new EventBus((error, eventType) => errors.push({ error, eventType }));

    bus.subscribe('evt', () => { throw new Error('boom'); });
    bus.emit('evt');

    expect(errors).toHaveLength(1);
    expect(errors[0].eventType).toBe('evt');
    expect((errors[0].error as Error).message).toBe('boom');
  });
});
