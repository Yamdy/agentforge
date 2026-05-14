export class EventBus {
  private handlers = new Map<string, Set<(data?: unknown) => void>>();

  constructor(private onError?: (error: unknown, eventType: string) => void) {}

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
}
