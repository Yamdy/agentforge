import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Runner } from '../src/runner.js';
import { Latch } from '../src/latch.js';

describe('Runner', () => {
  let runner: Runner;

  beforeEach(() => {
    runner = new Runner();
  });

  describe('initial state', () => {
    it('starts in Idle state', () => {
      expect(runner.state._tag).toBe('Idle');
    });

    it('is not busy initially', () => {
      expect(runner.busy).toBe(false);
    });
  });

  describe('ensureRunning', () => {
    it('transitions from Idle to Running', async () => {
      const result = await runner.ensureRunning(() => Promise.resolve('done'));
      expect(result).toBe('done');
      expect(runner.state._tag).toBe('Idle');
    });

    it('returns busy=true while running', async () => {
      let busyDuringRun = false;
      await runner.ensureRunning(async () => {
        busyDuringRun = runner.busy;
        return 'done';
      });
      expect(busyDuringRun).toBe(true);
    });

    it('queues subsequent runs when busy', async () => {
      const order: string[] = [];
      const p1 = runner.ensureRunning(async () => {
        order.push('start1');
        await new Promise(r => setTimeout(r, 50));
        order.push('end1');
        return 'r1';
      });
      const p2 = runner.ensureRunning(async () => {
        order.push('start2');
        return 'r2';
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('r1');
      expect(r2).toBe('r2');
      expect(order).toEqual(['start1', 'end1', 'start2']);
    });
  });

  describe('startShell', () => {
    it('transitions to Shell state', async () => {
      const latch = new Latch();
      const p = runner.startShell(async () => {
        await latch.await();
        return 'shell-done';
      });

      expect(runner.state._tag).toBe('Shell');
      latch.release();

      const result = await p;
      expect(result).toBe('shell-done');
    });

    it('throws if already busy', async () => {
      runner.ensureRunning(async () => {
        await new Promise(r => setTimeout(r, 100));
        return 'running';
      });

      await expect(runner.startShell(() => Promise.resolve('shell'))).rejects.toThrow('busy');
    });

    it('can be interrupted via cancel', async () => {
      const latch = new Latch();
      const onInterrupt = vi.fn().mockReturnValue('interrupted');

      const p = runner.startShell(
        async () => {
          await latch.await();
          return 'shell-done';
        },
        { onInterrupt }
      );

      await runner.cancel();

      const result = await p;
      expect(result).toBe('interrupted');
      expect(runner.state._tag).toBe('Idle');
    });
  });

  describe('cancel', () => {
    it('does nothing when Idle', async () => {
      await runner.cancel();
      expect(runner.state._tag).toBe('Idle');
    });

    it('cancels running task', async () => {
      const p = runner.ensureRunning(async () => {
        await new Promise(r => setTimeout(r, 1000));
        return 'done';
      });

      setTimeout(() => runner.cancel(), 10);

      await expect(p).rejects.toThrow();
    });
  });

  describe('state transitions', () => {
    it('validates Idle -> Running transition', () => {
      expect(runner.canTransition('Running')).toBe(true);
      expect(runner.canTransition('Shell')).toBe(true);
    });
  });
});

describe('Latch', () => {
  it('blocks await until released', async () => {
    const latch = new Latch();
    let resolved = false;

    const p = latch.await().then(() => { resolved = true; });

    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(false);

    latch.release();
    await p;
    expect(resolved).toBe(true);
  });

  it('immediately resolves if already released', async () => {
    const latch = new Latch();
    latch.release();

    let resolved = false;
    await latch.await().then(() => { resolved = true; });
    expect(resolved).toBe(true);
  });

  it('releases all waiters', async () => {
    const latch = new Latch();
    const results: number[] = [];

    const p1 = latch.await().then(() => results.push(1));
    const p2 = latch.await().then(() => results.push(2));

    latch.release();
    await Promise.all([p1, p2]);

    expect(results).toHaveLength(2);
  });
});
