import type { Message } from '../types.js';
import type { MessageHistoryConfig } from './types.js';

export class MessageHistory {
  private messages: Message[] = [];
  private config: Required<MessageHistoryConfig>;

  constructor(config?: MessageHistoryConfig) {
    this.config = {
      lastMessages: config?.lastMessages ?? 20,
    };
  }

  add(message: Message): void {
    this.messages.push(message);
    this.trim();
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  private trim(): void {
    if (this.messages.length > this.config.lastMessages) {
      const excess = this.messages.length - this.config.lastMessages;
      this.messages = this.messages.slice(excess);
    }
  }
}
