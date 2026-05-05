/**
 * AgentForge Skill Hot-Reload Watcher
 *
 * Monitors skill directories for file changes and triggers automatic reload.
 * Uses Node.js native fs.watch for zero-dependency file watching.
 *
 * Design principles:
 * - Errors are isolated (never crash the watcher)
 * - Debounce prevents rapid file change storms
 * - Callback-based API for event subscription
 *
 */

import { watch, type FSWatcher } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import type { SkillInfo } from './types.js';
import { loadSkill, type SkillLoaderConfig } from './loader.js';
import type { SkillReloadHook } from './hooks.js';

// ============================================================
// Watcher Events
// ============================================================

/**
 * Skill reload event types
 */
export type SkillReloadEventType = 'added' | 'changed' | 'removed';

/**
 * Skill reload event
 */
export interface SkillReloadEvent {
  /** Event type */
  type: SkillReloadEventType;
  /** Skill file path that triggered the event */
  filePath: string;
  /** Skill name (if successfully loaded) */
  skillName?: string;
  /** Loaded skill info (for added/changed events) */
  skill?: SkillInfo;
  /** Error info (if reload failed) */
  error?: string;
}

/**
 * Watcher status
 */
export type WatcherStatus = 'idle' | 'watching' | 'stopped' | 'error';

// ============================================================
// Watcher Configuration
// ============================================================

/**
 * Skill watcher configuration
 */
export interface SkillWatcherConfig {
  /** Directories to watch */
  directories: string[];
  /** Skill file name to watch (default: SKILL.md) */
  skillFileName?: string;
  /** Debounce time in milliseconds (default: 300) */
  debounceMs?: number;
  /** Enable recursive watching */
  recursive?: boolean;
  /** Loader configuration */
  loaderConfig?: SkillLoaderConfig;
  /** Hooks for reload lifecycle */
  hooks?: SkillReloadHook[];
  /** Enable debug logging */
  debug?: boolean;
}

const DEFAULT_WATCHER_CONFIG: Required<
  Omit<SkillWatcherConfig, 'directories' | 'loaderConfig' | 'hooks'>
> = {
  skillFileName: 'SKILL.md',
  debounceMs: 300,
  recursive: true,
  debug: false,
};

// ============================================================
// Skill Watcher
// ============================================================

/**
 * Monitors skill directories for changes and triggers automatic reload.
 *
 * Uses Node.js native fs.watch API with:
 * - Debounce to prevent rapid re-reloads
 * - Callback-based API
 * - Hook system for customization
 *
 * @example
 * ```typescript
 * const watcher = new SkillWatcher({
 *   directories: ['./skills'],
 *   onReload: (event) => console.log('Reloaded:', event.skillName),
 * });
 *
 * const unsub = watcher.onReload((event) => {
 *   console.log(`${event.type}: ${event.filePath}`);
 * });
 *
 * await watcher.start();
 *
 * // Later...
 * watcher.stop();
 * unsub();
 * ```
 */
export class SkillWatcher {
  private config: Required<Omit<SkillWatcherConfig, 'directories' | 'loaderConfig' | 'hooks'>> & {
    directories: string[];
    loaderConfig: SkillLoaderConfig;
    hooks: SkillReloadHook[];
  };

  private watchers: Map<string, FSWatcher> = new Map();
  private status: WatcherStatus = 'idle';
  private reloadListeners = new Set<(event: SkillReloadEvent) => void>();
  private stopped = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private knownSkills: Map<string, SkillInfo> = new Map();

  constructor(config: SkillWatcherConfig) {
    this.config = {
      ...DEFAULT_WATCHER_CONFIG,
      directories: config.directories ?? [],
      loaderConfig: config.loaderConfig ?? {},
      hooks: config.hooks ?? [],
    };
  }

  /**
   * Subscribe to reload events. Returns unsubscribe function.
   */
  onReload(listener: (event: SkillReloadEvent) => void): () => void {
    this.reloadListeners.add(listener);
    return () => {
      this.reloadListeners.delete(listener);
    };
  }

  /**
   * Get current watcher status
   */
  getStatus(): WatcherStatus {
    return this.status;
  }

  /**
   * Get known skills (cached from last load)
   */
  getKnownSkills(): Map<string, SkillInfo> {
    return new Map(this.knownSkills);
  }

  /**
   * Start watching directories
   */
  async start(): Promise<void> {
    if (this.status === 'watching') {
      return;
    }

    this.status = 'watching';
    this.stopped = false;

    for (const dir of this.config.directories) {
      await this.watchDirectory(dir);
    }

    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log(`[SkillWatcher] Started watching ${this.watchers.size} directories`);
    }
  }

  /**
   * Stop watching all directories
   */
  stop(): void {
    this.status = 'stopped';
    this.stopped = true;

    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Clear per-file debounce timers
    for (const timer of Array.from(this.debounceTimers.values())) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all watchers
    for (const [path, watcher] of Array.from(this.watchers.entries())) {
      try {
        watcher.close();
        if (this.config.debug) {
          // eslint-disable-next-line no-console
          console.log(`[SkillWatcher] Closed watcher for ${path}`);
        }
      } catch {
        // Ignore close errors
      }
    }
    this.watchers.clear();
  }

  /**
   * Watch a single directory
   */
  private async watchDirectory(dir: string): Promise<void> {
    try {
      const resolved = resolve(dir);
      const watcher = watch(resolved, { recursive: this.config.recursive });
      this.watchers.set(resolved, watcher);

      watcher.on('change', (_eventType, filename) => {
        if (filename && filename.toString().endsWith(this.config.skillFileName)) {
          void this.handleFileChange(join(resolved, filename.toString()));
        }
      });

      // Initial scan
      await this.scanDirectory(resolved);
    } catch (error) {
      if (this.config.debug) {
        console.error(`[SkillWatcher] Failed to watch ${dir}:`, error);
      }
    }
  }

  /**
   * Scan directory for skill files
   */
  private async scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && this.config.recursive) {
          await this.scanDirectory(fullPath);
        } else if (entry.isFile() && entry.name === this.config.skillFileName) {
          await this.loadAndAddSkill(fullPath);
        }
      }
    } catch {
      // Ignore scan errors
    }
  }

  /**
   * Handle file change event
   */
  private handleFileChange(filePath: string): void {
    // Debounce per-file
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      filePath,
      setTimeout(() => {
        void (async () => {
          this.debounceTimers.delete(filePath);
          try {
            await stat(filePath);
            // File exists — added or changed
            const result = await loadSkill(filePath, this.config.loaderConfig);
            if (result.success) {
              const name = result.skill.frontmatter.name ?? filePath;
              this.knownSkills.set(name, result.skill);
              this.emitReload({ type: 'changed', filePath, skillName: name, skill: result.skill });
            } else {
              this.emitReload({ type: 'added', filePath });
            }
          } catch {
            // File removed
            if (this.knownSkills.has(filePath)) {
              this.knownSkills.delete(filePath);
            }
            this.emitReload({ type: 'removed', filePath });
          }
        })();
      }, 100)
    ); // Per-file debounce
  }

  /**
   * Load and add a skill
   */
  private async loadAndAddSkill(filePath: string): Promise<void> {
    try {
      const result = await loadSkill(filePath, this.config.loaderConfig);
      if (result.success) {
        const name = result.skill.frontmatter.name ?? filePath;
        this.knownSkills.set(name, result.skill);
      }
    } catch {
      // Ignore load errors during scan
    }
  }

  /**
   * Emit a reload event with global debounce
   */
  private emitReload(event: SkillReloadEvent): void {
    if (this.stopped || this.status !== 'watching') return;

    // Global debounce: reset timer on each event, fire after debounceMs
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.stopped || this.status !== 'watching') return;
      for (const listener of this.reloadListeners) {
        try {
          listener(event);
        } catch (err) {
          console.warn('[SkillWatcher] Reload listener error:', err);
        }
      }
    }, this.config.debounceMs);
  }
}

// ============================================================
// Convenience Functions
// ============================================================

/**
 * Create a skill watcher for a single directory
 */
export function createSkillWatcher(
  directory: string,
  options: Omit<SkillWatcherConfig, 'directories'> = {}
): SkillWatcher {
  return new SkillWatcher({
    ...options,
    directories: [directory],
  });
}

/**
 * Watch skills with a callback listener. Returns { watcher, unsub }.
 * Auto-starts watching.
 */
export function watchSkills(
  directories: string[],
  listener: (event: SkillReloadEvent) => void,
  options: Omit<SkillWatcherConfig, 'directories'> = {}
): { watcher: SkillWatcher; unsub: () => void } {
  const watcher = new SkillWatcher({
    ...options,
    directories,
  });

  const unsub = watcher.onReload(listener);

  watcher.start().catch(() => {
    // Ignore start errors
  });

  return { watcher, unsub };
}
