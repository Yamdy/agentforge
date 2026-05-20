/**
 * Latch - a synchronization primitive for Shell mode interrupt-resume
 */

export class Latch {
  private released = false;
  private waiters: Array<() => void> = [];

  release(): void {
    this.released = true;
    for (const w of this.waiters) w();
    this.waiters = [];
  }

  async await(): Promise<void> {
    if (this.released) return;
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}
