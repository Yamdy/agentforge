// @primo-ai/core — Agent Loop, Processor Pipeline, Context, Tool Registry

export { PipelineRunner, type PipelineRunnerOptions } from './pipeline.js';
export { Agent, createAgent, autoDetectOtelTracer, type AgentDependencies, type RunOptions } from './agent.js';
export type { AgentRunResult } from '@primo-ai/sdk';
export { LLMInvoker, type LLMInvokerOptions, type LLMInvokeInput, type LLMInvokeResult, type LLMStreamHandle } from './llm-invoker.js';
export { assembleContentBlocks, textContentFromBlocks, toolCallsFromBlocks, reasoningFromBlocks } from './content-blocks.js';
export { resolveModel, registerProvider, parseModel, type ParsedModel } from './model-resolver.js';
export { streamWithRetry, type RetryOptions } from './retry.js';
export { PluginManager, type PluginFactory } from './plugin-manager.js';
export { EventBus } from './event-bus.js';
export { EventSystem, REPLAY_SENTINEL } from './event-system.js';
export { StorageReplayBackend } from './storage-replay-backend.js';
export { HookManager, type HookManagerOptions } from './hook-manager.js';
export { ToolRegistry, type AiSdkToolSchema, type ToolRegistryOptions } from './tool-registry.js';
export { FilesystemSessionStorage } from './session-storage.js';
export { SqliteSessionStorage } from './session-storage-sqlite.js';
export { SessionPersistence } from './session-persistence.js';
export { SessionManagerImpl } from './session-manager.js';
export { createSubAgentTool } from './sub-agent.js';
export { deepMerge } from './config-merge.js';
export { HarnessDecisionRecorder, type HarnessDecision, type HarnessDecisionsBag } from './harness-decisions.js';
export { resolveDynamic } from './dynamic-resolver.js';
export { matchProfile, applyProfile } from './model-profile.js';
export { ConfigLoader, type ConfigSource, ConstitutionSchema } from './config.js';
export { ConcurrencyController } from './concurrency-controller.js';
export { FallbackRunner, type FallbackInvoker, type FallbackRunnerOptions } from './fallback-runner.js';
export { TaskManagerImpl } from './task-manager.js';
export { StateMachine, type AgentState } from './state-machine.js';
export { CircuitBreaker, type CircuitBreakerState, type CircuitBreakerConfig, type CircuitBreakerSnapshot } from './circuit-breaker.js';
export { InMemoryRetryStateStore, JsonlRetryStateStore, type RetryStateStore, type RetryStateEntry } from './retry-state-store.js';
export { ModelFactory } from './model-factory.js';
export { LoopOrchestrator, RunMode, type LoopOptions } from './loop-orchestrator.js';
export { serialize, deserialize, SERIALIZATION_VERSION, type SerializableContext } from './serialize.js';
export { InMemoryCheckpointStore, JsonlCheckpointStore } from './checkpoint-store.js';
export {
  InMemorySyncEventStore,
  JsonlSyncEventStore,
  VersionMismatchError,
  type SyncEvent,
  type SyncEventStore,
} from './sync-event.js';
export { ContextBuilder, type ContextBuilderOptions } from './context-builder.js';
export { PluginRegistryImpl, globalPluginRegistry } from './plugin-registry.js';
export { registerBuiltinPluginsOnce } from './builtin-plugins.js';
export { MutabilityPolicyEngine } from './mutability-policy.js';
export { ConfigWatcher, type ConfigWatcherOptions } from './config-watcher.js';
export { SelfRepresentationBuilder, type SelfRepresentationBuilderOptions } from './self-representation.js';
export { ConstitutionEngine } from './constitution.js';
export { VerificationGatePipeline, type VerificationGatePipelineOptions } from './verification-gate.js';
export { DegenerationWatchdog, type WatchdogOptions } from './degeneration-watchdog.js';
export { MutationBudgetEngine, type MutationBudgetOptions } from './mutation-budget.js';
export { applySelfModification, type SelfModificationEngineContext } from './self-modification-engine.js';
export { HarnessAPIImpl, type HarnessDeps } from './harness.js';
export { TiktokenCounter } from './token-counter.js';
export type { StreamEvent } from '@primo-ai/sdk';

// Presets
export * from './presets/index.js';
export { OpenAICompatibleGateway } from './gateways/openai-compatible-gateway.js';
export {
  AgentForgeError,
  RecoverableError,
  FatalError,
  AuthError,
  ModelNotFoundError,
  ToolExecutionError,
  SerializationVersionError,
  type AgentErrorOptions,
} from './errors.js';
export { PermissionManager } from './pending-permission.js';
export type { PendingPermission } from './pending-permission.js';

// Control flow v2 API
export { AbortControlFlow, SuspendControlFlow, ErrorControlFlow, isAbortControlFlow, isSuspendControlFlow, isErrorControlFlow } from './control-flow.js';
export { ProcessorContextImpl, createProcessorContext } from './processor-context.js';

// Adapters - high-level Processor APIs
export { modifiers, message, systemPrompt, tools, providerOptions } from './adapters/modifiers.js';
export { gates, permission, quota, cost } from './adapters/gates.js';
export type { PermissionDecision, PermissionGateConfig, QuotaGateConfig, CostGateConfig } from './adapters/gates.js';

// Task Queue
export { TaskQueueImpl } from './task-queue/index.js';
export {
  InMemoryPersistentQueue,
  JsonlPersistentQueue,
  type QueuedTask,
  type EnqueueOptions,
} from './task-queue/persistent-queue.js';

// Runner - structured concurrency
export { Runner, type RunnerState, type RunnerOptions, type TaskHandle } from './runner.js';
export { Latch } from './latch.js';

// Snapshot Service - file system auditing
export { NodeFsAdapter } from './file-system-adapter.js';
export { InMemorySnapshotStore, JsonlSnapshotStore } from './snapshot-store.js';
export { SnapshotServiceImpl, type SnapshotServiceOptions } from './snapshot-service.js';
export { SnapshotError, ConfigEnvVarError } from './errors.js';

// Memory System - three-layer cognitive memory
export {
  MemorySystem,
  EpisodicMemory,
  SemanticMemory,
  SimpleEmbedder,
  InMemoryStore,
  SqliteStore,
  WorkingMemoryImpl,
  createMemoryRecallProcessor,
  createMemoryStoreProcessor,
} from './memory/index.js';
export type {
  MemorySystemOptions,
  WorkingMemory,
  MemoryEvent,
  EventQuery,
  Fact,
  SearchOptions,
  Entity,
  Relation,
  MemoryEntry,
  RememberOptions,
  RecallOptions,
  ConsolidationResult,
  MemoryStorage,
  EventSummary,
  EmbeddingProvider,
  GraphResult,
  SemanticSearchResult,
} from './memory/index.js';
