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
  // Zod Schemas
  AgentEventTypeSchema,
  AgentEventSchema,
  MessageSchema,
  ToolCallSchema,
  SerializedErrorSchema,
  FinishReasonSchema,
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
  recordCompaction,
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
  MCPStatus,
  MCPTool,
  MCPClient,
  MCPServerConfig,
  AgentMode,
  SubagentInfo,
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
export {
  createAgent,
  type Agent,
  type StreamHandlers,
  type AgentSubscription,
} from './api/index.js';

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

// ============================================================
// Subsystems - MCP (Model Context Protocol)
// ============================================================

/**
 * MCP client for Model Context Protocol servers.
 *
 * Provides tool discovery and execution for MCP servers.
 * Supports both stdio (local process) and HTTP/SSE transports.
 *
 * @example
 * ```typescript
 * import { createMCPClient, adaptMCPTools } from 'agentforge';
 *
 * const client = createMCPClient({
 *   serverName: 'filesystem',
 *   sessionId: 'session-123',
 * });
 *
 * await client.connect({
 *   type: 'stdio',
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 * });
 *
 * const tools = await client.tools();
 * const result = await client.callTool('read_file', { path: '/tmp/test.txt' });
 * ```
 */
export {
  // Types
  type JSONRPCId,
  type JSONRPCRequest,
  type JSONRPCNotification,
  type JSONRPCResponse,
  type JSONRPCMessage,
  type MCPToolSchema,
  type MCPContentBlock,
  // Transport
  type TransportStatus as MCPTransportStatus,
  type MCPTransport,
  type TransportFactory as MCPTransportFactory,
  MCPTransportError,
  MCPConnectionError,
  MCPSendError,
  MCPParseError,
  // Stdio Transport
  type StdioTransportConfig,
  StdioTransport,
  createStdioTransport,
  // HTTP Transport
  type HTTPTransportConfig,
  type AuthProvider as MCPAuthProvider,
  StreamableHTTPTransport,
  createHTTPTransport,
  createSSETransport,
  // Client
  type MCPClientOptions,
  type MCPEvent,
  AgentForgeMCPClient,
  createMCPClient,
  // Tool Adapter
  adaptMCPTool,
  adaptMCPTools,
  isMCPToolName,
  parseMCPToolName,
  createMCPToolName,
  jsonSchemaToZod,
} from './mcp/index.js';

// ============================================================
// Subsystems - SubAgent Execution
// ============================================================

/**
 * SubAgent execution logic for nested agent delegation.
 *
 * Enables parent agents to delegate tasks to specialized subagents.
 * Each subagent runs as an independent agent loop with its own context.
 *
 * @example
 * ```typescript
 * import { SubagentRegistry, createSubagentRegistry } from 'agentforge/subagent';
 * import { createAgentLoop } from 'agentforge';
 *
 * const registry = createSubagentRegistry();
 *
 * // Create a subagent agent loop
 * const subagentLoop = createAgentLoop(subagentContext, subagentConfig);
 *
 * // Register the subagent
 * registry.register({
 *   name: 'research-agent',
 *   description: 'Search and summarize information',
 *   agent: subagentLoop,
 * });
 * ```
 */
export {
  // Types
  type AgentLoop as SubagentAgentLoop,
  type SubagentConfig,
  type SubagentRunOptions,
  type SubagentResult,
  type SubagentEntry,
  // Registry
  SubagentRegistry,
  createSubagentRegistry,
} from './subagent/index.js';

// ============================================================
// Subsystems - Workflow Orchestration
// ============================================================

/**
 * Workflow orchestration for multi-step agent execution.
 *
 * Workflows define sequences of steps, each calling an agent.
 * Events from nested agents bubble up with workflow correlation.
 *
 * @example
 * ```typescript
 * import { Workflow, SequentialPipeline } from 'agentforge';
 *
 * const workflow = new Workflow({
 *   id: 'research',
 *   name: 'Research Workflow',
 *   steps: [
 *     { id: 'search', prompt: (input) => `Search: ${input}` },
 *     { id: 'analyze', prompt: (input) => `Analyze: ${input}` },
 *   ],
 * }, agentContext);
 *
 * workflow.run('AI trends').subscribe(console.log);
 * ```
 */
export {
  // Types
  WorkflowStepSchema,
  WorkflowConfigSchema,
  WorkflowExecutionStateSchema,
  PipelineModeSchema,
  type WorkflowStep,
  type WorkflowStepWithAgent,
  type WorkflowConfig,
  type WorkflowExecutionState,
  type WorkflowExecutionContext,
  type WorkflowResult,
  type WorkflowStepResult,
  type PipelineMode,
  type PipelineConfig,
  isWorkflowEvent,
  getWorkflowIdFromEvent,
  createStepOutputEntry,
  // Workflow Class
  Workflow,
  createWorkflow,
  // Executor
  WorkflowExecutor,
  createPromptGenerator,
  createJsonPromptGenerator,
  // Pipeline
  SequentialPipeline,
  ParallelPipeline,
  createPipeline,
  createSequentialPipeline,
  createParallelPipeline,
} from './workflow/index.js';

// ============================================================
// Quota Management
// ============================================================

export {
  type QuotaUsage,
  type QuotaLimits,
  type QuotaController,
  MemoryQuotaController,
} from './quota/index.js';

// ============================================================
// Memory / Compaction
// ============================================================

export {
  type CompactionStrategy,
  type CompactionResult,
  type CompactionConfig,
  type CompactionContext,
  CompactionManager,
  createCompactionManager,
  createTruncateCompactionManager,
  createSummarizeCompactionManager,
  createDisabledCompactionManager,
  DEFAULT_COMPACTION_CONFIG,
} from './memory/index.js';

// ============================================================
// Observability / Resource Monitoring
// ============================================================

export { ResourceMonitor, type ResourceMetrics } from './observability/index.js';

// ============================================================
// LLM Adapters
// ============================================================

export {
  OpenAIAdapter,
  createOpenAIAdapter,
  createOpenAIAdapterFromFactory,
  openaiAdapterFactory,
  type OpenAIAdapterOptions,
  AnthropicAdapter,
  createAnthropicAdapter,
  createAnthropicAdapterFromFactory,
  anthropicAdapterFactory,
  type AnthropicAdapterOptions,
  parseModelSpec,
  detectProviderFromModel,
  getLLMAdapterFactory,
  resetLLMAdapterFactory,
  createLLMAdapter,
  createOpenAICompatibleAdapter,
  createGoogleAdapter,
  createOllamaAdapter,
  PROVIDER_API_KEY_ENV,
  PROVIDER_BASE_URLS,
  type ParsedModelSpec,
  type AdapterFactoryFn,
} from './adapters/index.js';

// ============================================================
// MPU Integration
// ============================================================

/**
 * MPU (Minimum Production Usable) integration module.
 *
 * Factory for creating MPU service instances based on configuration flags.
 * All MPU modules are optional — disabled by default for zero overhead.
 *
 * @example
 * ```typescript
 * import { createMPUServices, AgentContextBuilder } from 'agentforge';
 *
 * const mpu = createMPUServices({
 *   enableSecurity: true,
 *   enableCircuitBreaker: true,
 *   enableHealthCheck: true,
 *   enableCostTracking: true,
 * });
 *
 * const ctx = AgentContextBuilder.create()
 *   .withLLM(myLLM)
 *   .withTools(myTools)
 *   .withSecurityGuard(mpu.context.securityGuard!)
 *   .withCircuitBreaker(mpu.context.circuitBreaker!)
 *   .build();
 * ```
 */
export { type MPUConfig, type MPUServiceResult, createMPUServices } from './integration/index.js';

// ============================================================
// L1 API (Zero-Code Configuration)
// ============================================================

/**
 * L1 API - Create agents from configuration files.
 *
 * @example
 * ```typescript
 * import { loadAgent, runPrompt } from 'agentforge';
 *
 * // From config file
 * const agent = await loadAgent('agent.json');
 * const result = await agent.run('Hello!');
 *
 * // Or shorthand
 * const response = await runPrompt('agent.json', 'Hello!');
 * ```
 */
export {
  loadAgent,
  loadAgentFromConfig,
  runPrompt,
  runPromptWithConfig,
  L1AgentConfigSchema,
  type L1AgentConfig,
} from './l1/index.js';

// ============================================================
// Quickstart (Zero-config API)
// ============================================================

/**
 * Zero-config tool helper for quick agent creation.
 *
 * @example
 * ```typescript
 * import { createAgent, tool } from 'agentforge';
 * import { z } from 'zod';
 *
 * const greetTool = tool({
 *   description: 'Greet someone',
 *   parameters: z.object({ name: z.string() }),
 *   execute: async (args) => `Hello, ${args.name}!`,
 * });
 *
 * const agent = createAgent({
 *   name: 'my-agent',
 *   model: { provider: 'openai', model: 'gpt-4o-mini' },
 *   tools: [greetTool],
 * });
 * ```
 *
 * For the zero-config Agent class, import from './quickstart':
 * ```typescript
 * import { Agent } from 'agentforge/quickstart';
 * ```
 */
export { tool, type GenerateResult } from './quickstart.js';

// ============================================================
// Token Counter
// ============================================================

/**
 * Accurate token counting using js-tiktoken.
 *
 * @example
 * ```typescript
 * import { countTokens, countMessagesTokens, TokenCounter } from 'agentforge';
 *
 * // Simple counting
 * const tokens = countTokens('Hello, world!');
 *
 * // Message counting
 * const messageTokens = countMessagesTokens([
 *   { role: 'user', content: 'Hello' },
 *   { role: 'assistant', content: 'Hi!' },
 * ]);
 *
 * // Custom counter
 * const counter = new TokenCounter({ model: 'gpt-4o' });
 * const accurate = counter.countTokens('Hello!');
 * ```
 */
export {
  TokenCounter,
  getTokenCounter,
  countTokens,
  countMessagesTokens,
  type TokenCounterConfig,
  type ModelEncoding,
} from './token-counter.js';
