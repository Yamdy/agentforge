/**
 * AgentForge Core - Public API
 *
 * Re-exports all core types and utilities.
 *
 * @module
 */

// ============================================================
// Events
// ============================================================

export {
  AgentEventTypeSchema,
  type AgentEventType,
  MessageRoleSchema,
  type MessageRole,
  MessageSchema,
  type Message,
  ToolCallSchema,
  type ToolCall,
  FinishReasonSchema,
  type FinishReason,
  SerializedErrorSchema,
  type SerializedError,
  AgentEventSchema,
  type AgentEvent,
  isAgentEvent,
  isLLMEvent,
  isToolEvent,
  isHITLEvent,
  isAgentLifecycleEvent,
  isTerminalEvent,
  serializeError,
  generateId,
} from './events.js';

// ============================================================
// State
// ============================================================

export {
  BatchContextSchema,
  type BatchContext,
  ContextManagementSchema,
  type ContextManagement,
  CheckpointReferenceSchema,
  type CheckpointReference,
  ModelConfigSchema,
  type ModelConfig,
  TokenStatsSchema,
  type TokenStats,
  AgentStateSchema,
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
  recordCompaction as recordStateCompaction,
} from './state.js';

// ============================================================
// Checkpoint
// ============================================================

export {
  CheckpointPositionSchema,
  type CheckpointPosition,
  A2APendingRequestSchema,
  type A2APendingRequest,
  ExecutedToolSchema,
  type ExecutedTool,
  RecoveryMetadataSchema,
  type RecoveryMetadata,
  CompactionHistorySchema,
  type CompactionHistory,
  CheckpointSchema,
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
} from './interfaces.js';

// ============================================================
// Context
// ============================================================

export type {
  ApplicationServices,
  AgentContext,
  AgentModelConfig,
  AgentConfig,
  StepContext,
} from './context.js';

export {
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  SimpleSchemaRegistry,
  generateSessionId,
  createDefaultAppServices,
  createToolContext,
} from './context.js';

// ============================================================
// Context Builder
// ============================================================

export {
  ContextBuilder,
  SimpleToolRegistry,
  DelegatingToolRegistry,
  createApplicationServices,
} from './context-builder.js';

// ============================================================
// Zod to Schema
// ============================================================

export {
  zodToJsonSchema,
  zodToFunctionDef,
  toolToFunctionDef,
  toolsToFunctionDefs,
} from './zod-to-schema.js';

// ============================================================
// Prompt Builder
// ============================================================

export {
  DefaultPromptBuilder,
  DEFAULT_SYSTEM_TEMPLATE,
  TOOL_INSTRUCTIONS_TEMPLATE,
} from './prompt-builder.js';

// ============================================================
// State Machine
// ============================================================

export type { AgentStateEnum } from './state-machine.js';
export { AgentStateMachine, isValidTransition, getValidTransitions } from './state-machine.js';
