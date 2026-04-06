import { v4 as uuidv4 } from 'uuid';
import type { Message } from '../types.js';
import type {
  MemoryManagerConfig,
  MemoryStorage,
  Thread,
  Observation,
  WorkingMemory as WorkingMemoryType,
} from './types.js';
import { MessageHistory } from './message-history.js';
import { WorkingMemory } from './working-memory.js';
import { InMemoryStorage } from './storages/inmemory.js';

export class MemoryManager {
  private config: MemoryManagerConfig;
  private threadId: string;
  private storage: MemoryStorage;
  private messageHistory: MessageHistory;
  private workingMemory?: WorkingMemory;
  private observations: Observation[] = [];
  private loaded: boolean = false;

  constructor(config?: MemoryManagerConfig) {
    this.config = config ?? {};
    this.threadId = config?.threadId ?? `thread_${Date.now()}_${uuidv4().slice(0, 8)}`;
    this.storage = config?.storage ?? new InMemoryStorage();
    this.messageHistory = new MessageHistory(config?.messageHistory);

    if (config?.workingMemory?.enabled) {
      this.workingMemory = new WorkingMemory(config.workingMemory);
    }
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    let thread = await this.storage.getThread(this.threadId);
    if (!thread) {
      thread = {
        id: this.threadId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.storage.saveThread(thread);
    }

    const messages = await this.storage.getMessages(this.threadId);
    messages.forEach((msg) => this.messageHistory.add(msg));

    if (this.workingMemory) {
      const saved = await this.storage.getWorkingMemory(this.threadId);
      if (saved) {
        this.workingMemory.update(saved.content);
      }
    }

    if (this.config.observationalMemory?.enabled) {
      const saved = await this.storage.getObservationalMemory?.(this.threadId);
      if (saved) {
        this.observations = saved;
      }
    }

    this.loaded = true;
  }

  async save(): Promise<void> {
    await this.storage.saveThread({
      id: this.threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const messages = this.messageHistory.getMessages();
    for (const msg of messages) {
      await this.storage.addMessage(this.threadId, msg);
    }

    if (this.workingMemory) {
      await this.storage.saveWorkingMemory(this.threadId, this.workingMemory.get());
    }

    if (this.config.observationalMemory?.enabled) {
      await this.storage.saveObservationalMemory?.(this.threadId, this.observations);
    }
  }

  addMessage(message: Message): void {
    this.messageHistory.add(message);
  }

  getMessages(): Message[] {
    return this.messageHistory.getMessages();
  }

  getWorkingMemory(): WorkingMemoryType | null {
    return this.workingMemory?.get() ?? null;
  }

  updateWorkingMemory(content: string): void {
    if (this.workingMemory) {
      this.workingMemory.update(content);
    }
  }

  getObservationalMemory(): Observation[] | null {
    if (!this.config.observationalMemory?.enabled) return null;
    return [...this.observations];
  }

  addObservation(observation: Omit<Observation, 'id' | 'timestamp'>): void {
    if (!this.config.observationalMemory?.enabled) return;

    this.observations.push({
      id: uuidv4(),
      timestamp: new Date(),
      ...observation,
    });
  }

  clear(): void {
    this.messageHistory.clear();
    this.observations = [];
  }
}

export function createMemory(config?: MemoryManagerConfig): MemoryManager {
  return new MemoryManager(config);
}
