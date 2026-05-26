// @primo-ai/sdk — public type definitions

// ---------------------------------------------------------------------------
// Pipeline Stage
// ---------------------------------------------------------------------------

/** Agent lifecycle stages: pre-loop setup, agentic loop, and post-loop output. */
export type PipelineStage =
  | 'processInput'
  | 'buildContext'
  | 'planStep'
  | 'prepareStep'
  | 'gateLLM'
  | 'invokeLLM'
  | 'processStepOutput'
  | 'gateTool'
  | 'executeTools'
  | 'compressContext'
  | 'evaluateIteration'
  | 'processOutput';

/** Tool execution sub-pipeline stages — internal to ToolRegistry. */
export type ToolExecutionStage = 'beforeTool' | 'execute' | 'afterTool';

/** Stage name that accepts built-in stages AND arbitrary plugin-defined strings. */
export type StageName = PipelineStage | ToolExecutionStage | (string & {});

/** A mutation operation applied to a pipeline phase's stage list. */
export type StageMutation =
  | { type: 'insert'; phase: 'preLoop' | 'loop' | 'postLoop'; after: StageName; stage: StageName }
  | { type: 'remove'; phase: 'preLoop' | 'loop' | 'postLoop'; stage: StageName }
  | { type: 'replace'; phase: 'preLoop' | 'loop' | 'postLoop'; stages: StageName[] };

/** Configurable pipeline stage sequence. Overrides default stage order when provided. */
export interface PipelineStageConfig {
  preLoop?: StageName[];
  loop?: StageName[];
  postLoop?: StageName[];
}

// ---------------------------------------------------------------------------
// Content Blocks — structured LLM output (Pi-style minimal)
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  text: string;
}

export interface ToolCallBlock {
  type: 'tool-call';
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool-result';
  toolCallId: string;
  name: string;
  output: unknown;
  error?: string;
  /** Suggested next actions the LLM can take based on this tool result. */
  suggestedActions?: string[];
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock | ToolResultBlock;

// ---------------------------------------------------------------------------
// Message (shared by memory, compression, session)
// ---------------------------------------------------------------------------

/** A tool call requested by the LLM. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** The result of executing a tool call. */
export interface ToolResult {
  toolCallId: string;
  name: string;
  output: unknown;
  error?: string;
  mutated?: boolean;
  truncated?: boolean;
  validationError?: string;
  /** Suggested next actions the LLM can take based on this tool result. */
  suggestedActions?: string[];
}

/** Structured conversation message supporting tool-call round-trips. */
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; reasoningContent?: string; source?: string }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string; result?: unknown; error?: string; mutated?: boolean; truncated?: boolean; validationError?: string; suggestedActions?: string[] };

// ---------------------------------------------------------------------------
// Token Counting
// ---------------------------------------------------------------------------

/** Abstract token counter — implementations choose encoding strategy. */
export interface TokenCounter {
  count(text: string, model?: string): number;
  countMessages(messages: Message[], model?: string): number;
}

// ---------------------------------------------------------------------------
// Context Budget
// ---------------------------------------------------------------------------

export interface ContextBudget {
  maxTokens: number;
  reservedForSystem?: number;
  reservedForTools?: number;
  /** Maximum total tokens for the entire agentic loop. Overrides the derived default (maxTokens * 0.8). */
  maxTotalTokens?: number;
  /** Maximum tokens a single iteration can consume. Overrides the derived default (maxTotalTokens / maxIterations). */
  maxIterationTokens?: number;
}

// ---------------------------------------------------------------------------
// Compression Strategy (F-3)
// ---------------------------------------------------------------------------

/** Function that compresses/trim message history before sending to LLM. */
export type CompressionStrategy = (
  messages: Message[],
  tokenCounter: TokenCounter,
  budget: number,
) => Message[] | Promise<Message[]>;

/** Options for the built-in sliding-window strategy. */
export interface SlidingWindowOptions {
  /** Maximum number of most-recent messages to keep. Default: 50. */
  keepRecent?: number;
}

// ---------------------------------------------------------------------------
// Loop Directive (replaces _stopLoop + _retryFrom)
// ---------------------------------------------------------------------------

export type LoopDirective =
  | { action: 'continue' }
  | { action: 'stop' }
  | { action: 'retry'; retryFrom: StageName };

// ---------------------------------------------------------------------------
// Pipeline Context — Three Regions (ADR-0007)
// ---------------------------------------------------------------------------

export interface AgentRegion {
  config: AgentConfig;
  systemPrompt?: string;
  toolDeclarations: Array<{ name: string; description: string }>;
  /** Append-only. Always spread existing: `[...ctx.agent.promptFragments, newFragment]` */
  promptFragments: string[];
  /** Per-provider options passed through to streamText(). Keyed by provider name. */
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Context budget for coordinating ContextBuilder and evaluateIteration. */
  contextBudget?: ContextBudget;
}

export interface IterationRegion {
  step: number;
  /** undefined defaults to 'continue'. Default evaluateIteration sets 'stop'. */
  loopDirective?: LoopDirective;
  /** Structured content blocks from the LLM response. */
  content?: ContentBlock[];
  /** Flat text response. Prefer content[] for structured access. */
  response?: string;
  tokenUsage?: TokenUsage | null;
  /** Tool calls extracted from the LLM response by PipelineRunner stream consumption. */
  pendingToolCalls?: ToolCall[];
  /** Reasoning content from thinking-mode models (e.g. DeepSeek). Must be passed back on subsequent turns. */
  reasoningContent?: string;
  /** Results from executing pending tool calls (set by executeTools processor). */
  toolResults?: ToolResult[];
}

export interface SessionRegion {
  input: string;
  sessionId: string;
  messageHistory?: Message[];
  totalTokenUsage?: TokenUsage;
  /**
   * Plugin extension point. Use plugin ID as key name to avoid collisions.
   * Type-safe usage: SimpleProcessorContext.getState<MyPluginState>('myPlugin')
   */
  custom: Record<string, unknown>;
}

/** Records a single modification to PipelineContext for tracking/debugging. */
export interface ContextModificationRecord {
  /** Name of the processor that made the change. */
  processor: string;
  /** The field/namespace key that was modified. */
  field: string;
  /** Timestamp (ms since epoch) of the modification. */
  timestamp: number;
  /** Previous value at this field, if any. */
  previousValue?: unknown;
}

export interface PipelineContext {
  agent: AgentRegion;
  iteration: IterationRegion;
  session: SessionRegion;
  /** @internal Modification tracking log. Populated by ProcessorContextImpl.setState(). */
  __modifications?: ContextModificationRecord[];
  /** Freeze the top-level properties of this context (shallow). Attached by PipelineRunner. */
  freeze?(): Readonly<PipelineContext>;
  /** Recursively freeze this context and all nested objects/arrays. Attached by PipelineRunner. */
  deepFreeze?(): Readonly<PipelineContext>;
}

// ---------------------------------------------------------------------------
// Prompt Fragment
// ---------------------------------------------------------------------------

export interface PromptFragment {
  role: 'system' | 'context' | 'instruction';
  content: string;
  priority: number;
  source: string;
}

// ---------------------------------------------------------------------------
// Processor Control Flow (v2 API)
// ---------------------------------------------------------------------------

/**
 * Control flow API for processors to abort or suspend the pipeline.
 * These methods throw special errors that PipelineRunner catches for flow control.
 */
export interface ProcessorControl {
  /** Abort the pipeline with optional retry from a specific stage. */
  abort(reason: string, retryFrom?: StageName): never;
  /** Suspend the pipeline with a checkpoint for later resume. */
  suspend(suspensionId: string, checkpoint?: Partial<PipelineCheckpoint>): never;
  /** Signal an error with optional recoverability flag. */
  error(error: Error, stage: StageName, recoverable?: boolean): never;
}

/**
 * Context passed to Processor.execute().
 * - state: mutable PipelineContext (processors can modify directly)
 * - control: flow control API (throws on abort/suspend)
 */
export interface ProcessorContext {
  state: PipelineContext;
  control: ProcessorControl;
  /** Per-stage observability span. Set by PipelineRunner before processor execution. */
  span?: Span;
  /** @internal Stream handle for passing LLM stream promises between invokeLLM and PipelineRunner. */
  _streamHandle?: {
    fullStream?: AsyncIterable<unknown>;
    usagePromise?: Promise<TokenUsage | null>;
    reasoningPromise?: Promise<string | undefined>;
  };
  /** Set namespaced state with modification tracking. Records processor name and timestamp. */
  setState?(namespace: string, value: unknown): void;
  /** Get namespaced state from session.custom. */
  getState?<T = unknown>(namespace: string): T | undefined;
  /** Return all modification records accumulated so far. */
  getModifications?(): ContextModificationRecord[];
  /** Return all dot-separated namespace prefixes used (e.g. ['plugin.memory', 'plugin.compression']). */
  getNamespaces?(): string[];
}

// ---------------------------------------------------------------------------
// Processor Signals (data structures for events and internal use)
// ---------------------------------------------------------------------------

export interface AbortSignal {
  type: 'abort';
  reason: string;
  retryFrom?: StageName;
}

export interface PipelineCheckpoint {
  context: PipelineContext;
  nextStages: StageName[];
  iteration: number;
  expiresAt?: string;
}

export interface SuspensionSignal {
  type: 'suspend';
  suspensionId: string;
  reason: string;
  checkpoint: PipelineCheckpoint;
}

export interface ErrorResult {
  type: 'error';
  error: Error;
  stage: StageName;
  recoverable?: boolean;
}

/**
 * Structured result returned by Processor.execute().
 * Provides observation fields so orchestrators and debuggers can understand
 * what each processor did without deep context knowledge.
 *
 * - status: outcome of the processor execution
 * - summary: human-readable description of what happened
 * - nextActions: suggested next steps for the LLM or orchestrator
 * - artifacts: named references (file paths, IDs, etc.) produced by this step
 */
export interface ProcessorResult {
  status: 'success' | 'warning' | 'error';
  summary: string;
  nextActions?: string[];
  artifacts?: Record<string, string>;
}

/**
 * Processor -- Business logic unit in the pipeline.
 *
 * Implement execute(ctx: ProcessorContext): Promise<ProcessorResult | PipelineContext | void>
 * - Access state via ctx.state, control flow via ctx.control.abort()/suspend()
 * - Return ProcessorResult for structured observation, PipelineContext for context mutation,
 *   or void for in-place mutation (backward compatible)
 *
 * Boundary rules:
 * - Need to modify ctx -> Use Processor
 * - Need to intercept/deny -> Use Hook
 * - Only need to observe -> Use Event (subscribe/on)
 */
export interface Processor {
  stage: StageName;
  execute(context: ProcessorContext): Promise<ProcessorResult | PipelineContext | void>;
  /** When true, this processor is an extension point placeholder that just returns ctx unchanged. */
  isNoOp?: boolean;
  /** Execution priority within the stage (descending, default 100). Higher runs first. */
  priority?: number;
}

// ---------------------------------------------------------------------------
// Processor Registry (Phase 1b)
// ---------------------------------------------------------------------------

/** Built-in processor names that can be resolved from the registry. */
export type BuiltinProcessorName =
  | 'processInput' | 'buildContext' | 'planStep' | 'prepareStep' | 'gateLLM'
  | 'invokeLLM' | 'processStepOutput' | 'gateTool'
  | 'executeTools' | 'compressContext' | 'evaluateIteration' | 'processOutput';

/** Describes how to obtain a Processor — either a built-in name or an external module. */
export type ProcessorDescriptor =
  | { builtin: BuiltinProcessorName }
  | { module: string; export?: string; config?: Record<string, unknown> };

/** Dependencies injected into Processor factories during resolution. */
export interface ProcessorDeps {
  getLLM?: (systemPrompt?: string) => Promise<unknown>;
  registry?: unknown;
  hookManager?: unknown;
  eventBus?: unknown;
  modelString?: string;
  config?: Record<string, unknown>;
}

/** Factory function that creates a Processor given its dependencies. */
export type ProcessorFactory = (deps?: ProcessorDeps) => Processor;

// ---------------------------------------------------------------------------
// Tool System
// ---------------------------------------------------------------------------

export interface ToolExecutionContext {
  harness?: unknown;
  span?: SpanContext;
  sessionId?: string;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  requireApproval?: boolean | ((input: unknown) => boolean);
  allowOutputMutation?: boolean;
  renderCall?(input: TInput): string;
  renderResult?(output: TOutput): string;
}

export type ToolDefinition = Tool;

/**
 * Resolve the `requireApproval` field of a Tool to a boolean.
 * If the field is a function, it is called with the tool input.
 * If the field is undefined or a boolean, it is returned directly (undefined defaults to false).
 */
export function resolveRequireApproval(tool: Tool, input: unknown): boolean {
  const ra = tool.requireApproval;
  if (ra === undefined) return false;
  if (typeof ra === 'boolean') return ra;
  return ra(input);
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export interface SpanContext {
  spanId: string;
  traceId: string;
}

export interface Span {
  readonly name: string;
  startChild(name: string): Span;
  end(): void;
  setAttribute(key: string, value: unknown): Span;
  addEvent(name: string, attributes?: Record<string, unknown>): Span;
  spanContext(): SpanContext;
}

export interface Tracer {
  startSpan(name: string): Span;
  getCurrentSpan(): Span | undefined;
}

export interface Metrics {
  increment(name: string, delta?: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
}

// ---------------------------------------------------------------------------
// Token Usage
// ---------------------------------------------------------------------------

export interface TokenUsage {
  input: number;
  output: number;
}

// ---------------------------------------------------------------------------
// Span Types
// ---------------------------------------------------------------------------

export const SpanType = {
  AGENT_RUN: 'agent_run',
  MODEL_STEP: 'model_step',
  TOOL_CALL: 'tool_call',
  PROCESSOR_RUN: 'processor_run',
  // Phase 2 — harness & detailed observability
  LLM_STREAM: 'llm.stream',
  TOOL_EXECUTE: 'tool.execute',
  GATE_DECISION: 'harness.gate',
  COST_CAP_CHECK: 'harness.cost-cap',
  TOKEN_BUDGET_CHECK: 'harness.token-budget',
  GOAL_ECHO: 'harness.goal-echo',
  FACT_INJECTION: 'harness.fact-injection',
  COMPRESSION: 'harness.compression',
  // Phase 2 — subsystem coverage
  SESSION_LIFECYCLE: 'session.lifecycle',
  TOOL_REGISTER: 'tool.register',
  TOOL_LOOKUP: 'tool.lookup',
  EVENT_DISPATCH: 'event.dispatch',
  GATEWAY_RESOLVE: 'gateway.resolve',
  CONTEXT_BUILD: 'context.build',
  LOOP_ITERATION: 'loop.iteration',
  SUB_AGENT_RUN: 'subagent.run',
  CHECKPOINT: 'checkpoint',
  MCP_CONNECT: 'mcp.connect',
  MCP_TOOL_CALL: 'mcp.tool_call',
} as const;

/** Standard span attribute keys for consistent observability across the framework. */
export const SpanAttributeKeys = {
  // Token / Cost
  TOKENS_INPUT: 'tokens.input',
  TOKENS_OUTPUT: 'tokens.output',
  TOKENS_TOTAL: 'tokens.total',
  COST_ESTIMATED: 'cost.estimated',
  COST_CUMULATIVE: 'cost.cumulative',
  COST_BUDGET: 'cost.budget',
  // Model
  MODEL_NAME: 'model.name',
  // Tool
  TOOL_NAME: 'tool.name',
  TOOL_RESULT_SIZE: 'tool.result_size',
  // Harness gates
  HARNESS_DECISION: 'harness.decision',
  HARNESS_REASON: 'harness.reason',
  // Budget
  BUDGET_CONTEXT_MAX: 'budget.context_max',
  BUDGET_CONTEXT_USED: 'budget.context_used',
  BUDGET_RESERVED_OUTPUT: 'budget.reserved_output',
  // Goal echo
  GOAL_TEXT: 'goal.text',
  GOAL_PROGRESS: 'goal.progress',
  GOAL_ITERATION: 'goal.iteration',
  // Fact injection
  FACT_COUNT: 'fact.count',
} as const;

export type SpanType = (typeof SpanType)[keyof typeof SpanType];

// ---------------------------------------------------------------------------
// Stream Events
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'stage_start'; stage: StageName }
  | { type: 'stage_complete'; stage: StageName }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'complete'; context: PipelineContext }
  | { type: 'abort'; reason: string; retryFrom?: StageName }
  | { type: 'suspended'; suspensionId: string; reason: string; checkpoint: PipelineCheckpoint }
  | { type: 'error'; error: Error; stage: StageName; recoverable?: boolean }
  // Session lifecycle events
  | { type: 'session.started'; sessionId: string }
  | { type: 'session.completed'; sessionId: string; tokenUsage: TokenUsage }
  | { type: 'session.aborted'; sessionId: string }
  | { type: 'session.resumed'; sessionId: string }
  // Permission events
  | { type: 'permission.request'; sessionId: string; permissionId: string; toolName: string; args: Record<string, unknown>; reason: string }
  | { type: 'permission.resolved'; sessionId: string; permissionId: string; decision: 'allow' | 'deny' }
  // Structured content block lifecycle events (Phase 3)
  | { type: 'content_block_start'; blockType: ContentBlock['type']; index: number }
  | { type: 'content_block_delta'; index: number; delta: string }
  | { type: 'content_block_end'; index: number; block: ContentBlock }
  | { type: 'step_complete'; step: number; tokenUsage: TokenUsage; content: ContentBlock[] }
  | { type: 'tool_execution_start'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_execution_end'; toolCallId: string; name: string; result: unknown; error?: string }
  // Processor observation event (F-5)
  | { type: 'processor_result'; stage: StageName; result: ProcessorResult };

/** @deprecated Use StreamEvent — the union now includes all event types */
export type ServerStreamEvent = StreamEvent;

// ---------------------------------------------------------------------------
// Plugin System
// ---------------------------------------------------------------------------

export type EventType = 'agent:start' | 'agent:end' | 'tool:before' | 'tool:after' | string;

export type HookPoint =
  | 'agent.start'
  | 'agent.end'
  | 'stage.before'
  | 'stage.after'
  | 'llm.before'
  | 'llm.after'
  | 'tool.before'
  | 'tool.after'
  | 'iteration.end'
  | 'error';

export type HookProfile = 'minimal' | 'standard' | 'strict';

export interface Hook<TInput = unknown, TOutput = unknown> {
  point: HookPoint;
  name?: string;
  handler: (input: TInput, output: TOutput) => void | Promise<void>;
  priority?: number;
}

/** A group of hooks executed as a unit with a specific orchestration mode. */
export interface CompositeHook {
  hooks: Hook[];
  mode: 'parallel' | 'sequential' | 'first-wins';
}

export interface AgentHookInput {
  sessionId: string;
  session: SessionRegion;
  agentConfig: AgentConfig;
}

export interface StageHookInput {
  stage: StageName;
  context: PipelineContext;
}

export interface LLMHookInput {
  model: string;
  messages: Message[];
  tools?: unknown[];
  options?: Record<string, unknown>;
}

export interface ToolHookInput {
  toolName: string;
  args: unknown;
  sessionId: string;
}

export interface ErrorHookInput {
  error: unknown;
  stage: StageName;
  sessionId: string;
}

export interface ResourceDeclaration {
  id: string;
  type: string;
  config: Record<string, unknown>;
  start: () => Promise<unknown>;
  stop: (instance: unknown) => Promise<void>;
}

/** Pipeline extension: register Processors */
export interface PipelineRegistry {
  registerProcessor(stage: StageName, processor: Processor): void;
}

/** Tool registration */
export interface ToolRegistryAPI {
  registerTool(tool: ToolDefinition): void;
  unregisterTool(name: string): boolean;
}

/** Interception & events */
export interface InterceptionAPI {
  registerHook(hook: Hook | CompositeHook): void;
  subscribe(eventType: string, handler: (data?: unknown) => void): () => void;
  emit(eventType: string, data?: unknown): void;
}

/** Pipeline stage mutation (frozen after agent starts) */
export interface StageMutationAPI {
  insertStage(phase: 'preLoop' | 'loop' | 'postLoop', after: StageName, newStage: StageName): void;
  removeStage(phase: 'preLoop' | 'loop' | 'postLoop', stage: StageName): void;
  replaceStages(phase: 'preLoop' | 'loop' | 'postLoop', stages: StageName[]): void;
}

/** Lifecycle & model providers */
export interface LifecycleAPI {
  registerResource(declaration: ResourceDeclaration): void;
  registerProvider(name: string, factory: unknown): void;
  registerCompressionStrategy(strategy: CompressionStrategy): void;
  registerCommand(name: string, handler: (args: string) => Promise<void>): void;
}

/** Full Harness API — composes all sub-interfaces.
 *  Plugin devs can depend on individual sub-interfaces for selective dependency. */
export interface HarnessAPI extends
  PipelineRegistry,
  ToolRegistryAPI,
  InterceptionAPI,
  StageMutationAPI,
  LifecycleAPI
{}

export interface PluginRegistration {
  processors?: Processor[];
  tools?: ToolDefinition[];
  commands?: Record<string, (args: string) => Promise<void>>;
  compressionStrategy?: CompressionStrategy;
}

// ---------------------------------------------------------------------------
// MCP Server Configuration (Issue 15)
// ---------------------------------------------------------------------------

/** Transport protocol for MCP server connections. */
export type McpTransport = 'stdio' | 'sse' | 'http';

/**
 * Configuration for an MCP (Model Context Protocol) server connection.
 * For stdio transport, provide `command`. For sse/http transport, provide `url`.
 */
export interface McpServerConfig {
  name: string;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

// ---------------------------------------------------------------------------
// Plugin Registry (Phase 3)
// ---------------------------------------------------------------------------

/** Built-in plugin IDs that can be resolved from the registry. */
export type BuiltinPluginId =
  | 'memory' | 'compression' | 'permission' | 'skill'
  | 'eviction' | 'mcp' | 'validation';

/** Describes how to obtain a Plugin — either a built-in id or an external module. */
export type PluginDescriptor =
  | { id: BuiltinPluginId; config?: Record<string, unknown> }
  | { module: string; config?: Record<string, unknown> };

/** Describes a hook to be registered from config, backed by a named plugin. */
export interface HookDescriptor {
  point: HookPoint;
  plugin: BuiltinPluginId;
  config?: Record<string, unknown>;
  priority?: number;
}

/** Configures which tools are available to an agent. */
export interface ToolSetConfig {
  /** Tool names to include. '*' = all. */
  include?: string[];
  /** Tool names to exclude (takes precedence over include). */
  exclude?: string[];
  /** Custom tool definitions to register. */
  custom?: Tool[];
  /** Legacy: tool names to enable. */
  enabled?: string[];
  /** Legacy: tool names to disable. */
  disabled?: string[];
}

// ---------------------------------------------------------------------------
// Mutability Policy (Phase 4)
// ---------------------------------------------------------------------------

/** Runtime mutability level for a config domain. */
export type MutabilityLevel = 'frozen' | 'configOnly' | 'configurable' | 'dynamic';

/** Domains whose mutability can be independently controlled. */
export type MutabilityDomain = 'pipeline' | 'processors' | 'plugins' | 'tools';

/** Controls what can change at runtime and how. */
export interface MutabilityPolicy {
  pipeline: MutabilityLevel;
  processors: MutabilityLevel;
  plugins: MutabilityLevel;
  tools: MutabilityLevel;
  hotReload: boolean;
  watchConfig: boolean;
}

/** Result of an Agent.reload() call. */
export interface ReloadResult {
  applied: boolean;
  rejectedKeys?: string[];
  appliedKeys?: string[];
}

// ---------------------------------------------------------------------------
// Autonomous Gap Optimization (Phase 5)
// ---------------------------------------------------------------------------

/** Trigger that starts a gap optimization cycle when the agent is idle. */
export type GapTrigger =
  | { type: 'idle'; idleTimeoutMs: number }
  | { type: 'schedule'; cron: string }
  | { type: 'afterRun'; minIntervalMs: number }
  | { type: 'onError' };

/** Configuration for autonomous gap optimization. */
export interface AutonomousConfig {
  enabled: boolean;
  gapTriggers: GapTrigger[];
  initialPrompt?: string;
  nextPromptTemplate?: string;
  maxOptimizationsPerGap?: number;
  maxConsecutiveErrors?: number;
  errorBackoffMs?: number;
}

/** A proposed self-modification collected during gap optimization. */
export interface SelfModificationRequest {
  type: 'replaceProcessor' | 'registerPlugin' | 'modifySource';
  target: string;
  payload: unknown;
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  proposedDiff?: FilePatch[];
}

// ---------------------------------------------------------------------------
// Self-Representation (Phase 6a)
// ---------------------------------------------------------------------------

/** Health check result for a single ECC layer or component. */
export interface HealthCheckResult {
  healthy: boolean;
  reason?: string;
  metrics?: Record<string, number>;
}

/** A module tracked in the agent's self-representation. */
export interface ModuleInfo {
  name: string;
  path: string;
  responsibility: string;
  mutability: MutabilityLevel;
  exports: string[];
  dependsOn: string[];
}

/** A dependency edge between two modules. */
export interface ModuleDependency {
  from: string;
  to: string;
  type: 'uses' | 'implements' | 'extends';
}

/** ECC 12-layer diagnostic entry for self-representation. */
export interface LayerDiagnostic {
  layer: number;
  name: string;
  agentForgeComponent: string;
  codeGated: boolean;
  knownFailurePatterns: string[];
  lastCheckResult?: HealthCheckResult;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/** Record of a self-modification applied to the agent. */
export interface ModificationRecord {
  timestamp: string;
  module: string;
  type: 'processor' | 'plugin' | 'config' | 'source';
  diff: string;
  verificationResult: 'passed' | 'failed' | 'skipped';
  approvedBy: 'auto' | 'human' | 'constitution';
}

/** Complete self-representation of the agent's architecture. */
export interface SelfRepresentation {
  modules: ModuleInfo[];
  dependencies: ModuleDependency[];
  layerDiagnostics: LayerDiagnostic[];
  constitution: unknown;
  modificationHistory: ModificationRecord[];
}

// ---------------------------------------------------------------------------
// Constitution System (Phase 6b)
// ---------------------------------------------------------------------------

/** Protection level for a file path. */
export interface ProtectedPath {
  pattern: string;
  reason: string;
  level: 'absolute' | 'approval';
}

/** Limits on diff size and mutation rate. */
export interface DiffLimits {
  maxFilesPerMutation: number;
  maxLinesPerFile: number;
  maxMutationsPerHour: number;
  maxMutationsPerDay: number;
  cooldownMs: number;
}

/** An immutable interface member that cannot be modified by the agent. */
export interface ImmutableInterface {
  module: string;
  export: string;
  members: string[];
  reason: string;
}

/** Risk levels for self-modification. */
export type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

/** Approval modes for self-modification risk levels. */
export type ApprovalMode = 'auto' | 'auto_with_audit' | 'human_approval' | 'always_reject';

/** Approval matrix for different risk levels. */
export interface ApprovalMatrix {
  L0: { description: string; mode: 'auto' };
  L1: { description: string; mode: 'auto_with_audit'; auditTarget: string; auditEvent: string; auditPayload: string[] };
  L2: { description: string; mode: 'human_approval' };
  L3: { description: string; mode: 'human_approval' };
  L4: { description: string; mode: 'always_reject' };
}

/** Constitution — the immutable boundary definition for self-modification. */
export interface Constitution {
  version: 1;
  protectedPaths: ProtectedPath[];
  diffLimits: DiffLimits;
  immutableInterfaces: ImmutableInterface[];
  requiredCapabilities: string[];
  benchmarkFiles: string[];
  approvalMatrix: ApprovalMatrix;
}

// ---------------------------------------------------------------------------
// Verification Gate (Phase 6c)
// ---------------------------------------------------------------------------

/** Result of a single verification gate. */
export type GateResult =
  | { passed: true; duration: number; details?: string }
  | { passed: false; duration: number; errors: string[]; gate: string; protectionLevel?: 'absolute' | 'approval' };

/** A single verification gate in the pipeline. */
export interface VerificationGate {
  name: string;
  level: number;
  timeoutMs: number;
  execute(diff: FilePatch[], context: VerificationContext): Promise<GateResult>;
}

/** Context passed to verification gates. */
export interface VerificationContext {
  constitution: Constitution;
  snapshotId: string;
  agentId: string;
}

/** Complete verification report for a self-modification attempt. */
export interface VerificationReport {
  timestamp: string;
  diff: FilePatch[];
  gates: GateResult[];
  overall: 'passed' | 'failed';
  approvedBy: 'auto' | 'human';
}

/** Result of processing a self-modification request. */
export interface SelfModificationResult {
  accepted: boolean;
  verificationReport?: VerificationReport;
  rollbackSnapshotId?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Degeneration Watchdog (Phase 6d)
// ---------------------------------------------------------------------------

/** Health check result. */
export type HealthCheckOutcome =
  | { healthy: true; metrics?: Record<string, number> }
  | { healthy: false; reason: string; severity: 'warning' | 'critical' };

/** A single health check definition. */
export interface HealthCheck {
  name: string;
  level: 'L0' | 'L1' | 'L2';
  check: () => Promise<HealthCheckOutcome>;
}

/** Watchdog configuration. */
export interface WatchdogConfig {
  checkIntervalMs: number;
  degradationThreshold: number;
  healthChecks: HealthCheck[];
  autoRollback: boolean;
  rollbackTarget: 'lastKnownGood' | 'lastSnapshot';
}

/** Watchdog runtime state. */
export interface WatchdogState {
  consecutiveFailures: number;
  lastHealthySnapshot: string;
  lastCheckTime: string;
  totalRollbacks: number;
}

// ---------------------------------------------------------------------------
// Mutation Budget (Phase 6e)
// ---------------------------------------------------------------------------

/** Mutation budget configuration. */
export interface MutationBudgetConfig {
  maxMutationsPerHour: number;
  maxMutationsPerDay: number;
  maxDiffLinesPerMutation: number;
  maxFilesPerMutation: number;
  cooldownMs: number;
}

/** Mutation budget runtime state. */
export interface MutationBudgetState {
  hourlyCount: number;
  hourlyResetAt: number;
  dailyCount: number;
  dailyResetAt: number;
  lastMutationAt: number;
}

// ---------------------------------------------------------------------------
// Agent Config (skeleton)
// ---------------------------------------------------------------------------

export interface AgentConfig {
  model: string;
  systemPrompt?: Dynamic<string>;
  maxIterations?: Dynamic<number>;
  tools?: Tool[];
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Tool names that must be called at least once before the loop can stop. */
  requiredTools?: string[];
  /** Policy for handling required tools that the LLM fails to call after retries.
   *  - 'advise' (default): adds prompt fragments asking the LLM to call them; stops loop when exhausted.
   *  - 'enforce': when exhausted, injects synthetic tool calls and continues the loop.
   */
  requiredToolPolicy?: 'advise' | 'enforce';
}

// ---------------------------------------------------------------------------
// AgentSimpleConfig — Convenience type for single-agent usage
// ---------------------------------------------------------------------------

/** Convenience config for single-agent usage. Static fields only — no Dynamic<T> or advanced options. */
export interface AgentSimpleConfig {
  model: string;
  systemPrompt?: string;
  maxIterations?: number;
  tools?: Tool[];
}

// ---------------------------------------------------------------------------
// Dynamic Config Resolution (ADR-0008)
// ---------------------------------------------------------------------------

/** Context passed to Dynamic<T> resolver functions at processInput stage. */
export interface ResolveContext {
  input: string;
  sessionId: string;
  metadata: Record<string, unknown>;
}

/** A value that is either static T or resolved per-request via a function. */
export type Dynamic<T> = T | ((ctx: ResolveContext) => T | Promise<T>);

// ---------------------------------------------------------------------------
// Provider Capabilities & Compat Rules (P3)
// ---------------------------------------------------------------------------

/** Declares what a specific provider supports in message format. */
export interface ProviderCapabilities {
  supportsReasoning: boolean;
  supportsToolCalling: boolean;
  supportsParallelToolCalls: boolean;
  requiresAlternatingRoles: boolean;
  rejectsEmptyAssistantContent: boolean;
  toolCallIdPattern?: RegExp;
}

/** A compatibility rule that normalizes messages for a specific provider. */
export interface CompatRule {
  name: string;
  providers: string[] | '*';
  /** Preemptive: rewrite AI SDK messages before sending. Does NOT mutate persisted history. */
  applyToPrompt?(messages: unknown[], capabilities: ProviderCapabilities): unknown[];
  /** Reactive: fix persisted history after an API error. Return null if unfixable. */
  fixHistory?(history: Message[], error: unknown): Message[] | null;
  /** Patterns matched against API error messages for reactive rules. */
  errorPatterns?: RegExp[];
}

/** Describes a single modification made by a compat rule. */
export interface CompatDiffEntry {
  index: number;
  ruleName: string;
  description: string;
}

/** Result of applying reactive compat rules: fixed history + diff describing changes. */
export interface CompatResult {
  history: Message[];
  diff: CompatDiffEntry[];
}

// ---------------------------------------------------------------------------
// Model Profile (ADR-0008)
// ---------------------------------------------------------------------------

/** Per-model behavior customization, applied at buildContext stage. */
export interface ModelProfile {
  modelPattern: string | RegExp;
  systemPromptSuffix?: string;
  toolOverrides?: { [toolName: string]: { description?: string; exclude?: boolean } };
  extraPromptFragments?: PromptFragment[];
}

// ---------------------------------------------------------------------------
// Model Gateway (ADR-0008)
// ---------------------------------------------------------------------------

/** Pluggable model resolver. Tried in registration order; first match wins. */
export interface ModelGateway {
  name: string;
  canResolve(modelString: string): boolean;
  resolve(modelString: string): Promise<unknown>;
}

/** Serializable config for an OpenAI-compatible custom gateway. */
export interface GatewayConfig {
  name: string;
  url: string;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Harness Configuration (Issue 16)
// ---------------------------------------------------------------------------

/**
 * Top-level framework configuration.
 * @internal For multi-agent and server deployments. For single-agent usage, use `AgentSimpleConfig` or `createAgent()`.
 * Merged from multiple layers (highest priority first):
 *   1. Session-level — runtime parameters passed to agent.run()
 *   2. Project-level — .agentforge/config.jsonc in project root
 *   3. Global-level  — ~/.agentforge/config.jsonc in user home
 *   4. Environment   — AGENTFORGE_CONFIG env var (inline JSON)
 */
export interface HarnessConfig {
  agents?: Record<string, Partial<AgentConfig>>;
  tools?: ToolSetConfig;
  plugins?: PluginDescriptor[] | string[];
  session?: { storage?: 'file' | 'memory'; path?: string };
  modelProfiles?: ModelProfile[];
  modelGateways?: GatewayConfig[];
  hooks?: HookDescriptor[] | { profile?: HookProfile; disabledHooks?: string[] };
  skills?: { paths?: string[] };
  /** Override default pipeline stage order. */
  pipeline?: PipelineStageConfig;
  /** Override which Processor is used for each pipeline stage. Keys are stage names. */
  processors?: Record<string, ProcessorDescriptor>;
  /** Runtime mutability policy. Controls what can change at runtime. */
  mutability?: MutabilityPolicy | MutabilityLevel;
  /** Autonomous gap optimization configuration. */
  autonomous?: AutonomousConfig;
  // Phase 2 — harness processor configurations
  costCap?: {
    maxCost: number;
    strategy: 'block' | 'warn';
    modelPricing?: Record<string, { input: number; output: number }>;
  };
  tokenBudget?: {
    maxContextTokens: number;
    reservedOutputTokens: number;
    strategy: 'compress' | 'truncate' | 'block';
  };
  goalEcho?: {
    enabled: boolean;
    echoFrequency: number;
    progressTracking: boolean;
  };
  factInjection?: {
    facts: string[] | ((ctx: PipelineContext) => string[] | Promise<string[]>);
  };
  /** Custom compat rules for provider-specific message normalization. Defaults to built-in rules. */
  compatRules?: CompatRule[];
}

// ---------------------------------------------------------------------------
// Session Persistence
// ---------------------------------------------------------------------------

export type SessionStatus = 'active' | 'completed' | 'suspended' | 'cancelled' | 'error';

export interface SessionRecord {
  sessionId: string;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  model?: string;
  tokenUsage?: TokenUsage;
}

export interface SessionEvent {
  seq: number;
  timestamp: string;
  type: string;
  payload: unknown;
  /** SHA-256 checksum of JSON.stringify({seq,timestamp,type,payload}). Auto-computed by FilesystemSessionStorage.append(). */
  checksum?: string;
}

export interface IntegrityReport {
  sessionId: string;
  valid: boolean;
  totalEvents: number;
  invalidEvents: number;
  errors: Array<{ seq: number; expected: string; actual: string }>;
}

export interface SessionStorage {
  append(sessionId: string, event: SessionEvent): Promise<void>;
  read(sessionId: string): AsyncIterable<SessionEvent>;
  list(filter?: { parentSessionId?: string; status?: SessionStatus }): Promise<SessionRecord[]>;
  updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  delete(sessionId: string): Promise<void>;
  getMessages(sessionId: string, options?: { limit?: number; before?: string }): Promise<Message[]>;
  verifyIntegrity(sessionId: string): Promise<IntegrityReport>;
  /** Delete expired sessions based on TTL. Returns number of sessions deleted. */
  cleanup(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Checkpoint Store
// ---------------------------------------------------------------------------

export interface CheckpointStore<T = unknown> {
  save(sessionId: string, data: T): Promise<void>;
  load(sessionId: string): Promise<T | undefined>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Snapshot Service (FileSystem Auditing)
// ---------------------------------------------------------------------------

/** Abstract interface for file system operations. Enables testing and remote FS support. */
export interface FileSystemAdapter {
  readFile(path: string): Promise<string | Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(pattern: string): Promise<string[]>;
  hashFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

/** Snapshot of a single file's state. */
export interface FileSnapshot {
  path: string;
  hash: string;
  /** File content captured at snapshot time when storeContent=true. Used for revert. */
  content?: string;
}

/** Complete snapshot of tracked files at a point in time. */
export interface Snapshot {
  id: string;
  createdAt: string;
  files: FileSnapshot[];
  hasContent: boolean;
  metadata?: Record<string, unknown>;
}

/** Difference between two file states. */
export interface FilePatch {
  path: string;
  oldHash?: string;
  newHash?: string;
  type: 'created' | 'modified' | 'deleted';
  /** New file content — used by constitution gate for content inspection. */
  content?: string;
  /** Original file content — used for rollback. */
  oldContent?: string;
}

/** Persistent storage for snapshots. */
export interface SnapshotStore {
  save(snapshot: Snapshot): Promise<void>;
  load(snapshotId: string): Promise<Snapshot | undefined>;
  delete(snapshotId: string): Promise<void>;
  list(): Promise<string[]>;
}

/** Service for tracking, diffing, and reverting file system changes. */
export interface SnapshotService {
  /** Start tracking files matching patterns. Returns snapshot ID. */
  track(storeContent?: boolean): Promise<string>;
  /** Get the differences between current state and a snapshot. */
  patch(snapshotId: string): Promise<FilePatch[]>;
  /** Revert files to the state captured in a snapshot. */
  revert(snapshotId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Event Replay (EventSystem)
// ---------------------------------------------------------------------------

/** Backend capable of querying persisted events for replay. */
export interface ReplayBackend {
  /** Return all stored events for a session, ordered by sequence number. */
  query(sessionId: string): Promise<SessionEvent[]>;
}

/** Options controlling which events are replayed and how. */
export interface ReplayOptions {
  /** Only replay events whose type is in this list. Undefined = all types. */
  eventTypes?: string[];
  /** Start replaying from this sequence number (inclusive). Default: 1. */
  fromSeq?: number;
  /** Stop replaying at this sequence number (inclusive). Undefined = no upper bound. */
  toSeq?: number;
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

export interface SessionManager {
  start(input: string, options?: { parentSessionId?: string }): Promise<SessionRecord>;
  restore(sessionId: string): Promise<PipelineContext>;
  suspend(sessionId: string, reason: string): Promise<void>;
  /** Create a child session to continue a completed session (returns new sessionId). */
  resume(sessionId: string, input?: string): Promise<string>;
  /** Resume a suspended session in-place (same sessionId, suspended → active). */
  resumeInPlace(sessionId: string): Promise<void>;
  list(filter?: { parentSessionId?: string }): Promise<SessionRecord[]>;
}

// ---------------------------------------------------------------------------
// Sub-Agent
// ---------------------------------------------------------------------------

export interface SubAgentConfig {
  name: string;
  description?: string;
  inputSchema?: unknown;
  model?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxIterations?: number;
  contextPolicy: 'isolated' | 'inherit' | 'summary-only';
}

export interface SubAgentResult {
  response: string;
  tokenUsage: TokenUsage;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Runtime Safety — Concurrency & Fallback (Issue 17)
// ---------------------------------------------------------------------------

/** Named concurrency slot with a maximum parallelism limit. */
export interface ConcurrencySlot {
  key: string;
  maxConcurrent: number;
}

/** An entry in an ordered model fallback chain. 0 = highest priority. */
export interface FallbackEntry {
  model: string;
  priority: number;
}

// ---------------------------------------------------------------------------
// Async Sub-Agents (Issue 17)
// ---------------------------------------------------------------------------

/** Status of an async task through its lifecycle. */
export type AsyncTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Configuration for an async (background) sub-agent. */
export interface AsyncTaskConfig extends SubAgentConfig {
  concurrencySlot?: ConcurrencySlot;
  fallbackModels?: FallbackEntry[];
}

/** Handle to a running or completed async sub-agent task. */
export interface AsyncTaskHandle {
  taskId: string;
  status: AsyncTaskStatus;
  result?: SubAgentResult;
  error?: Error;
  cancel(): void;
  on_complete(handler: (result: SubAgentResult) => void): void;
}

/** Manager for async sub-agent tasks. */
export interface TaskManager {
  launch(config: AsyncTaskConfig, prompt: string): Promise<AsyncTaskHandle>;
  get(taskId: string): AsyncTaskHandle | undefined;
  cancel(taskId: string): void;
  list(filter?: { parentSessionId?: string }): AsyncTaskHandle[];
}

// ---------------------------------------------------------------------------
// Task Queue — Long-running Task Management
// ---------------------------------------------------------------------------

/** Status of a task in the queue through its lifecycle. */
export type TaskStatus = 'pending' | 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled';

/** Event types emitted by task queue operations. */
export type TaskEvent = 'progress' | 'complete' | 'error' | 'suspend';

/** Configuration for the task queue. */
export interface TaskQueueConfig {
  /** Maximum concurrent tasks. Default: 4. */
  maxConcurrency?: number;
  /** Persistence mode. Default: 'memory'. */
  persistence?: 'memory' | 'file';
  /** Interval in milliseconds between automatic checkpoints. */
  checkpointInterval?: number;
}

/** Options for enqueuing a task. */
export interface TaskOptions {
  /** Priority (higher = more important). Default: 0. */
  priority?: number;
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Parent session for hierarchical tasks. */
  parentSessionId?: string;
  /** Enable automatic checkpointing. Default: true. */
  autoCheckpoint?: boolean;
}

/** Handle to a task in the queue. */
export interface TaskQueueHandle {
  /** Unique task identifier. */
  taskId: string;
  /** Current status. */
  status: TaskStatus;
  /** Progress percentage (0-1). */
  progress?: number;
  /** Task result (when completed). */
  result?: unknown;
  /** Error (when failed). */
  error?: Error;
  /** Subscribe to task events. */
  on(event: TaskEvent, handler: (data: unknown) => void): void;
  /** Cancel the task. */
  cancel(): void;
}

/** Task queue for managing long-running agent tasks. */
export interface TaskQueue {
  /** Enqueue a task for execution. */
  enqueue(agentId: string, input: unknown, options?: TaskOptions): Promise<TaskQueueHandle>;
  /** Get task status. */
  getStatus(taskId: string): Promise<TaskStatus>;
  /** Get task result (throws if not completed). */
  getResult(taskId: string): Promise<unknown>;
  /** Cancel a running task. */
  cancel(taskId: string): Promise<void>;
  /** Resume a suspended task. */
  resume(taskId: string): Promise<TaskQueueHandle>;
  /** List tasks matching filter. */
  list(filter?: { status?: TaskStatus; agentId?: string }): Promise<TaskQueueHandle[]>;
}

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

export interface EvictionStorage {
  store(sessionId: string, key: string, content: unknown): Promise<string>;
  retrieve(sessionId: string, reference: string): Promise<unknown>;
}

export interface EvictedResult {
  preview: string;
  reference: string;
  evicted: true;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export interface AuthResult {
  authenticated: boolean;
  error?: string;
}

export interface AuthAdapter {
  authenticate(request: { header(name: string): string | undefined }): Promise<AuthResult>;
}

// ---------------------------------------------------------------------------
// Client SDK
// ---------------------------------------------------------------------------

export { AgentForgeClient } from './client.js';
export type { ClientOptions, AgentRunResult, SSEMessage } from './client.js';
export { parseSSE } from './client.js';

// ---------------------------------------------------------------------------
// Agent Profiles
// ---------------------------------------------------------------------------

export interface AgentProfile {
  name: string;
  description?: string;
  extends?: string;
  plugins?: Array<(api: HarnessAPI) => PluginRegistration>;
  tools?: Tool[];
  config?: Partial<HarnessConfig>;
  systemPrompt?: string;
  model?: string;
  maxIterations?: number;
}

// ---------------------------------------------------------------------------
// Orchestration — Multi-Agent Coordination
// ---------------------------------------------------------------------------

/** Minimal interface for an agent instance (duck-typed for orchestration). */
export interface AgentInstance {
  run(input: string, options?: unknown): Promise<{
    response: string;
    tokenUsage: TokenUsage;
    sessionId: string;
  }>;
}

/** Either an agent configuration or an agent instance. */
export type AgentLike = AgentConfig | AgentInstance;

/** Result of a single orchestration step. */
export interface OrchestrationStepResult {
  stepName: string;
  response: string;
  tokenUsage: TokenUsage;
  sessionId: string;
  error?: Error;
}

/** Function that aggregates results from parallel execution. */
export type AggregatorFunction = (results: OrchestrationStepResult[]) => string | Promise<string>;

/** Function that classifies input and returns a route key. */
export type RouterClassifier = (input: string, context: PipelineContext) => string | Promise<string>;

/** Options for an orchestration step. */
export interface OrchestrationStepOptions {
  /** Parallel mode: function to aggregate results */
  aggregator?: AggregatorFunction;
  /** Failure strategy: 'fail-fast' stops on first error, 'continue' collects all results */
  failureStrategy?: 'fail-fast' | 'continue';
  /** Timeout in milliseconds */
  timeout?: number;
  /** Maximum parallel executions (parallel mode only) */
  maxConcurrency?: number;
}

/** Configuration for a router step. */
export interface RouterConfig {
  routes: Record<string, AgentLike>;
  default?: AgentLike;
  classifier: RouterClassifier;
}

/** Configuration for a single orchestration step. */
export interface OrchestrationStepConfig {
  name: string;
  /** Sequential mode: single agent (config or instance) */
  agent?: AgentLike;
  /** Parallel mode: multiple agents (configs or instances) */
  agents?: AgentLike[];
  /** Conditional mode: router configuration */
  router?: RouterConfig;
  /** Step options */
  options?: OrchestrationStepOptions;
}

/** Result of running an orchestration pipeline. */
export interface OrchestrationResult {
  response: string;
  steps: OrchestrationStepResult[];
  totalTokenUsage: TokenUsage;
  sessionId: string;
}

/** Options for running an orchestration pipeline. */
export interface OrchestrationOptions {
  /** Abort signal for cancellation (global AbortSignal) */
  signal?: globalThis.AbortSignal;
  /** Session ID for persistence */
  sessionId?: string;
  /** Maximum total iterations across all agents */
  maxTotalIterations?: number;
}

// ---------------------------------------------------------------------------
// SimpleProcessorContext -- flat PipelineContext convenience wrapper
// ---------------------------------------------------------------------------

export { SimpleProcessorContext } from './simple-context.js';

// ---------------------------------------------------------------------------
// Runner — Structured Concurrency for Agent Tasks
// ---------------------------------------------------------------------------

/** State of the Runner controlling task execution. */
export type RunnerStateTag = 'Idle' | 'Running' | 'Shell' | 'ShellThenRun';

/** Handle to a queued task in the Runner. */
export interface RunnerTaskHandle {
  id: string;
}

/** Options for Runner operations. */
export interface RunnerOptions {
  onInterrupt?: () => unknown;
}

/** Status of a task in the persistent queue. */
export type PersistentTaskStatus = 'pending' | 'in_flight' | 'completed';

/** A task in the persistent queue. */
export interface PersistentQueuedTask<T = unknown> {
  id: string;
  payload: T;
  metadata?: Record<string, unknown>;
  status: PersistentTaskStatus;
  createdAt: string;
  updatedAt: string;
}

/** Options for enqueuing a task. */
export interface PersistentEnqueueOptions<T = unknown> {
  payload: T;
  metadata?: Record<string, unknown>;
}
