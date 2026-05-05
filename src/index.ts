/**
 * AgentForge — Agent Harness Framework
 *
 * Main entry point with curated public API (~60 symbols).
 * For subsystem access, use sub-path imports:
 *
 *   agentforge/api          — Agent creation, builders, run helpers (L1 + L2)
 *   agentforge/adapters     — LLM provider adapters (OpenAI, Anthropic, Google, Ollama)
 *   agentforge/plugins      — Plugin system, built-in plugins, plugin loader, quota
 *   agentforge/core         — Core interfaces, events, state, hooks, lifecycle, observability
 *   agentforge/loop         — Agent loop factory (createAgentLoop)
 *   agentforge/extensions   — Subagent delegation, MCP client, skill system
 *   agentforge/planning     — Task planning engine
 *   agentforge/memory       — Compaction, vector stores, semantic memory, storage
 *   agentforge/security     — Security guard, sandbox executor, permission, audit, validation
 *   agentforge/resilience   — Circuit breaker, error classifier, auto-repairer
 *   agentforge/evaluation   — LLM-based evaluation framework
 *   agentforge/contracts    — Zod contracts with graceful degradation
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
  ToolBeforeResult,
  CheckpointHook,
  CheckpointResult,
  CheckpointFn,
  LifecyclePhase,
  CheckpointPhase,
  RecoveryPhase,
  LifecycleHookEntry,
  RecoveryHookEntry,
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
  LLMChunkEvent,
  Message,
  ToolCall,
  SerializedError,
  FinishReason,
  AgentTerminationReason,
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
// Error Codes
// ============================================================

export { ErrorCode } from './core/error-codes.js';

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
