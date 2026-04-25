/**
 * AgentForge Skill Loading Hooks
 *
 * Provides a hook mechanism for skill loading lifecycle.
 * Hooks can intercept and modify skill loading behavior.
 *
 * Design principles:
 * - Hooks are optional and disabled by default
 * - Hook errors are isolated (never crash main flow)
 * - Hooks can modify skill content before registration
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import type { SkillInfo, SkillLoadContext, SkillLoadResult } from './types.js';

// ============================================================
// Hook Types
// ============================================================

/**
 * Before skill load hook
 *
 * Called before loading a skill file. Can reject loading by returning false.
 *
 * @param context - Load context with file path and metadata
 * @returns true to proceed with loading, false to skip
 */
export type BeforeSkillLoad = (context: SkillLoadContext) => Promise<boolean> | boolean;

/**
 * After skill load hook
 *
 * Called after successfully parsing a skill. Can modify skill content.
 *
 * @param skill - Parsed skill info
 * @returns Modified skill info (or undefined to keep original)
 */
export type AfterSkillLoad = (skill: SkillInfo) => Promise<Partial<SkillInfo> | void> | Partial<SkillInfo> | void;

/**
 * On skill load error hook
 *
 * Called when skill loading fails. Can log or handle errors.
 *
 * @param result - Failed load result
 * @param context - Load context
 */
export type OnSkillLoadError = (result: SkillLoadResult, context: SkillLoadContext) => void;

/**
 * On skill discovered hook
 *
 * Called when a skill is discovered during directory scanning.
 *
 * @param skill - Discovered skill
 * @param context - Discovery context
 */
export type OnSkillDiscovered = (skill: SkillInfo, context: SkillLoadContext) => void;

// ============================================================
// Skill Hook Interface
// ============================================================

/**
 * Skill loading hook interface
 *
 * All hook methods are optional.
 * Hooks are executed in registration order.
 */
export interface SkillLoadHook {
  /** Called before loading */
  beforeLoad?: BeforeSkillLoad;

  /** Called after successful load */
  afterLoad?: AfterSkillLoad;

  /** Called on load error */
  onError?: OnSkillLoadError;

  /** Called when skill is discovered */
  onDiscovered?: OnSkillDiscovered;

  /** Hook name for debugging */
  name?: string;

  /** Hook priority (higher = earlier execution) */
  priority?: number;
}

// ============================================================
// Hook Manager
// ============================================================

/**
 * Manages skill loading hooks
 *
 * Provides a centralized way to register and execute hooks.
 */
export class SkillHookManager {
  private hooks: SkillLoadHook[] = [];

  /**
   * Register a hook
   */
  register(hook: SkillLoadHook): void {
    this.hooks.push(hook);
    // Sort by priority (higher priority executes first)
    this.hooks.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Remove a hook by name
   */
  unregister(name: string): boolean {
    const index = this.hooks.findIndex((h) => h.name === name);
    if (index >= 0) {
      this.hooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks = [];
  }

  /**
   * Get all registered hooks
   */
  getHooks(): readonly SkillLoadHook[] {
    return this.hooks;
  }

  /**
   * Execute beforeLoad hooks
   *
   * @returns true if all hooks approve, false if any rejects
   */
  async executeBeforeLoad(context: SkillLoadContext): Promise<boolean> {
    for (const hook of this.hooks) {
      if (!hook.beforeLoad) continue;

      try {
        const result = await hook.beforeLoad(context);
        if (!result) {
          return false;
        }
      } catch {
        // Hook error - continue but log in debug mode
        if (process.env['SKILL_DEBUG'] === 'true') {
          console.warn(`Hook ${hook.name ?? 'unnamed'} error in beforeLoad`);
        }
      }
    }
    return true;
  }

  /**
   * Execute afterLoad hooks
   *
   * @returns Modified skill info
   */
  async executeAfterLoad(skill: SkillInfo): Promise<SkillInfo> {
    let current = skill;

    for (const hook of this.hooks) {
      if (!hook.afterLoad) continue;

      try {
        const result = await hook.afterLoad(current);
        if (result) {
          current = {
            ...current,
            ...result,
          };
        }
      } catch {
        // Hook error - continue but log in debug mode
        if (process.env['SKILL_DEBUG'] === 'true') {
          console.warn(`Hook ${hook.name ?? 'unnamed'} error in afterLoad`);
        }
      }
    }

    return current;
  }

  /**
   * Execute error hooks
   */
  executeOnError(result: SkillLoadResult, context: SkillLoadContext): void {
    for (const hook of this.hooks) {
      if (!hook.onError) continue;

      try {
        hook.onError(result, context);
      } catch {
        // Ignore hook errors in error handler
      }
    }
  }

  /**
   * Execute discovered hooks
   */
  executeOnDiscovered(skill: SkillInfo, context: SkillLoadContext): void {
    for (const hook of this.hooks) {
      if (!hook.onDiscovered) continue;

      try {
        hook.onDiscovered(skill, context);
      } catch {
        // Ignore hook errors in discovered handler
      }
    }
  }
}

// ============================================================
// Built-in Hooks
// ============================================================

/**
 * Logging hook for debugging
 *
 * Logs skill loading events to console.
 */
export function createLoggingHook(): SkillLoadHook {
  return {
    name: 'logging',
    priority: 100,

    beforeLoad: (context: SkillLoadContext): boolean => {
      // eslint-disable-next-line no-console
      console.log(`[Skill] Loading: ${context.filePath}`);
      return true;
    },

    afterLoad: (skill: SkillInfo): void => {
      // eslint-disable-next-line no-console
      console.log(`[Skill] Loaded: ${skill.frontmatter.name} from ${skill.location}`);
    },

    onError: (result: SkillLoadResult): void => {
      if (!result.success) {
        console.error(`[Skill] Failed to load ${result.filePath}: ${result.error}`);
      }
    },

    onDiscovered: (skill: SkillInfo): void => {
      // eslint-disable-next-line no-console
      console.log(`[Skill] Discovered: ${skill.frontmatter.name}`);
    },
  };
}

/**
 * Validation hook for frontmatter constraints
 *
 * Validates skill metadata before loading.
 */
export function createValidationHook(
  options: {
    /** Minimum description length */
    minDescriptionLength?: number;
    /** Required fields */
    requiredFields?: string[];
    /** Max allowed tools */
    maxTools?: number;
  } = {}
): SkillLoadHook {
  return {
    name: 'validation',
    priority: 90,

    afterLoad: (skill: SkillInfo): void => {
      const { minDescriptionLength, requiredFields, maxTools } = options;

      if (minDescriptionLength !== undefined) {
        if (skill.frontmatter.description.length < minDescriptionLength) {
          throw new Error(
            `Description too short (min ${minDescriptionLength}): ${skill.frontmatter.name}`
          );
        }
      }

      if (requiredFields !== undefined) {
        for (const field of requiredFields) {
          if (!(field in skill.frontmatter)) {
            throw new Error(`Missing required field '${field}': ${skill.frontmatter.name}`);
          }
        }
      }

      if (maxTools !== undefined) {
        const toolCount = skill.frontmatter.allowedTools?.length ?? 0;
        if (toolCount > maxTools) {
          throw new Error(
            `Too many tools (max ${maxTools}): ${skill.frontmatter.name} has ${toolCount}`
          );
        }
      }
    },
  };
}

/**
 * Caching hook for performance optimization
 *
 * Caches skill content and returns cached version if unchanged.
 */
export function createCachingHook(): SkillLoadHook & {
  /** Clear cache */
  clearCache: () => void;
  /** Get cache stats */
  getStats: () => { size: number; hits: number; misses: number };
} {
  const cache = new Map<string, { skill: SkillInfo; mtime: number }>();
  let hits = 0;
  let misses = 0;

  return {
    name: 'caching',
    priority: 200, // High priority - execute first

    beforeLoad: (_context: SkillLoadContext): boolean => {
      // Check cache - if hit, skip actual loading
      // Note: This is a hint; actual file read happens in loader
      return true;
    },

    afterLoad: (skill: SkillInfo): SkillInfo => {
      // Update cache
      const existing = cache.get(skill.location);
      if (existing && existing.mtime === skill.updatedAt.getTime()) {
        hits++;
        return existing.skill;
      }

      misses++;
      cache.set(skill.location, {
        skill,
        mtime: skill.updatedAt.getTime(),
      });

      return skill;
    },

    clearCache: (): void => {
      cache.clear();
      hits = 0;
      misses = 0;
    },

    getStats: () => ({
      size: cache.size,
      hits,
      misses,
    }),
  };
}

/**
 * Transform hook for content modification
 *
 * Applies transformations to skill content.
 */
export function createTransformHook(
  transforms: {
    /** Transform frontmatter */
    frontmatter?: (frontmatter: SkillInfo['frontmatter']) => SkillInfo['frontmatter'];
    /** Transform content */
    content?: (content: string) => string;
  } = {}
): SkillLoadHook {
  return {
    name: 'transform',
    priority: 50, // Lower priority - execute after validation

    afterLoad: (skill: SkillInfo): Partial<SkillInfo> => {
      const result: Partial<SkillInfo> = {};

      if (transforms.frontmatter) {
        result.frontmatter = transforms.frontmatter(skill.frontmatter);
      }

      if (transforms.content) {
        result.content = transforms.content(skill.content);
      }

      return result;
    },
  };
}

// ============================================================
// Hot-Reload Hooks
// ============================================================

/**
 * Skill reload event for hot-reload hooks
 *
 * Passed to reload hooks when a skill file changes.
 */
export interface SkillReloadEvent {
  /** Event type: added, changed, or removed */
  type: 'added' | 'changed' | 'removed';

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
 * Before skill reload hook
 *
 * Called before a skill is reloaded due to file change.
 * Can be used for cleanup or state preparation.
 *
 * @param event - Reload event with file path and type
 */
export type BeforeSkillReload = (event: SkillReloadEvent) => Promise<void> | void;

/**
 * After skill reload hook
 *
 * Called after a skill is reloaded. Can be used for
 * cache invalidation, notification, or state updates.
 *
 * @param event - Reload event with skill info or error
 */
export type AfterSkillReload = (event: SkillReloadEvent) => Promise<void> | void;

/**
 * On skill reload error hook
 *
 * Called when a skill reload fails. Can be used for
 * error logging, alerting, or fallback handling.
 *
 * @param event - Reload event with error info
 */
export type OnSkillReloadError = (event: SkillReloadEvent) => void;

/**
 * Skill reload hook interface
 *
 * All hook methods are optional.
 * Hooks are executed in registration order.
 */
export interface SkillReloadHook {
  /** Called before reload */
  beforeReload?: BeforeSkillReload;

  /** Called after reload */
  afterReload?: AfterSkillReload;

  /** Called on reload error */
  onReloadError?: OnSkillReloadError;

  /** Hook name for debugging */
  name?: string;

  /** Hook priority (higher = earlier execution) */
  priority?: number;
}

/**
 * Reload hook manager
 *
 * Manages hot-reload hooks for skill watching.
 */
export class SkillReloadHookManager {
  private hooks: SkillReloadHook[] = [];

  /**
   * Register a reload hook
   */
  register(hook: SkillReloadHook): void {
    this.hooks.push(hook);
    // Sort by priority (higher priority executes first)
    this.hooks.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Remove a hook by name
   */
  unregister(name: string): boolean {
    const index = this.hooks.findIndex((h) => h.name === name);
    if (index >= 0) {
      this.hooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks = [];
  }

  /**
   * Get all registered hooks
   */
  getHooks(): readonly SkillReloadHook[] {
    return this.hooks;
  }

  /**
   * Execute beforeReload hooks
   */
  async executeBeforeReload(event: SkillReloadEvent): Promise<void> {
    for (const hook of this.hooks) {
      if (!hook.beforeReload) continue;

      try {
        await hook.beforeReload(event);
      } catch {
        // Hook error - continue but log in debug mode
        if (process.env['SKILL_DEBUG'] === 'true') {
          console.warn(`Hook ${hook.name ?? 'unnamed'} error in beforeReload`);
        }
      }
    }
  }

  /**
   * Execute afterReload hooks
   */
  async executeAfterReload(event: SkillReloadEvent): Promise<void> {
    for (const hook of this.hooks) {
      if (!hook.afterReload) continue;

      try {
        await hook.afterReload(event);
      } catch {
        // Hook error - continue but log in debug mode
        if (process.env['SKILL_DEBUG'] === 'true') {
          console.warn(`Hook ${hook.name ?? 'unnamed'} error in afterReload`);
        }
      }
    }
  }

  /**
   * Execute error hooks
   */
  executeOnError(event: SkillReloadEvent): void {
    for (const hook of this.hooks) {
      if (!hook.onReloadError) continue;

      try {
        hook.onReloadError(event);
      } catch {
        // Ignore hook errors in error handler
      }
    }
  }
}

// ============================================================
// Built-in Reload Hooks
// ============================================================

/**
 * Logging hook for hot-reload debugging
 *
 * Logs skill reload events to console.
 */
export function createReloadLoggingHook(): SkillReloadHook {
  return {
    name: 'reload-logging',
    priority: 100,

    beforeReload: (event: SkillReloadEvent): void => {
      // eslint-disable-next-line no-console
      console.log(`[Skill] Reloading: ${event.filePath} (${event.type})`);
    },

    afterReload: (event: SkillReloadEvent): void => {
      if (event.error) {
        // eslint-disable-next-line no-console
        console.error(`[Skill] Reload failed: ${event.filePath} - ${event.error}`);
      } else if (event.skillName) {
        // eslint-disable-next-line no-console
        console.log(`[Skill] Reloaded: ${event.skillName} (${event.type})`);
      }
    },

    onReloadError: (event: SkillReloadEvent): void => {
      console.error(`[Skill] Reload error: ${event.filePath}`, event.error);
    },
  };
}

/**
 * Cache invalidation hook for hot-reload
 *
 * Clears a skill registry cache when skills are reloaded.
 */
export function createCacheInvalidationHook(
  registry: {
    remove: (name: string) => boolean;
    register: (skill: SkillInfo) => void;
  }
): SkillReloadHook {
  return {
    name: 'cache-invalidation',
    priority: 200, // High priority - execute first

    beforeReload: (event: SkillReloadEvent): void => {
      // Remove old skill from cache if it exists
      if (event.skillName) {
        registry.remove(event.skillName);
      }
    },

    afterReload: (event: SkillReloadEvent): void => {
      // Register new skill
      if (event.skill) {
        registry.register(event.skill);
      }
    },
  };
}

/**
 * Notification hook for hot-reload
 *
 * Sends notifications when skills are reloaded.
 */
export function createNotificationHook(
  notify: (message: string, type: 'info' | 'error') => void
): SkillReloadHook {
  return {
    name: 'notification',
    priority: 50,

    afterReload: (event: SkillReloadEvent): void => {
      if (event.error) {
        notify(`Skill reload failed: ${event.error}`, 'error');
      } else if (event.skillName) {
        notify(`Skill ${event.type}: ${event.skillName}`, 'info');
      }
    },

    onReloadError: (event: SkillReloadEvent): void => {
      notify(`Skill reload error: ${event.error ?? 'Unknown error'}`, 'error');
    },
  };
}

/**
 * Validation hook for hot-reload
 *
 * Validates reloaded skills against constraints.
 */
export function createReloadValidationHook(
  options: {
    /** Required keywords */
    requiredKeywords?: string[];
    /** Minimum content length */
    minContentLength?: number;
    /** Callback for validation failures */
    onInvalid?: (event: SkillReloadEvent, reason: string) => void;
  } = {}
): SkillReloadHook {
  return {
    name: 'reload-validation',
    priority: 150,

    afterReload: (event: SkillReloadEvent): void => {
      if (!event.skill) return;

      const { requiredKeywords, minContentLength, onInvalid } = options;

      // Check content length
      if (minContentLength !== undefined) {
        if (event.skill.content.length < minContentLength) {
          const reason = `Content too short: ${event.skill.content.length} < ${minContentLength}`;
          onInvalid?.(event, reason);
          if (process.env['SKILL_DEBUG'] === 'true') {
            console.warn(`[Skill] Validation failed: ${reason}`);
          }
        }
      }

      // Check keywords
      if (requiredKeywords && requiredKeywords.length > 0) {
        const skillKeywords = event.skill.frontmatter.keywords ?? [];
        const missingKeywords = requiredKeywords.filter((k) => !skillKeywords.includes(k));
        if (missingKeywords.length > 0) {
          const reason = `Missing keywords: ${missingKeywords.join(', ')}`;
          onInvalid?.(event, reason);
          if (process.env['SKILL_DEBUG'] === 'true') {
            console.warn(`[Skill] Validation failed: ${reason}`);
          }
        }
      }
    },
  };
}
