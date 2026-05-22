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

describe('EventBus — async emit (emitAsync / subscribeAsync)', () => {
  it('subscribeAsync handler is called by emitAsync', async () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribeAsync('evt', async (data) => { received.push(data); });
    await bus.emitAsync('evt', 'hello');

    expect(received).toEqual(['hello']);
  });

  it('emitAsync awaits async handlers before resolving', async () => {
    const bus = new EventBus();
    let order = 0;

    bus.subscribeAsync('evt', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order = 2;
    });

    order = 1;
    await bus.emitAsync('evt');
    expect(order).toBe(2);
  });

  it('sync subscribe handlers are also called by emitAsync', async () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribe('evt', (data) => received.push(data));
    bus.subscribeAsync('evt', async (data) => { received.push(data); });
    await bus.emitAsync('evt', 'val');

    expect(received).toEqual(['val', 'val']);
  });

  it('emitAsync uses Promise.allSettled — one failing handler does not prevent others', async () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribeAsync('evt', async () => { throw new Error('fail'); });
    bus.subscribeAsync('evt', async (data) => { received.push(data); });

    // Should not throw — allSettled isolates failures
    const result = await bus.emitAsync('evt', 'ok');
    expect(received).toEqual(['ok']);
    expect(Array.isArray(result)).toBe(true);
  });

  it('failing sync handler in emitAsync does not prevent async handlers', async () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribe('evt', () => { throw new Error('sync fail'); });
    bus.subscribeAsync('evt', async (data) => { received.push(data); });

    const result = await bus.emitAsync('evt', 'payload');
    expect(received).toEqual(['payload']);
  });

  it('reports errors from async handlers via onError callback', async () => {
    const errors: Array<{ error: unknown; eventType: string }> = [];
    const bus = new EventBus((error, eventType) => errors.push({ error, eventType }));

    bus.subscribeAsync('evt', async () => { throw new Error('async boom'); });
    await bus.emitAsync('evt');

    expect(errors).toHaveLength(1);
    expect(errors[0].eventType).toBe('evt');
    expect((errors[0].error as Error).message).toBe('async boom');
  });

  it('reports errors from sync handlers via onError callback in emitAsync', async () => {
    const errors: Array<{ error: unknown; eventType: string }> = [];
    const bus = new EventBus((error, eventType) => errors.push({ error, eventType }));

    bus.subscribe('evt', () => { throw new Error('sync boom'); });
    await bus.emitAsync('evt');

    expect(errors).toHaveLength(1);
    expect(errors[0].eventType).toBe('evt');
    expect((errors[0].error as Error).message).toBe('sync boom');
  });

  it('emitAsync with no subscribers does not throw', async () => {
    const bus = new EventBus();
    await expect(bus.emitAsync('no-subs', { x: 1 })).resolves.toEqual([]);
  });

  it('unsubscribe for async handler stops it from receiving events', async () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    const unsub = bus.subscribeAsync('evt', async (data) => { received.push(data); });
    await bus.emitAsync('evt', 'first');
    unsub();
    await bus.emitAsync('evt', 'second');

    expect(received).toEqual(['first']);
  });

  it('original sync emit is unaffected by subscribeAsync', () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribeAsync('evt', async () => { received.push('async'); });
    bus.subscribe('evt', (data) => received.push(data));

    // sync emit should only call sync handlers
    bus.emit('evt', 'x');
    expect(received).toEqual(['x']);
  });

  it('multiple async handlers all execute and settle', async () => {
    const bus = new EventBus();
    const order: number[] = [];

    bus.subscribeAsync('evt', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    bus.subscribeAsync('evt', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
    });
    bus.subscribeAsync('evt', async () => {
      order.push(3);
    });

    await bus.emitAsync('evt');
    expect(order.sort()).toEqual([1, 2, 3]);
  });
});
