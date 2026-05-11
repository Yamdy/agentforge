import { describe, it, expect } from 'vitest';
import { ConcurrencyController } from '../src/concurrency-controller.js';

describe('ConcurrencyController', () => {
  it('acquire resolves immediately when under limit', async () => {
    const controller = new ConcurrencyController([
      { key: 'test', maxConcurrent: 2 },
    ]);

    const release = await controller.acquire('test');
    expect(typeof release).toBe('function');
    expect(controller.getActiveCount('test')).toBe(1);
    release();
    expect(controller.getActiveCount('test')).toBe(0);
  });

  it('acquire blocks when at limit, unblocks on release', async () => {
    const controller = new ConcurrencyController([
      { key: 'test', maxConcurrent: 1 },
    ]);

    const release1 = await controller.acquire('test');

    let resolved = false;
    const promise = controller.acquire('test').then((fn) => {
      resolved = true;
      return fn;
    });

    expect(resolved).toBe(false);
    release1();
    const release2 = await promise;
    expect(resolved).toBe(true);
    release2();
  });

  it('release decrements active count', async () => {
    const controller = new ConcurrencyController([
      { key: 'test', maxConcurrent: 3 },
    ]);

    const r1 = await controller.acquire('test');
    const r2 = await controller.acquire('test');
    expect(controller.getActiveCount('test')).toBe(2);

    r1();
    expect(controller.getActiveCount('test')).toBe(1);

    r2();
    expect(controller.getActiveCount('test')).toBe(0);
  });

  it('acquire throws for unknown slot key', async () => {
    const controller = new ConcurrencyController([
      { key: 'known', maxConcurrent: 1 },
    ]);

    await expect(controller.acquire('unknown')).rejects.toThrow(
      'Unknown concurrency slot: unknown',
    );
  });

  it('multiple slots are independent', async () => {
    const controller = new ConcurrencyController([
      { key: 'slot-a', maxConcurrent: 1 },
      { key: 'slot-b', maxConcurrent: 1 },
    ]);

    const releaseA = await controller.acquire('slot-a');
    const releaseB = await controller.acquire('slot-b');

    expect(controller.getActiveCount('slot-a')).toBe(1);
    expect(controller.getActiveCount('slot-b')).toBe(1);

    // slot-b should be free even though slot-a is full
    releaseB();
    expect(controller.getActiveCount('slot-b')).toBe(0);
    expect(controller.getActiveCount('slot-a')).toBe(1);

    releaseA();
    expect(controller.getActiveCount('slot-a')).toBe(0);
  });

  it('getActiveCount returns current count', async () => {
    const controller = new ConcurrencyController([
      { key: 'test', maxConcurrent: 5 },
    ]);

    expect(controller.getActiveCount('test')).toBe(0);
    expect(controller.getActiveCount('nonexistent')).toBe(0);

    const r1 = await controller.acquire('test');
    await controller.acquire('test');
    expect(controller.getActiveCount('test')).toBe(2);

    r1();
    expect(controller.getActiveCount('test')).toBe(1);
  });

  it('double release is a no-op', async () => {
    const controller = new ConcurrencyController([
      { key: 'test', maxConcurrent: 2 },
    ]);

    const release = await controller.acquire('test');
    release();
    expect(controller.getActiveCount('test')).toBe(0);

    // Second release should not go negative
    release();
    expect(controller.getActiveCount('test')).toBe(0);
  });

  it('unblocks multiple waiters in order', async () => {
    const controller = new ConcurrencyController([
      { key: 'test', maxConcurrent: 1 },
    ]);

    const release1 = await controller.acquire('test');

    const order: number[] = [];
    const p2 = controller.acquire('test').then((r) => { order.push(2); return r; });
    const p3 = controller.acquire('test').then((r) => { order.push(3); return r; });

    expect(order).toEqual([]);
    release1();

    const release2 = await p2;
    release2();
    const release3 = await p3;
    release3();

    expect(order).toEqual([2, 3]);
  });
});
