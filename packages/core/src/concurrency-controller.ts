import type { ConcurrencySlot } from '@agentforge/sdk';

interface SlotState {
  current: number;
  max: number;
  waiters: Array<() => void>;
}

export class ConcurrencyController {
  private slots = new Map<string, SlotState>();

  constructor(slotDefs: ConcurrencySlot[]) {
    for (const { key, maxConcurrent } of slotDefs) {
      this.slots.set(key, { current: 0, max: maxConcurrent, waiters: [] });
    }
  }

  acquire(slotKey: string, timeoutMs?: number): Promise<() => void> {
    const slot = this.slots.get(slotKey);
    if (!slot) {
      return Promise.reject(new Error(`Unknown concurrency slot: ${slotKey}`));
    }

    if (slot.current < slot.max) {
      slot.current++;
      let released = false;
      return Promise.resolve(() => {
        if (released) return;
        released = true;
        this.releaseSlot(slot);
      });
    }

    let waiterRef: (() => void) | null = null;

    const acquirePromise = new Promise<() => void>((resolve) => {
      const waiter = () => {
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.releaseSlot(slot);
        });
      };
      waiterRef = waiter;
      slot.waiters.push(waiter);
    });

    if (timeoutMs == null) {
      return acquirePromise;
    }

    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Remove our waiter from the queue so it doesn't leak
        if (waiterRef) {
          const idx = slot.waiters.indexOf(waiterRef);
          if (idx !== -1) slot.waiters.splice(idx, 1);
        }
        reject(new Error(`Concurrency acquire timed out for slot "${slotKey}" after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([acquirePromise, timeoutPromise]).finally(() => {
      clearTimeout(timer);
      // If acquire won the race, the waiter was already consumed — nothing to clean.
      // If timeout won, we already removed it above.
    });
  }

  getActiveCount(slotKey: string): number {
    const slot = this.slots.get(slotKey);
    return slot ? slot.current : 0;
  }

  private releaseSlot(slot: SlotState): void {
    slot.current--;
    if (slot.waiters.length > 0) {
      const next = slot.waiters.shift()!;
      slot.current++;
      next();
    }
  }
}
