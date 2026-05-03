/**
 * AgentForge API - Combined L2 & L3 Interface
 *
 * This module provides both the L2 (configuration-based) and L3 (programming) APIs.
 *
 * ## Three API Layers
 *
 * | Layer | Target User | Control Level |
 * |-------|-------------|---------------|
 * | L1 | Non-programmers | Config files |
 * | **L2** | **App developers** | **Declarative (createAgent)** |
 * | **L3** | **Framework devs** | **Full event-driven control** |
 *
 * ## L2 Quick Start (Recommended for most users)
 *
 * ```typescript
 * import { createAgent } from 'agentforge';
 *
 * const ctx = AgentContextBuilder.create()
 *   .withLLM(myLLMAdapter)
 *   .withTools([readTool, writeTool])
 *   .build();
 *
 * // Promise mode
 * const result = await agent.run('Hello!');
 * ```
 *
 * @module
 */

// ============================================================
// L2 API - createAgent Factory (Recommended)
// ============================================================

export { createAgent } from './create-agent.js';

export {
  // Main config type
  type AgentConfig,
  // Agent interface
  type Agent,
  type StreamHandlers,
  type RunHandlers,
  type CreateAgentResult,
  // Configuration subtypes
  type AgentModelConfig,
  type CheckpointConfig,
  type TracingConfig,
  type MetricsConfig,
  type HITLConfig,
  type SubagentConfig,
  type MCPServerConfig,
  // Plugin Spec (dynamic loading)
  type PluginSpec,
  // Defaults
  DEFAULT_AGENT_CONFIG,
} from './types.js';

// ============================================================
// L3 API - Core Run Functions
// ============================================================

export {
  runAgent,
  runAgentWithControl,
  runAgentToCompletion,
  runAgentForTools,
  runAgentForText,
  type RunAgentOptions,
  type RunAgentResult,
} from './run-agent.js';

// ============================================================
// AgentLoop Class
// ============================================================

export {
  AgentLoop,
  type AgentLoopOptions,
  type LoopStatus,
  type AgentLoopInstance,
} from './agent-loop.js';

// ============================================================
// ContextBuilder
// ============================================================

export {
  AgentContextBuilder,
  createMinimalContext,
  createContextWithHITL,
  ContextBuilder,
  SimpleToolRegistry,
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  generateSessionId,
} from './context-builder.js';

export type { ModelConfig } from './context-builder.js';

// ============================================================
// Core Types (re-export for convenience)
// ============================================================

export type { AgentEvent, AgentEventType, Message, MessageRole, ToolCall } from '../core/events.js';

export type { AgentContext, ApplicationServices } from '../core/context.js';

export type {
  LLMAdapter,
  LLMResponse,
  LLMChunk,
  ToolRegistry,
  ToolDefinition,
  HITLController,
  CheckpointStorage,
  PauseController,
} from '../core/interfaces.js';

// ============================================================
// State Utilities (for advanced usage)
// ============================================================

export {
  createInitialState,
  updateState,
  appendMessage,
  type CreateInitialStateOptions,
  type AgentState,
} from '../core/state.js';

// ============================================================
// Event Helpers
// ============================================================

export {
  isTerminalEvent,
  isLLMEvent,
  isToolEvent,
  isHITLEvent,
  isAgentLifecycleEvent,
  serializeError,
  generateId,
} from '../core/events.js';
