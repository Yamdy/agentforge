/**
 * AgentForge Skill Hot-Reload Watcher
 *
 * Monitors skill directories for file changes and triggers automatic reload.
 * Uses Node.js native fs.watch for zero-dependency file watching.
 *
 * Design principles:
 * - Errors are isolated (never crash the watcher)
 * - Debounce prevents rapid file change storms
 * - Observable-based API for event stream integration
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import { watch, type FSWatcher } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { Subject, Observable } from 'rxjs';
import { debounceTime, takeUntil, filter } from 'rxjs/operators';
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

const DEFAULT_WATCHER_CONFIG: Required<Omit<SkillWatcherConfig, 'directories' | 'loaderConfig' | 'hooks'>> = {
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
 * - Event-based API via Observable
 * - Hook system for customization
 *
 * @example
 * ```typescript
 * const watcher = new SkillWatcher({
 *   directories: ['./skills'],
 *   onReload: (event) => console.log('Reloaded:', event.skillName),
 * });
 *
 * const subscription = watcher.events$.subscribe((event) => {
 *   console.log(`${event.type}: ${event.filePath}`);
 * });
 *
 * await watcher.start();
 *
 * // Later...
 * watcher.stop();
 * subscription.unsubscribe();
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
  private reloadSubject = new Subject<SkillReloadEvent>();
  /** Internal stop signal (accessible for extension) */
  protected stopSubject = new Subject<void>();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private knownSkills: Map<string, SkillInfo> = new Map();

  /** Observable of reload events */
  readonly events$: Observable<SkillReloadEvent>;

  constructor(config: SkillWatcherConfig) {
    this.config = {
      ...DEFAULT_WATCHER_CONFIG,
      directories: config.directories ?? [],
      loaderConfig: config.loaderConfig ?? {},
      hooks: config.hooks ?? [],
    };

    // Create debounced event stream
    this.events$ = this.reloadSubject.asObservable().pipe(
      debounceTime(this.config.debounceMs),
      takeUntil(this.stopSubject.asObservable()),
      filter(() => this.status === 'watching')
    );
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

    for (const dir of this.config.directories) {
      await this.watchDirectory(dir);
    }

    if (this.config.debug) {
      console.log(`[SkillWatcher] Started watching ${this.watchers.size} directories`);
    }
  }

  /**
   * Stop watching all directories
   */
  stop(): void {
    this.status = 'stopped';

    // Clear debounce timers
    for (const timer of Array.from(this.debounceTimers.values())) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all watchers
    for (const [path, watcher] of Array.from(this.watchers.entries())) {
      try {
        watcher.close();
        if (this.config.debug) {
          console.log(`[SkillWatcher] Closed watcher for ${path}`);
        }
      } catch {
        // Ignore close errors
      }
    }
    this.watchers.clear();

    // Signal stop
    this.stopSubject.next();
  }

  /**
   * Watch a single directory
   */
  private async watchDirectory(dir: string): Promise<void> {
    const absoluteDir = resolve(dir);

    try {
      // Check if directory exists
      const dirStat = await stat(absoluteDir);
      if (!dirStat.isDirectory()) {
        if (this.config.debug) {
          console.warn(`[SkillWatcher] Not a directory: ${absoluteDir}`);
        }
        return;
      }

      // Initial scan to discover existing skills
      await this.scanDirectory(absoluteDir);

      // Watch the directory
      const watcher = watch(
        absoluteDir,
        { recursive: this.config.recursive },
        (eventType, filename) => {
          this.handleFileEvent(absoluteDir, eventType, filename);
        }
      );

      watcher.on('error', (error) => {
        this.handleWatchError(absoluteDir, error);
      });

      this.watchers.set(absoluteDir, watcher);

      if (this.config.debug) {
        console.log(`[SkillWatcher] Watching ${absoluteDir}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.config.debug) {
        console.warn(`[SkillWatcher] Failed to watch ${absoluteDir}: ${message}`);
      }
    }
  }

  /**
   * Scan directory for existing skills
   */
  private async scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const skillPath = join(dir, entry.name, this.config.skillFileName);
        const result = await loadSkill(skillPath, this.config.loaderConfig);

        if (result.success) {
          this.knownSkills.set(skillPath, result.skill);
        }
      }
    } catch {
      // Ignore scan errors
    }
  }

  /**
   * Handle file system event
   */
  private handleFileEvent(watchDir: string, eventType: string, filename: string | null): void {
    if (!filename) return;

    // Only process skill files
    if (!filename.endsWith(this.config.skillFileName)) {
      // Check if it's a directory change that might contain skill files
      if (eventType === 'rename') {
        const fullPath = join(watchDir, filename);
        this.checkAndWatchDirectory(fullPath);
      }
      return;
    }

    const filePath = join(watchDir, filename);

    // Debounce file changes
    this.debounceReload(filePath, eventType);
  }

  /**
   * Check if path is a directory and watch it
   */
  private async checkAndWatchDirectory(path: string): Promise<void> {
    try {
      const pathStat = await stat(path);
      if (pathStat.isDirectory() && !this.watchers.has(path)) {
        await this.watchDirectory(path);
      }
    } catch {
      // Path doesn't exist or not accessible
    }
  }

  /**
   * Debounce reload to prevent rapid-fire events
   */
  private debounceReload(filePath: string, _eventType: string): void {
    // Clear existing timer
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processReload(filePath);
    }, this.config.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Process a file reload
   */
  private async processReload(filePath: string): Promise<void> {
    if (this.status !== 'watching') return;

    try {
      // Check if file was removed
      try {
        await stat(filePath);
      } catch {
        // File doesn't exist - removal event
        const previousSkill = this.knownSkills.get(filePath);
        this.knownSkills.delete(filePath);

        const event: SkillReloadEvent = {
          type: 'removed',
          filePath,
        };

        if (previousSkill) {
          event.skillName = previousSkill.frontmatter.name;
        }

        await this.executeBeforeReloadHooks(event);
        this.reloadSubject.next(event);
        await this.executeAfterReloadHooks(event);
        return;
      }

      // Load the skill
      const result = await loadSkill(filePath, this.config.loaderConfig);

      if (result.success) {
        const previousSkill = this.knownSkills.get(filePath);
        const eventType: SkillReloadEventType = previousSkill ? 'changed' : 'added';

        const event: SkillReloadEvent = {
          type: eventType,
          filePath,
          skillName: result.skill.frontmatter.name,
          skill: result.skill,
        };

        this.knownSkills.set(filePath, result.skill);

        await this.executeBeforeReloadHooks(event);
        this.reloadSubject.next(event);
        await this.executeAfterReloadHooks(event);

        if (this.config.debug) {
          console.log(`[SkillWatcher] ${eventType}: ${result.skill.frontmatter.name} (${filePath})`);
        }
      } else {
        // Load failed - result is narrowed to error case
        const event: SkillReloadEvent = {
          type: 'changed',
          filePath,
          error: result.error,
        };

        await this.executeBeforeReloadHooks(event);
        this.reloadSubject.next(event);
        await this.executeAfterReloadHooks(event);

        if (this.config.debug) {
          console.warn(`[SkillWatcher] Failed to reload ${filePath}: ${result.error}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const event: SkillReloadEvent = {
        type: 'changed',
        filePath,
        error: `Reload error: ${message}`,
      };

      await this.executeBeforeReloadHooks(event);
      this.reloadSubject.next(event);
      await this.executeAfterReloadHooks(event);

      if (this.config.debug) {
        console.error(`[SkillWatcher] Error processing ${filePath}:`, message);
      }
    }
  }

  /**
   * Execute before reload hooks
   */
  private async executeBeforeReloadHooks(event: SkillReloadEvent): Promise<void> {
    for (const hook of this.config.hooks) {
      if (!hook.beforeReload) continue;

      try {
        await hook.beforeReload(event);
      } catch {
        // Ignore hook errors
      }
    }
  }

  /**
   * Execute after reload hooks
   */
  private async executeAfterReloadHooks(event: SkillReloadEvent): Promise<void> {
    for (const hook of this.config.hooks) {
      if (!hook.afterReload) continue;

      try {
        await hook.afterReload(event);
      } catch {
        // Ignore hook errors
      }
    }
  }

  /**
   * Handle watch error
   */
  private handleWatchError(watchDir: string, error: Error): void {
    this.status = 'error';

    const event: SkillReloadEvent = {
      type: 'changed',
      filePath: watchDir,
      error: `Watch error: ${error.message}`,
    };

    this.reloadSubject.next(event);

    if (this.config.debug) {
      console.error(`[SkillWatcher] Watch error on ${watchDir}:`, error.message);
    }
  }
}

// ============================================================
// Convenience Functions
// ============================================================

/**
 * Create a skill watcher for a single directory
 *
 * @param directory - Directory to watch
 * @param options - Watcher options
 * @returns SkillWatcher instance
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
 * Watch skills and get an Observable of events
 *
 * @param directories - Directories to watch
 * @param options - Watcher options
 * @returns Observable of reload events
 */
export function watchSkills(
  directories: string[],
  options: Omit<SkillWatcherConfig, 'directories'> = {}
): Observable<SkillReloadEvent> & { watcher: SkillWatcher } {
  const watcher = new SkillWatcher({
    ...options,
    directories,
  });

  // Create a stop observable from the watcher's public interface
  const stop$ = new Subject<void>();

  const originalStop = watcher.stop.bind(watcher);
  watcher.stop = (): void => {
    originalStop();
    stop$.next();
    stop$.complete();
  };

  const observable = watcher.events$.pipe(
    takeUntil(stop$)
  );

  // Auto-start
  watcher.start().catch(() => {
    // Ignore start errors
  });

  return Object.assign(observable, { watcher });
}
