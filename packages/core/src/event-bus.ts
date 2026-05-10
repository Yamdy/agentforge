export class EventBus {
  private handlers = new Map<string, Set<(data?: unknown) => void>>();

  emit(eventType: string, data?: unknown): void {
    const set = this.handlers.get(eventType);
    if (set) {
      for (const handler of set) handler(data);
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
