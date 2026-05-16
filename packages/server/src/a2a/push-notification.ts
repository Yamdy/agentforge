export interface NotificationRegistry {
  register(taskId: string, url: string): void;
  unregister(taskId: string): void;
  get(taskId: string): string | undefined;
  list(): string[];
}

export class InMemoryNotificationRegistry implements NotificationRegistry {
  private store = new Map<string, string>();

  register(taskId: string, url: string): void {
    this.store.set(taskId, url);
  }

  unregister(taskId: string): void {
    this.store.delete(taskId);
  }

  get(taskId: string): string | undefined {
    return this.store.get(taskId);
  }

  list(): string[] {
    return [...this.store.keys()];
  }
}
