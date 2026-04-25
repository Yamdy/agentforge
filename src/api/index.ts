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
 * | **L3** | **Framework devs** | **Full Observable control** |
 *
 * ## L2 Quick Start (Recommended for most users)
 *
 * ```typescript
 * import { createAgent } from 'agentforge';
 *
 * const agent = createAgent({
 *   name: 'assistant',
 *   model: { provider: 'openai', model: 'gpt-4o' },
 *   maxSteps: 10,
 *   timeout: 60000,
 * });
 *
 * // Promise mode
 * const result = await agent.run('Hello!');
 *
 * // Streaming mode
 * agent.stream('Tell me a story', {
 *   onText: (delta) => process.stdout.write(delta),
 *   onComplete: (result) => console.log('\nDone:', result),
 * });
 * ```
 *
 * ## L3 Quick Start (Framework developers)
 *
 * ```typescript
 * import { runAgent, AgentContextBuilder } from 'agentforge/api';
 * import { filter, tap, timeout } from 'rxjs/operators';
 *
 * const ctx = AgentContextBuilder.create()
 *   .withLLM(myLLMAdapter)
 *   .withTools([readTool, writeTool])
 *   .build();
 *
 * runAgent(ctx, 'Hello, world!').pipe(
 *   timeout(60000),
 *   filter(e => e.type.startsWith('tool.')),
 *   tap(e => console.log(`[${e.type}]`, e)),
 * ).subscribe({
 *   next: (event) => handleEvent(event),
 *   complete: () => console.log('Done'),
 * });
 * ```
 *
 * ## Core Exports
 *
 * ### L2 API
 * - `createAgent(config)` - Configuration-based agent factory
 * - `AgentConfig` - Main configuration type
 * - `Agent` - Agent interface
 *
 * ### L3 Run Functions
 * - `runAgent(ctx, input, options?)` - Direct Observable return
 * - `runAgentWithControl(ctx, input, options?)` - With control interface
 * - `runAgentToCompletion(ctx, input, options?)` - Promise form
 *
 * ### AgentLoop Class
 * - `AgentLoop` - Full control over loop lifecycle
 * - `createAgentLoopInstance()` - Factory function
 *
 * ### Context Building
 * - `AgentContextBuilder` - Fluent context builder
 * - `createMinimalContext(llm, tools)` - Quick factory
 * - `createContextWithHITL(llm, tools)` - HITL-enabled factory
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
  type AgentSubscription,
  type CreateAgentResult,
  // Configuration subtypes
  type AgentModelConfig,
  type CheckpointConfig,
  type TracingConfig,
  type MetricsConfig,
  type HITLConfig,
  type SubagentConfig,
  type MCPServerConfig,
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
  createAgentLoopInstance,
  type AgentLoopOptions,
  type AgentLoopState,
  type AgentControl,
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

export type {
  AgentEvent,
  AgentEventType,
  Message,
  MessageRole,
  ToolCall,
} from '../core/events.js';

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
