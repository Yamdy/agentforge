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

export { createMetricsPlugin } from './metrics-plugin.js';
export { loggingPlugin } from './logging-plugin.js';
export { createMemoryPlugin } from './memory-plugin.js';
export { createSkillsPlugin, type SkillMetadata } from './skills-plugin.js';
export {
  createSummarizationPlugin,
  type SummarizationPluginConfig,
} from './summarization-plugin.js';
export {
  createTracingPlugin,
  type TracingPluginOptions,
  type SamplerConfig,
} from './tracing-plugin.js';
export {
  createCostEstimationPlugin,
  type CostEstimationPluginOptions,
} from './cost-estimation-plugin.js';
export {
  createEvaluationTracingPlugin,
  type EvaluationTracingPluginOptions,
} from './evaluation-tracing-plugin.js';
export {
  createSessionLifecyclePlugin,
  type SessionLifecyclePluginOptions,
} from './session-lifecycle-plugin.js';

// ============================================================
// Built-in Checkpoint Plugins
// ============================================================

export {
  createQuotaPlugin,
  createRateLimitPlugin,
  createQualityGatePlugin,
  createCircuitBreakerPlugin,
} from './builtin-checkpoints.js';

// ============================================================
// TodoList Plugin
// ============================================================

export { createTodoListPlugin, formatTodoState } from '../tools/todo-list.js';

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
