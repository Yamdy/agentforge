/**
 * AgentForge Skill Module
 *
 * Provides skill loading and management for static knowledge packages.
 *
 * Skill is a static knowledge package that:
 * - Provides domain-specific instructions via SKILL.md format
 * - Contains YAML frontmatter + Markdown content
 * - Is loaded into Agent context as system prompt
 * - Does NOT execute code (unlike tools or subagents)
 *
 * @example
 * ```typescript
 * import { loadSkill, SkillRegistry, parseSkillFile } from 'agentforge/skill';
 *
 * // Load a single skill
 * const result = await loadSkill('/path/to/skill/SKILL.md');
 * if (result.success) {
 *   console.log(result.skill.frontmatter.name);
 * }
 *
 * // Use registry for caching
 * const registry = new SkillRegistry();
 * await registry.load('/path/to/skill/SKILL.md');
 *
 * // Discover skills
 * const skills = await discoverSkills(['./skills', './custom-skills']);
 * ```
 *
 * @example Hot-Reload
 * ```typescript
 * import { SkillWatcher, createCacheInvalidationHook } from 'agentforge/skill';
 *
 * const registry = new SkillRegistry();
 * const watcher = new SkillWatcher({
 *   directories: ['./skills'],
 *   hooks: [createCacheInvalidationHook(registry)],
 * });
 *
 * watcher.events$.subscribe((event) => {
 *   console.log(`${event.type}: ${event.skillName}`);
 * });
 *
 * await watcher.start();
 * ```
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

// Types
export {
  SkillFrontmatterSchema,
  type SkillFrontmatter,
  type SkillInfo,
  type SkillLoadContext,
  type SkillLoadResult,
  type SkillDiscoveryOptions,
  isSkillFrontmatter,
  isSuccessfulLoadResult,
} from './types.js';

// Parser
export {
  type ParsedSkillFile,
  type ParseError,
  type ParseResult,
  parseSkillFile,
  extractSections,
  extractTitle,
  validateSkillName,
  checkCompatibility,
} from './parser.js';

// Loader
export {
  type SkillLoaderConfig,
  loadSkill,
  loadSkillsFromDirectory,
  discoverSkills,
  SkillRegistry,
} from './loader.js';

// Hooks
export {
  type BeforeSkillLoad,
  type AfterSkillLoad,
  type OnSkillLoadError,
  type OnSkillDiscovered,
  type SkillLoadHook,
  SkillHookManager,
  createLoggingHook,
  createValidationHook,
  createCachingHook,
  createTransformHook,
  // Hot-Reload Hooks
  type SkillReloadEvent,
  type BeforeSkillReload,
  type AfterSkillReload,
  type OnSkillReloadError,
  type SkillReloadHook,
  SkillReloadHookManager,
  createReloadLoggingHook,
  createCacheInvalidationHook,
  createNotificationHook,
  createReloadValidationHook,
} from './hooks.js';

// Watcher
export {
  type SkillReloadEventType,
  type WatcherStatus,
  type SkillWatcherConfig,
  SkillWatcher,
  createSkillWatcher,
  watchSkills,
} from './watcher.js';
