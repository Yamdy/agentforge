import type {
  MemoryStorage,
  Thread,
  Observation,
  WorkingMemory,
  ListThreadsOptions,
} from '../types.js';
import type { Message } from '../../types.js';

export class InMemoryStorage implements MemoryStorage {
  private threads: Map<string, Thread> = new Map();
  private messages: Map<string, Message[]> = new Map();
  private workingMemories: Map<string, WorkingMemory> = new Map();
  private observations: Map<string, Observation[]> = new Map();

  async getThread(threadId: string): Promise<Thread | null> {
    return this.threads.get(threadId) ?? null;
  }

  async saveThread(thread: Thread): Promise<Thread> {
    this.threads.set(thread.id, thread);
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId);
    this.messages.delete(threadId);
    this.workingMemories.delete(threadId);
    this.observations.delete(threadId);
  }

  async listThreads(options?: ListThreadsOptions): Promise<Thread[]> {
    let threads = Array.from(this.threads.values());
    threads = threads.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (options?.offset) {
      threads = threads.slice(options.offset);
    }
    if (options?.limit) {
      threads = threads.slice(0, options.limit);
    }

    return threads;
  }

  async getMessages(threadId: string): Promise<Message[]> {
    return this.messages.get(threadId) ?? [];
  }

  async addMessage(threadId: string, message: Message): Promise<void> {
    const messages = this.messages.get(threadId) ?? [];
    messages.push(message);
    this.messages.set(threadId, messages);

    const thread = this.threads.get(threadId);
    if (thread) {
      thread.updatedAt = new Date();
      this.threads.set(threadId, thread);
    }
  }

  async getWorkingMemory(threadId: string): Promise<WorkingMemory | null> {
    return this.workingMemories.get(threadId) ?? null;
  }

  async saveWorkingMemory(threadId: string, memory: WorkingMemory): Promise<void> {
    this.workingMemories.set(threadId, memory);
  }

  async getObservationalMemory?(threadId: string): Promise<Observation[] | null> {
    return this.observations.get(threadId) ?? null;
  }

  async saveObservationalMemory?(threadId: string, observations: Observation[]): Promise<void> {
    this.observations.set(threadId, observations);
  }
}
