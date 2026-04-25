/**
 * AgentForge - Unified Public API
 *
 * Agent framework based on RxJS event stream + Zod type safety.
 *
 * @example Configuration Mode
 * ```typescript
 * import { createAgent, AgentConfig } from 'agentforge';
 *
 * const config: AgentConfig = {
 *   name: 'my-agent',
 *   model: { provider: 'openai', model: 'gpt-4' },
 *   maxSteps: 10,
 * };
 *
 * const agent = createAgent(config, { llm: myAdapter, tools: myRegistry });
 * const events$ = agent.run('Hello, world!');
 * ```
 *
 * @example Programming Mode
 * ```typescript
 * import { createAgentLoop, AgentEvent, AgentState } from 'agentforge';
 *
 * const loop = createAgentLoop(context, config);
 * loop.run('Hello').subscribe({
 *   next: (event: AgentEvent) => console.log(event.type),
 *   complete: () => console.log('Done'),
 * });
 * ```
 *
 * @module agentforge
 */

// ============================================================
// Core Types (Events, State, Interfaces)
// ============================================================

/**
 * Core event types for the agent event stream.
 *
 * All events follow a discriminated union pattern on the `type` field.
 * Use type guards (isLLMEvent, isToolEvent, etc.) for narrowing.
 */
export {
  type AgentEventType,
  type MessageRole,
  type Message,
  type ToolCall,
  type FinishReason,
  type SerializedError,
  type AgentEvent,
  // Type guards
  isAgentEvent,
  isLLMEvent,
  isToolEvent,
  isHITLEvent,
  isAgentLifecycleEvent,
  isTerminalEvent,
  // Helpers
  serializeError,
  generateId,
} from './core/events.js';

/**
 * Agent state management types and utilities.
 *
 * State is immutable - use update helpers (appendMessage, incrementStep, etc.)
 * to create new state objects.
 */
export {
  type BatchContext,
  type ContextManagement,
  type CheckpointReference,
  type ModelConfig,
  type TokenStats,
  type AgentState,
  type CreateInitialStateOptions,
  createInitialState,
  updateState,
  appendMessage,
  appendMessages,
  incrementStep,
  isMaxStepsReached,
  updateTokens,
  setPendingToolCalls,
  clearPendingToolCalls,
  setBatchContext,
  clearBatchContext,
  updateLastCheckpoint,
  setOutput,
  initContextManagement,
} from './core/state.js';

/**
 * Checkpoint types for agent resumption and recovery.
 *
 * Checkpoints capture complete agent state at step boundaries
 * (before_llm, after_llm, before_tool, after_tool).
 */
export {
  type CheckpointPosition,
  type A2APendingRequest,
  type ExecutedTool,
  type RecoveryMetadata,
  type CompactionHistory,
  type Checkpoint,
  type CreateCheckpointOptions,
  createCheckpoint,
  generateIdempotencyKey,
  isToolExecuted,
  getToolResult,
  recordToolExecution,
  hasPendingA2A,
  getPendingA2ARequests,
  updateA2AStatus,
  createRecoveryCheckpoint,
  getRecoveryInfo,
  getTotalCompactionSavings,
  serializeCheckpoint,
  deserializeCheckpoint,
} from './core/checkpoint.js';

/**
 * Dependency injection interfaces.
 *
 * Core interfaces for external capability injection:
 * - LLMAdapter: LLM provider communication
 * - ToolRegistry: Tool registration and execution
 * - HITLController: Human-in-the-loop interaction
 * - PauseController: Pause/resume execution
 * - MCPClient: Model Context Protocol client
 */
export type {
  LLMChunk,
  LLMUsage,
  LLMResponse,
  LLMOptions,
  LLMAdapter,
  LLMAdapterFactory,
  ToolDefinition,
  FunctionDefinition,
  ToolRegistry,
  MemoryStore,
  CheckpointStorage,
  SpanOptions,
  Tracer,
  Metrics,
  HITLAskOptions,
  HITLController,
  PauseController,
  MCPTool,
  MCPClient,
  MCPServerConfig,
  AgentMode,
  SubagentInfo,
  SubagentRegistry,
  ToolContext,
  ErrorSeverity,
  ErrorCategory,
  ClassifiedError,
  ErrorHandler,
  SchemaRegistry,
  PromptBuildOptions,
  BuiltPrompt,
  PromptBuilder,
} from './core/interfaces.js';

/**
 * Agent context types for dependency injection.
 *
 * Three-layer context structure:
 * - ApplicationServices: Global singleton, shared across all agents
 * - AgentContext: Session-level instance, unique per agent
 * - ToolContext: Transient, created per tool execution
 */
export type {
  ApplicationServices,
  AgentContext,
  AgentModelConfig,
  AgentConfig,
  StepContext as CoreStepContext,
} from './core/context.js';

export {
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  SimpleSchemaRegistry,
  generateSessionId,
  createDefaultAppServices,
  createToolContext,
} from './core/context.js';

/**
 * Context builder for fluent AgentContext creation.
 *
 * Use when manually assembling dependencies instead of createAgent.
 */
export {
  ContextBuilder,
  SimpleToolRegistry,
  DelegatingToolRegistry,
  createApplicationServices,
} from './core/context-builder.js';

/**
 * Zod to JSON Schema conversion utilities.
 */
export {
  zodToJsonSchema,
  zodToFunctionDef,
  toolToFunctionDef,
  toolsToFunctionDefs,
} from './core/zod-to-schema.js';

/**
 * Prompt builder for LLM message construction.
 */
export {
  DefaultPromptBuilder,
  DEFAULT_SYSTEM_TEMPLATE,
  TOOL_INSTRUCTIONS_TEMPLATE,
} from './core/prompt-builder.js';

/**
 * State machine for agent lifecycle management.
 *
 * 6-state model: pending → running → paused/completed/cancelled/error
 * Terminal states are irreversible.
 */
export type { AgentStateEnum } from './core/state-machine.js';
export { AgentStateMachine, isValidTransition, getValidTransitions } from './core/state-machine.js';

// ============================================================
// API - Configuration Mode (createAgent)
// ============================================================

/**
 * Configuration-based agent creation.
 *
 * Use createAgent for simple, config-driven agent setup.
 * Suitable for most use cases where dependencies are provided externally.
 * AgentConfig is exported from Core Types section above.
 */

// ============================================================
// API - Programming Mode (AgentLoop)
// ============================================================

/**
 * Programming interface agent loop.
 *
 * Use createAgentLoop for fine-grained control over agent execution.
 * Provides direct access to the expand-based event stream.
 */
export {
  type StepContext,
  type AgentLoopConfig,
  type AgentLoop,
  createAgentLoop,
} from './loop/index.js';

// ============================================================
// RxJS Operators
// ============================================================

/**
 * Custom RxJS operators for agent event stream processing.
 *
 * @example
 * ```typescript
 * import { filterEventType, takeUntilTerminal, collectMetrics } from 'agentforge';
 *
 * event$.pipe(
 *   filterEventType('llm.response'),
 *   takeUntilTerminal(),
 *   collectMetrics(metrics => console.log(metrics)),
 * );
 * ```
 */
export {
  // Filter operators
  filterEventType,
  filterEventTypePrefix,
  // Terminal condition operators
  takeUntilTerminal,
  onTerminal,
  // Event helpers
  tapEvent,
  tapEvents,
  // Metrics operators
  collectMetrics,
  type AgentMetrics,
  // Grouping operators
  groupByStep,
  // Rate limiting operators
  dedupeEventTypes,
  // Transform operators
  transformLLMParams,
  transformToolArgs,
  compressMessages,
  injectSystemPrompt,
  type LLMTransformParams,
  // Logging operators
  logEvents,
  traceEvents,
  recordMetrics,
  exportEvents,
  checkpoint,
  type Logger,
  // Control operators
  retryOnEventType,
  timeoutOnEventType,
  requirePermission,
  maxStepsLimit,
  pauseOnSignal,
  // Output operators
  eventToString,
  withLatency,
  type EventWithLatency,
  // Presets
  productionPreset,
  debugPreset,
  testPreset,
  createPreset,
  type ProductionPresetConfig,
  type DebugPresetConfig,
  type TestPresetConfig,
} from './operators/index.js';

// ============================================================
// Subsystems - Skill System
// ============================================================

/**
 * Skill subsystem for static knowledge packages.
 *
 * Skills are loaded into Agent context as system prompts.
 * Each skill is a YAML frontmatter + Markdown file (SKILL.md).
 *
 * @example
 * ```typescript
 * import { loadSkill, SkillRegistry, discoverSkills } from 'agentforge/skill';
 *
 * const registry = new SkillRegistry();
 * const skills = await discoverSkills(['./skills']);
 * ```
 */
export {
  // Types
  type SkillFrontmatter,
  type SkillInfo,
  type SkillLoadContext,
  type SkillLoadResult,
  type SkillDiscoveryOptions,
  isSkillFrontmatter,
  isSuccessfulLoadResult,
  // Parser
  type ParsedSkillFile,
  type ParseError as SkillParseError,
  type ParseResult as SkillParseResult,
  parseSkillFile,
  extractSections,
  extractTitle,
  validateSkillName,
  checkCompatibility,
  // Loader
  type SkillLoaderConfig,
  loadSkill,
  loadSkillsFromDirectory,
  discoverSkills,
  SkillRegistry,
  // Hooks
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
  // Watcher
  type SkillReloadEventType,
  type WatcherStatus,
  type SkillWatcherConfig,
  SkillWatcher,
  createSkillWatcher,
  watchSkills,
} from './skill/index.js';

// ============================================================
// Subsystems - A2A (Agent-to-Agent) Protocol
// ============================================================

/**
 * A2A subsystem for cross-process agent communication.
 *
 * Provides message passing, transport abstraction, and connection management.
 *
 * @example
 * ```typescript
 * import { createClient, A2AClient } from 'agentforge/a2a';
 *
 * const client = createClient({ transport: { type: 'http', url: 'ws://localhost:8080' } });
 * await client.connect();
 * const response = await client.request('agent-2', { action: 'query', data: 'hello' });
 * ```
 */
export {
  // Message Types
  type A2AMessageType,
  type A2ARole,
  type A2ATransportType,
  type A2AMessage,
  type A2AErrorPayload,
  type A2AErrorMessage,
  type A2AAckPayload,
  type A2AAckMessage,
  type A2ASpecializedMessage,
  // Type Guards
  isA2AMessage,
  isA2AErrorMessage,
  isA2AAckMessage,
  isA2ARequest,
  isA2AResponse,
  isA2ABroadcast,
  isA2ANotification,
  // Constants
  A2A_BROADCAST_TARGET,
  A2A_PROTOCOL_VERSION,
  A2A_DEFAULT_TTL,
  A2A_HEARTBEAT_INTERVAL,
  // Message Utilities
  type CreateMessageOptions,
  createMessage,
  createRequest,
  createResponse,
  createNotification,
  createBroadcast,
  createError,
  createAck,
  createHeartbeat,
  type ParseResult as A2AParseResult,
  parseMessage,
  parseMessageJson,
  validateMessage,
  validateErrorPayload,
  validateAckPayload,
  isMessageExpired,
  createCorrelationId,
  serializeMessage,
  // Transport
  type TransportStatus,
  type ReconnectConfig,
  type HeartbeatConfig,
  type BacklogConfig,
  type A2ATransportOptions,
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_HEARTBEAT_CONFIG,
  DEFAULT_BACKLOG_CONFIG,
  type A2ATransport,
  type TransportFactory,
  registerTransportFactory,
  createTransport,
  hasTransportFactory,
  getRegisteredTransportTypes,
  type TransportEventType,
  type TransportEvent,
  TransportError,
  TransportConnectionError,
  TransportSendError,
  TransportParseError,
  // Connection
  type ConnectionEventType,
  type ConnectionEvent,
  type ConnectionErrorEvent,
  type A2AConnectionOptions,
  A2AConnection,
  createConnection,
  // Client
  type A2AClientEventType,
  type A2AClientEvent,
  type A2AClientErrorEvent,
  type RequestOptions,
  type NotifyOptions,
  type A2AMessageHandler,
  type A2AMessageSubscription,
  type A2AClientOptions,
  A2AClient,
  createClient,
  // Mock
  MockTransport,
  createMockTransport,
} from './a2a/index.js';

// ============================================================
// Subsystems - Plugin System
// ============================================================

/**
 * Plugin system for extending agent behavior.
 *
 * Supports interceptor plugins (modify events) and observer plugins (react to events).
 *
 * @example
 * ```typescript
 * import { PluginManager, createPluginManager, Plugin } from 'agentforge/plugins';
 *
 * const myPlugin: Plugin = {
 *   name: 'logger',
 *   version: '1.0.0',
 *   setup: (ctx) => {
 *     ctx.intercept('llm.response', (event) => {
 *       console.log('LLM responded:', event.content);
 *       return event;
 *     });
 *   },
 * };
 *
 * const manager = createPluginManager();
 * manager.register(myPlugin);
 * ```
 */
export {
  // Core
  type PluginContext,
  type Plugin,
  type InterceptorPlugin,
  type ObserverPlugin,
  validatePlugin,
  isInterceptorPlugin,
  isObserverPlugin,
  type CreatePluginContextOptions,
  createPluginContext,
  // Pipeline
  buildPluginPipeline,
  emptyPipeline,
  blockingPipeline,
  replacePipeline,
  // Manager
  PluginManager,
  createPluginManager,
} from './plugins/index.js';
