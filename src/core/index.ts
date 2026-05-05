/**
 * AgentForge Core - Public API
 *
 * Re-exports all core types and utilities, plus merged thin sub-path types.
 * Internal implementation classes and Zod schemas are NOT exported —
 * import those directly from their source files.
 *
 * @module
 */

// ============================================================
// Events
// ============================================================

export type {
  AgentEventType,
  MessageRole,
  MessageContent,
  ContentPart,
  Message,
  ToolCall,
  FinishReason,
  SerializedError,
  AgentEvent,
} from './events.js';

export {
  isAgentEvent,
  isLLMEvent,
  isToolEvent,
  isAgentLifecycleEvent,
  isTerminalEvent,
  isCompactionEvent,
  serializeError,
  generateId,
} from './events.js';

// ============================================================
// State
// ============================================================

export type {
  BatchContext,
  ContextManagement,
  CheckpointReference,
  ModelConfig,
  TokenStats,
  AgentState,
  RecoveryState,
  CreateInitialStateOptions,
} from './state.js';

export {
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
  recordCompaction as recordStateCompaction,
} from './state.js';

// ============================================================
// Checkpoint
// ============================================================

export type {
  CheckpointPosition,
  A2APendingRequest,
  ExecutedTool,
  RecoveryMetadata,
  CompactionHistory,
  Checkpoint,
  CreateCheckpointOptions,
} from './checkpoint.js';

export {
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
  recordCompaction as recordCheckpointCompaction,
  getTotalCompactionSavings,
  serializeCheckpoint,
  deserializeCheckpoint,
} from './checkpoint.js';

// ============================================================
// Interfaces (DI)
// ============================================================

export type {
  LLMChunk,
  LLMUsage,
  LLMResponse,
  LLMOptions,
  LLMAdapter,
  LLMAdapterFactory,
  ModelSpec,
  ProviderOptions,
  ToolChoice,
  RiskLevel,
  ToolDefinition,
  FunctionDefinition as FunctionDefinitionInterface,
  ToolRegistry as ToolRegistryInterface,
  MemoryStore,
  CheckpointStorage,
  SpanOptions,
  Tracer,
  Metrics,
  HITLAskOptions,
  HITLController,
  PauseController as PauseControllerInterface,
  MCPStatus,
  MCPTool,
  MCPClient,
  MCPServerConfig,
  AgentMode,
  SubagentInfo,
  SubagentRegistry,
  ToolContext as ToolContextInterface,
  ErrorSeverity,
  ErrorCategory,
  ClassifiedError,
  ErrorHandler,
  SchemaRegistry,
  PromptBuildOptions,
  BuiltPrompt,
  PromptBuilder,
  PermissionDecision,
  PolicyDecision,
  PermissionAskOptions,
  PermissionPolicy,
  PermissionController,
  SandboxExecutor,
  AuditLogger,
  RateLimiter,
  InputSanitizer,
} from './interfaces.js';

// ============================================================
// Context
// ============================================================

export type {
  ApplicationServices,
  AgentContext,
  AgentModelConfig,
  StepContext,
} from './context.js';

export { generateSessionId, createDefaultAppServices, createToolContext } from './context.js';

// ============================================================
// Context Builder
// ============================================================

export { ContextBuilder, createApplicationServices } from './context-builder.js';

// ============================================================
// Logger
// ============================================================

export type { Logger } from './logger.js';

// ============================================================
// Hooks
// ============================================================

export {
  RequestHookPriority,
  DEFAULT_REQUEST_HOOK_PRIORITY,
  type LifecyclePhase,
  type HookFn,
  type LifecycleHookEntry,
  type RequestHook,
  type ToolHook,
} from './hooks.js';

// ============================================================
// State Machine
// ============================================================

export type { AgentStateEnum } from './state-machine.js';
export { isValidTransition, getValidTransitions } from './state-machine.js';

// ============================================================
// Approval Channel
// ============================================================

export type {
  ApprovalSource,
  ApprovalAskOptions,
  ApprovalPrompt,
  ApprovalChannel,
} from './approval-channel.js';

// ============================================================
// Content Utilities (Multimodal message content access)
// ============================================================

export { extractText, hasImages, isContentArray } from './content-utils.js';

// ============================================================
// Merged thin sub-paths — lifecycle
// ============================================================

export { GracefulShutdown } from '../lifecycle/index.js';
export type { ShutdownResult } from '../lifecycle/index.js';

// ============================================================
// Merged thin sub-paths — observability
// ============================================================

export type { ResourceMetrics } from '../observability/resource-monitor.js';
export type { HealthCheckerOptions } from '../observability/health-checker.js';
export type { MetricsCollectorOptions } from '../observability/metrics-collector.js';

// ============================================================
// Merged thin sub-paths — quota
// ============================================================

export type { QuotaUsage, QuotaLimits, QuotaController } from '../quota/quota-controller.js';
export { MemoryQuotaController } from '../quota/memory-quota-controller.js';

// ============================================================
// Merged thin sub-paths — validation
// ============================================================

export {
  QualityGate,
  DEFAULT_QUALITY_GATE_CONFIG,
  type QualityGateConfig,
  type QualityGateCheck,
  type QualityGateReason,
  type PatternRule,
} from '../validation/quality-gate.js';

// ============================================================
// Merged thin sub-paths — audit
// ============================================================

export { SqliteAuditStore } from '../audit/sqlite-audit-store.js';
export { sha256, computeEntryHash, verifyChain } from '../audit/hash-chain.js';
