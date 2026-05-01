/**
 * AgentForge - Unified Public API
 *
 * Agent framework with imperative event loop + Hook cut-point system.
 *
 * @example Configuration Mode
 * ```typescript
 * import { createAgent } from 'agentforge';
 *
 * const agent = createAgent({
 *   name: 'my-agent',
 *   model: { provider: 'openai', model: 'gpt-4' },
 *   maxSteps: 10,
 * });
 *
 * const result = await agent.run('Hello, world!');
 * console.log(result);
 * ```
 *
 * @example Event Observation
 * ```typescript
 * agent.on('tool.call', (event) => console.log('Tool called:', event.toolName));
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
// Core - Default DI Implementations
// ============================================================

/**
 * Default implementations for core DI interfaces.
 *
 * These provide zero-config defaults so `createAgent()` works out of the box.
 * Replace with production implementations (OTel, Prometheus, etc.) as needed.
 *
 * @example
 * ```typescript
 * import { ConsoleTracer, ConsoleMetrics, BridgeMetrics } from 'agentforge';
 * import { MetricsCollectorImpl } from 'agentforge/observability';
 *
 * // Development: console logging
 * const tracer = new ConsoleTracer();
 * const metrics = new ConsoleMetrics();
 *
 * // Production: bridge to Prometheus
 * const collector = new MetricsCollectorImpl({ prefix: 'agentforge' });
 * const metrics = new BridgeMetrics(collector);
 * ```
 */
export {
  NoopTracer,
  ConsoleTracer,
  NoopMetrics,
  ConsoleMetrics,
  BridgeMetrics,
} from './core/defaults.js';

// ── OpenTelemetry Tracing ──
export { OTelTracer } from './observability/tracers/otel-tracer.js';
export type { OTelConfig } from './observability/tracers/otel-tracer.js';
export {
  ATTR_OPERATION,
  ATTR_PROVIDER,
  ATTR_REQUEST_MODEL,
  ATTR_USAGE_INPUT_TOKENS,
  ATTR_USAGE_OUTPUT_TOKENS,
  ATTR_AGENT_ID,
  ATTR_AGENT_NAME,
  ATTR_TOOL_NAME,
  ATTR_AGENTFORGE_RUN_ID,
  ATTR_AGENTFORGE_STEP,
  ATTR_AGENTFORGE_EVENT,
  OPERATION_CHAT,
  OPERATION_EXECUTE_TOOL,
  OPERATION_AGENT_RUN,
  OPERATION_AGENT_STEP,
  extractLLMAttributes,
  extractToolAttributes,
} from './observability/tracers/otel-attributes.js';

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
  type RunHandlers,
  type PluginSpec,
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
export { type AgentLoopConfig, type AgentLoop, createAgentLoop } from './loop/index.js';

// ============================================================
// Hooks System
// ============================================================

export {
  HookName,
  type HookFn,
  type LifecycleHookEntry,
  type RequestHook,
  type ToolHook,
  HookRegistry,
} from './core/hooks.js';

// ============================================================
// Event Emitter
// ============================================================

export { AgentEventEmitter } from './core/events.js';

// ============================================================
// New State Types
// ============================================================

export type { RecoveryState, TokenBudgetState, AgentLoopState } from './core/state.js';

export { createInitialLoopState } from './core/state.js';

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
  // Manager
  PluginManager,
  createPluginManager,
  // New imperative
  applyPlugins,
} from './plugins/index.js';

// ============================================================
// Plugin Loader (Dynamic Installation)
// ============================================================

/**
 * Dynamic plugin loader for runtime npm installation.
 *
 * @example
 * ```typescript
 * import { PluginLoader, parsePluginSpec } from 'agentforge';
 *
 * const result = parsePluginSpec('my-plugin@^1.0');
 * // { source: 'npm', pkg: 'my-plugin', version: '^1.0.0' }
 *
 * const specs = [{ source: 'my-audit-plugin@latest' }];
 * await PluginLoader.loadAll(specs, ctx, hooks, emitter);
 * ```
 */
export {
  PluginLoader,
  parsePluginSpec,
  resolveEntryFromPkgFn as resolveEntryFromPkg,
  type PluginLoadResult,
  type PluginLoadError,
  type ParsedSpec,
} from './plugins/plugin-loader.js';

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

export {
  ResourceMonitor,
  type ResourceMetrics,
  HealthCheckerImpl,
  MetricsCollectorImpl,
} from './observability/index.js';

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
// MPU Module Exports (previously internal-only)
// ============================================================

/**
 * M1: SQLite Storage (Checkpoint + Session)
 */
export { SqliteCheckpointStorage, SqliteSessionStorage } from './storage/index.js';

/**
 * M2: Task Planning
 *
 * Planning engine for generating execution plans before agent loop starts.
 */
export {
  type PlanStep,
  type ExecutionPlan,
  PlannerImpl,
  PlanExecutorImpl,
} from './planning/index.js';

/**
 * M3: Sandbox Isolation
 *
 * Docker-based sandbox for isolated tool execution.
 */
export { type DockerSandboxConfig, DockerSandbox } from './sandbox/index.js';

/**
 * M4: Resilience (Circuit Breaker + Error Classifier + Auto-Repairer)
 */
export {
  DefaultCircuitBreaker,
  type CircuitBreakerConfig,
  DefaultErrorClassifier,
  DefaultAutoRepairer,
  type RepairResult,
  type RepairHandler,
} from './resilience/index.js';

/**
 * M5: Audit Logging (SQLite + Hash Chain)
 */
export { SqliteAuditStore } from './audit/index.js';

/**
 * M6: Security (Sandbox Executor)
 */
export { InProcessSandboxExecutor } from './security/index.js';

/**
 * M9: Graceful Shutdown
 */
export { GracefulShutdown, type ShutdownResult } from './lifecycle/index.js';

/**
 * M10: Result Validation
 */
export {
  ResultValidatorImpl,
  GoalAlignmentCheckerImpl,
  CompletionScorerImpl,
} from './validation/index.js';

/**
 * Evaluation Framework — LLM-based scoring pipeline.
 *
 * Provides LLM-as-Judge evaluation with Builder pattern scorers,
 * pipeline orchestrator, and batch evaluation runner.
 *
 * @example
 * ```typescript
 * import { LLMScorer, createAnswerAccuracyScorer, evaluateAgent } from 'agentforge';
 *
 * const scorer = createAnswerAccuracyScorer({ judge: myLLMAdapter });
 * const result = await scorer.evaluate({
 *   input: 'What is 2+2?',
 *   output: '4',
 *   messages: [],
 *   agentName: 'math-agent',
 *   sessionId: 's1',
 * });
 * ```
 */
export {
  LLMScorer,
  LLMScorerBuilder,
  runScorerPipeline,
  evaluateAgent,
  createAnswerAccuracyScorer,
  createTaskCompletionScorer,
  createSafetyAlignmentScorer,
} from './evaluation/index.js';

export type {
  ScoringContext,
  ScoringResult,
  EvaluationResult,
  ScorerStepResults,
  PreprocessFn,
  AnalyzeFn,
  ScoreFn,
  ReasonFn,
  LLMScorerConfig,
  EvaluatorConfig,
  SamplingConfig,
  PipelineStrategy,
  PipelineOptions,
  TestCase,
  EvaluateAgentOptions,
  EvaluateAgentResult,
} from './evaluation/index.js';

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
