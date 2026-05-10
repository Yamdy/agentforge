import type { EvictionStorage } from '@agentforge/sdk';

export class InMemoryEvictionStorage implements EvictionStorage {
  private data = new Map<string, unknown>();

  async store(sessionId: string, key: string, content: unknown): Promise<string> {
    const ref = `${sessionId}:${key}:${Date.now()}`;
    this.data.set(ref, content);
    return ref;
  }

  async retrieve(_sessionId: string, reference: string): Promise<unknown> {
    return this.data.get(reference);
  }
}
