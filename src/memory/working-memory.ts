import type { WorkingMemoryConfig, WorkingMemory as WorkingMemoryType } from './types.js';

export class WorkingMemory {
  private _content: string;
  private _updatedAt: Date;
  private config: WorkingMemoryConfig;

  constructor(config: WorkingMemoryConfig) {
    this.config = config;
    this._content = config.template ?? '';
    this._updatedAt = new Date();
  }

  get content(): string {
    return this._content;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  update(content: string): void {
    this._content = content;
    this._updatedAt = new Date();
  }

  get(): WorkingMemoryType {
    return {
      content: this._content,
      updatedAt: this._updatedAt,
    };
  }
}
