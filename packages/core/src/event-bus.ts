type Handler = (data?: unknown) => void;
type AsyncHandler = (data?: unknown) => Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();
  private asyncHandlers = new Map<string, Set<AsyncHandler>>();

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

  subscribe(eventType: string, handler: Handler): () => void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Remove a specific handler for an event type. */
  unsubscribe(eventType: string, handler: Handler): void {
    const set = this.handlers.get(eventType);
    if (set) {
      set.delete(handler);
    }
  }

  /** Register a handler that fires at most once, then auto-unsubscribes. */
  once(eventType: string, handler: Handler): void {
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

  /**
   * Register an async handler that is invoked by `emitAsync`.
   * Returns an unsubscribe function.
   */
  subscribeAsync(eventType: string, handler: AsyncHandler): () => void {
    let set = this.asyncHandlers.get(eventType);
    if (!set) {
      set = new Set();
      this.asyncHandlers.set(eventType, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /**
   * Emit an event asynchronously. Awaits all sync and async handlers via
   * Promise.allSettled — one failing handler does not prevent others from running.
   * Sync handlers (subscribed via `subscribe()`) are wrapped in Promise.resolve
   * and participate in allSettled alongside async handlers.
   * Errors are reported through the onError callback.
   */
  async emitAsync(eventType: string, data?: unknown): Promise<void[]> {
    const promises: Promise<void>[] = [];

    // Sync handlers — wrap in async function to catch synchronous throws
    const syncSet = this.handlers.get(eventType);
    if (syncSet) {
      for (const handler of syncSet) {
        promises.push((async () => handler(data))());
      }
    }

    // Async handlers
    const asyncSet = this.asyncHandlers.get(eventType);
    if (asyncSet) {
      for (const handler of asyncSet) {
        promises.push(handler(data));
      }
    }

    const results = await Promise.allSettled(promises);

    // Report errors through the configured callback
    for (const result of results) {
      if (result.status === 'rejected') {
        this.onError?.(result.reason, eventType);
      }
    }

    return results.map(() => undefined);
  }
}
