/**
 * AgentForge Plugin System
 *
 * Export public API for the plugin system.
 *
 * @module
 */

// ============================================================
// Core Interfaces
// ============================================================

export {
  type PluginContext,
  type Plugin,
  type CreatePluginContextOptions,
  createPluginContext,
} from './plugin.js';

// ============================================================
// Pipeline Builder
// ============================================================

export { applyPlugins, type AppliedPipeline } from './pipeline.js';

// ============================================================
// Plugin Manager
// ============================================================

export { PluginManager, createPluginManager } from './manager.js';

// ============================================================
// Built-in Plugins
// ============================================================

export { metricsPlugin } from './metrics-plugin.js';
export { loggingPlugin } from './logging-plugin.js';
export { createMemoryPlugin } from './memory-plugin.js';
export { createSkillsPlugin, type SkillMetadata } from './skills-plugin.js';
export {
  createSummarizationPlugin,
  type SummarizationPluginConfig,
} from './summarization-plugin.js';

// ============================================================
// TodoList Plugin (re-exported from tools for convenience)
// ============================================================

export {
  createTodoListPlugin,
  formatTodoState,
  type TodoItem,
  type TodoListState,
  type TodoStatus,
  type TodoPriority,
} from '../tools/todo-list.js';

// ============================================================
// Plugin Loader (dynamic installation)
// ============================================================

export {
  PluginLoader,
  parsePluginSpec,
  resolveEntryFromPkgFn as resolveEntryFromPkg,
  type PluginSpec,
  type PluginLoadResult,
  type PluginLoadError,
  type ParsedSpec,
} from './plugin-loader.js';
