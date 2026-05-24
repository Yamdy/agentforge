import type { MutabilityPolicyEngine } from './mutability-policy.js';
import { readFileSync, watch } from 'node:fs';

type ConfigChangeHandler = (newConfig: Record<string, unknown>) => void;

export interface ConfigWatcherOptions {
  configPath: string;
  debounceMs?: number;
  fileReader?: (path: string) => Promise<string>;
  policy?: MutabilityPolicyEngine;
}

export class ConfigWatcher {
  private configPath: string;
  private debounceMs: number;
  private fileReader: (path: string) => Promise<string>;
  private policy?: MutabilityPolicyEngine;
  private _isWatching = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private changeHandlers: ConfigChangeHandler[] = [];
  private fsWatcher: import('node:fs').FSWatcher | null = null;

  constructor(options: ConfigWatcherOptions) {
    this.configPath = options.configPath;
    this.debounceMs = options.debounceMs ?? 300;
    this.fileReader = options.fileReader ?? ((path: string) =>
      Promise.resolve(readFileSync(path, 'utf-8')));
    this.policy = options.policy;
  }

  get isWatching(): boolean {
    return this._isWatching;
  }

  start(): void {
    if (this.policy && !this.policy.policy.watchConfig) {
      return;
    }
    this._isWatching = true;
    try {
      this.fsWatcher = watch(this.configPath, () => {
        this.scheduleReload();
      });
    } catch {
      // fs.watch may fail in test environments
    }
  }

  stop(): void {
    this._isWatching = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }

  onConfigChange(handler: ConfigChangeHandler): () => void {
    this.changeHandlers.push(handler);
    return () => {
      const idx = this.changeHandlers.indexOf(handler);
      if (idx >= 0) this.changeHandlers.splice(idx, 1);
    };
  }

  async simulateChange(immediate?: boolean): Promise<void> {
    if (immediate) {
      await this.reload();
    } else {
      this.scheduleReload();
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      await this.reload();
    }, this.debounceMs);
  }

  private async reload(): Promise<void> {
    try {
      const content = await this.fileReader(this.configPath);
      const config = JSON.parse(content) as Record<string, unknown>;
      for (const handler of this.changeHandlers) {
        handler(config);
      }
    } catch {
      // Silently ignore parse errors during hot reload
    }
  }
}
