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

  acquire(slotKey: string): Promise<() => void> {
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

    return new Promise<() => void>((resolve) => {
      slot.waiters.push(() => {
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.releaseSlot(slot);
        });
      });
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
