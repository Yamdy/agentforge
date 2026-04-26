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
