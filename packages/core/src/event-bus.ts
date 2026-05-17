export class EventBus {
  private handlers = new Map<string, Set<(data?: unknown) => void>>();

  constructor(private onError?: (error: unknown, eventType: string) => void) {
    if (!this.onError) {
      this.onError = (error: unknown, eventType: string) => {
        console.error(`[EventBus] Unhandled error in "${eventType}" handler:`, error);
      };
    }
  }

  emit(eventType: string, data?: unknown): void {
    const set = this.handlers.get(eventType);
    if (set) {
      for (const handler of set) {
        try {
          handler(data);
        } catch (err) {
          // isolate handler errors — one failing handler must not prevent others from running
          this.onError?.(err, eventType);
        }
      }
    }
  }

  subscribe(eventType: string, handler: (data?: unknown) => void): () => void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Remove a specific handler for an event type. */
  unsubscribe(eventType: string, handler: (data?: unknown) => void): void {
    const set = this.handlers.get(eventType);
    if (set) {
      set.delete(handler);
    }
  }

  /** Register a handler that fires at most once, then auto-unsubscribes. */
  once(eventType: string, handler: (data?: unknown) => void): void {
    const wrapped = (data?: unknown) => {
      handler(data);
      this.unsubscribe(eventType, wrapped);
    };
    this.subscribe(eventType, wrapped);
  }

  /** Promise-based once: returns a Promise that resolves on the next emission. */
  oncePromise(eventType: string): Promise<unknown> {
    return new Promise((resolve) => {
      const unsub = this.subscribe(eventType, (data) => {
        unsub();
        resolve(data);
      });
    });
  }
}
