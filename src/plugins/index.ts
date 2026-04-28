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
  type InterceptorPlugin,
  type ObserverPlugin,
  PluginSchema,
  validatePlugin,
  isInterceptorPlugin,
  isObserverPlugin,
  type CreatePluginContextOptions,
  createPluginContext,
} from './plugin.js';

// ============================================================
// Pipeline Builder
// ============================================================

export {
  buildPluginPipeline,
  emptyPipeline,
  blockingPipeline,
  replacePipeline,
} from './pipeline.js';

// ============================================================
// Plugin Manager
// ============================================================

export { PluginManager, createPluginManager } from './manager.js';

// ============================================================
// Built-in Plugins
// ============================================================

export { metricsPlugin } from './metrics-plugin.js';

// ============================================================
// Built-in Plugins
// ============================================================

export { loggingPlugin } from './logging-plugin.js';

// ============================================================
// Memory & Skills Plugins
// ============================================================

export { createMemoryPlugin } from './memory-plugin.js';
export { createSkillsPlugin, type SkillMetadata } from './skills-plugin.js';
export { createSummarizationPlugin, type SummarizationPluginConfig } from './summarization-plugin.js';

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
