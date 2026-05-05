/**
 * AgentForge — Agent Harness Framework
 *
 * Main entry point with curated public API (~60 symbols).
 * For subsystem access, use sub-path imports:
 *
 *   agentforge/api          — Agent creation, builders, run helpers
 *   agentforge/adapters     — LLM provider adapters (OpenAI, Anthropic, Google, Ollama)
 *   agentforge/plugins      — Plugin system, built-in plugins, plugin loader
 *   agentforge/core         — Core interfaces, events, state, hooks, defaults
 *   agentforge/loop         — Agent loop factory (createAgentLoop)
 *   agentforge/mcp          — Model Context Protocol client
 *   agentforge/skill        — Skill system (loading, discovery, hot-reload)
 *   agentforge/a2a          — Agent-to-Agent protocol
 *   agentforge/workflow     — Workflow orchestration
 *   agentforge/subagent     — Subagent delegation
 *   agentforge/planning     — Task planning engine
 *   agentforge/memory       — Compaction, vector stores, semantic memory
 *   agentforge/quota        — Quota management
 *   agentforge/resilience   — Circuit breaker, error classifier, auto-repairer
 *   agentforge/security     — Security guard, sandbox executor
 *   agentforge/audit        — Audit logging (SQLite + hash chain)
 *   agentforge/storage      — SQLite checkpoint & session storage
 *   agentforge/sandbox      — Docker sandbox isolation
 *   agentforge/validation   — Result validation
 *   agentforge/observability— Health checker, metrics collector, OTel
 *   agentforge/lifecycle    — Graceful shutdown
 *   agentforge/integration  — MPU service factory
 *   agentforge/evaluation   — LLM-based evaluation framework
 *   agentforge/l1           — Zero-code config file API
 *   agentforge/quickstart   — Zero-config Agent class
 *   agentforge/contracts    — Zod contracts with graceful degradation
 *   agentforge/app          — Application harness (multitenant)
 *
 * @module agentforge
 */

// ============================================================
// Agent Creation (L2 API)
// ============================================================

export { createAgent } from './api/index.js';
export type {
  Agent,
  AgentConfig,
  NormalizedAgentConfig,
  RunHandlers,
  StreamHandlers,
  PluginSpec,
} from './api/index.js';
export { AgentConfigError } from './api/types.js';

// ============================================================
// Plugin System — the one true extension API
// ============================================================

export type { Plugin, PluginContext } from './plugins/index.js';

export type {
  RequestHook,
  ToolHook,
  ToolProviderHook,
  CheckpointHook,
  CheckpointResult,
  CheckpointFn,
  LifecyclePhase,
  LifecycleHookEntry,
} from './core/hooks.js';

export { RequestHookPriority, DEFAULT_REQUEST_HOOK_PRIORITY } from './core/hooks.js';

// Built-in plugin factories
export {
  createQuotaPlugin,
  createRateLimitPlugin,
  createQualityGatePlugin,
  createCircuitBreakerPlugin,
  createMemoryPlugin,
  createSkillsPlugin,
  createSummarizationPlugin,
  createTodoListPlugin,
  loggingPlugin,
  metricsPlugin,
} from './plugins/index.js';

// ============================================================
// Events
// ============================================================

export type {
  AgentEvent,
  AgentEventType,
  Message,
  ToolCall,
  SerializedError,
  FinishReason,
} from './core/events.js';

export {
  isAgentEvent,
  isLLMEvent,
  isToolEvent,
  isAgentLifecycleEvent,
  isTerminalEvent,
  serializeError,
  generateId,
} from './core/events.js';

// ============================================================
// Core Types
// ============================================================

export type { AgentContext } from './core/context.js';

export type {
  LLMAdapter,
  LLMResponse,
  LLMUsage,
  ToolDefinition,
  ToolRegistry,
} from './core/interfaces.js';

export type { AgentState, CreateInitialStateOptions } from './core/state.js';

export { createInitialState, updateState } from './core/state.js';

// ============================================================
// L3 API (Programmatic — advanced)
// ============================================================

export { ContextBuilder, createApplicationServices } from './core/context-builder.js';

export type { AgentLoop, AgentLoopConfig, RunResult } from './loop/index.js';

export { createAgentLoop } from './loop/index.js';

// ============================================================
// LLM Adapters
// ============================================================

export { createLLMAdapter, parseModelSpec, LLMAdapterFactoryImpl } from './adapters/index.js';

// ============================================================
// Compaction
// ============================================================

export { CompactionManager, createCompactionManager } from './memory/index.js';

// ============================================================
// Utilities
// ============================================================

export { tool } from './quickstart.js';

export { TokenCounter, countTokens } from './token-counter.js';

export { extractText, hasImages, isContentArray } from './core/content-utils.js';
