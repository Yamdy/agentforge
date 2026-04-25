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

export {
  PluginManager,
  createPluginManager,
} from './manager.js';
