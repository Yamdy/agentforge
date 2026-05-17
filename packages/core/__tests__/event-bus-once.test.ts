import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/event-bus.js';

describe('EventBus.once()', () => {
  it('returns Promise that resolves on first event', async () => {
    const bus = new EventBus();

    const promise = bus.once('test:event');

    // Emit after subscribing
    bus.emit('test:event', { value: 42 });

    const result = await promise;
    expect(result).toEqual({ value: 42 });
  });

  it('auto-unsubscribes after resolution', async () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    // Set up a persistent subscriber to track all emissions
    bus.subscribe('auto-unsub', (data) => received.push(data));

    const promise = bus.once('auto-unsub');
    bus.emit('auto-unsub', 'first');

    await promise;

    // Emit again — the once() handler should NOT fire again
    bus.emit('auto-unsub', 'second');

    // The persistent subscriber should have gotten both, but once only got the first
    expect(received).toEqual(['first', 'second']);

    // once() promise should have resolved with the first value only
    const result = await promise; // already resolved, returns same value
    expect(result).toBe('first');
  });

  it('multiple once() calls for same event type each get their own resolution', async () => {
    const bus = new EventBus();

    // Register three once() listeners sequentially, emitting between each
    const promise1 = bus.once('seq');
    bus.emit('seq', 'first');

    const promise2 = bus.once('seq');
    bus.emit('seq', 'second');

    const promise3 = bus.once('seq');
    bus.emit('seq', 'third');

    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    // Each once() resolves with the first emission after it was registered
    expect(result1).toBe('first');
    expect(result2).toBe('second');
    expect(result3).toBe('third');
  });

  it('once() on event type with no emissions stays pending', async () => {
    const bus = new EventBus();

    const promise = bus.once('never-emitted');

    // Race with a short timeout to verify it does NOT resolve immediately
    const result = await Promise.race([
      promise.then((val) => ({ resolved: true, value: val })),
      new Promise((resolve) => setTimeout(() => resolve({ resolved: false }), 50)),
    ]);

    expect((result as { resolved: boolean }).resolved).toBe(false);
  });
});
