import { v4 as uuidv4 } from 'uuid';
import type { Message, HistoryManager } from '../types.js';
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

export class MemoryManager implements HistoryManager {
  private config: MemoryManagerConfig;
  private threadId: string;
  private storage: MemoryStorage;
  private messageHistory: MessageHistory;
  private workingMemory?: WorkingMemory;
  private observations: Observation[] = [];
  private loaded: boolean = false;
  private loadPromise: Promise<void> | null = null;
  private savePromise: Promise<void> | null = null;

  constructor(config?: MemoryManagerConfig) {
    this.config = config ?? {};
    this.threadId = config?.threadId ?? `thread_${Date.now()}_${uuidv4().slice(0, 8)}`;
    this.storage = config?.storage ?? new InMemoryStorage();
    this.messageHistory = new MessageHistory(config?.messageHistory);

    if (config?.workingMemory?.enabled) {
      this.workingMemory = new WorkingMemory(config.workingMemory);
    }
  }

  get threadIdField(): string {
    return this.threadId;
  }

  get storageField(): MemoryStorage {
    return this.storage;
  }

  get workingMemoryField(): WorkingMemory | undefined {
    return this.workingMemory;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this._doLoad();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async _doLoad(): Promise<void> {
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
    if (this.savePromise) return this.savePromise;

    this.savePromise = this._doSave();
    try {
      await this.savePromise;
    } finally {
      this.savePromise = null;
    }
  }

  private async _doSave(): Promise<void> {
    const existingThread = await this.storage.getThread(this.threadId);
    await this.storage.saveThread({
      id: this.threadId,
      createdAt: existingThread?.createdAt ?? new Date(),
      updatedAt: new Date(),
    });

    const existingMessages = await this.storage.getMessages(this.threadId);
    const currentMessages = this.messageHistory.getMessages();

    if (existingThread) {
      const newMessageCount = currentMessages.length - existingMessages.length;
      if (newMessageCount > 0) {
        const newMessages = currentMessages.slice(existingMessages.length);
        for (const msg of newMessages) {
          await this.storage.addMessage(this.threadId, msg);
        }
      } else if (newMessageCount < 0) {
        const overwriteMessages = currentMessages.slice();
        for (const msg of overwriteMessages) {
          await this.storage.addMessage(this.threadId, msg);
        }
      }
    } else {
      for (const msg of currentMessages) {
        await this.storage.addMessage(this.threadId, msg);
      }
    }

    if (this.workingMemory) {
      await this.storage.saveWorkingMemory(this.threadId, this.workingMemory.get());
    }

    if (this.config.observationalMemory?.enabled) {
      await this.storage.saveObservationalMemory?.(this.threadId, this.observations);
    }
  }

  add(role: 'user' | 'assistant' | 'tool', content: string): void {
    this.messageHistory.add({ role, content });
  }

  addToolResult(toolCallId: string, toolName: string, result: string): void {
    this.messageHistory.add({
      role: 'tool',
      content: result,
      toolCallId,
      toolName,
    });
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

  isLoaded(): boolean {
    return this.loaded;
  }
}

export function createMemory(config?: MemoryManagerConfig): MemoryManager {
  return new MemoryManager(config);
}
