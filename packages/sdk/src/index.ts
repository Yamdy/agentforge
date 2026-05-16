// @agentforge/sdk — public type definitions

// ---------------------------------------------------------------------------
// Pipeline Stage
// ---------------------------------------------------------------------------

/** The agent lifecycle stages + gate stages + tool sub-pipeline stages. */
export type PipelineStage =
  | 'processInput'
  | 'buildContext'
  | 'prepareStep'
  | 'gateLLM'
  | 'invokeLLM'
  | 'processStepOutput'
  | 'gateTool'
  | 'executeTools'
  | 'evaluateIteration'
  | 'processOutput'
  | 'beforeTool'
  | 'execute'
  | 'afterTool';

/** Configurable pipeline stage sequence. Overrides default stage order when provided. */
export interface PipelineStageConfig {
  preLoop?: PipelineStage[];
  loop?: PipelineStage[];
  postLoop?: PipelineStage[];
}

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
}

/** Structured conversation message supporting tool-call round-trips. */
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; reasoningContent?: string }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string; result?: unknown; error?: string; mutated?: boolean; truncated?: boolean; validationError?: string };

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
  | { action: 'retry'; retryFrom: PipelineStage };

// ---------------------------------------------------------------------------
// Pipeline Context — Four Regions (ADR-0007)
// ---------------------------------------------------------------------------

export interface RequestRegion {
  input: string;
  sessionId: string;
}

export interface AgentRegion {
  config: AgentConfig;
  systemPrompt?: string;
  toolDeclarations: Array<{ name: string; description: string }>;
  /** Append-only. Always spread existing: `[...ctx.agent.promptFragments, newFragment]` */
  promptFragments: string[];
  /** Per-provider options passed through to streamText(). Keyed by provider name. */
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface IterationRegion {
  step: number;
  /** undefined defaults to 'continue'. Default evaluateIteration sets 'stop'. */
  loopDirective?: LoopDirective;
  /** AI SDK fullStream yielding text-delta, tool-call, finish-step, error events. */
  fullStream?: AsyncIterable<unknown>;
  usagePromise?: Promise<TokenUsage>;
  /** Promise resolving to reasoning text from the model (e.g. DeepSeek reasoning_content). */
  reasoningPromise?: Promise<string | undefined>;
  response?: string;
  tokenUsage?: TokenUsage;
  /** Tool calls extracted from the LLM response by PipelineRunner stream consumption. */
  pendingToolCalls?: ToolCall[];
  /** Reasoning content from thinking-mode models (e.g. DeepSeek). Must be passed back on subsequent turns. */
  reasoningContent?: string;
  /** Results from executing pending tool calls (set by executeTools processor). */
  toolResults?: ToolResult[];
  /** Per-stage observability span. Created by PipelineRunner.executeStage(),
   *  lives for one stage invocation (not one full iteration). */
  span?: Span;
}

export interface SessionRegion {
  messageHistory?: Message[];
  totalTokenUsage?: TokenUsage;
  /** Plugin extension point. Namespaced by plugin ID. */
  custom: Record<string, unknown>;
}

export interface PipelineContext {
  request: RequestRegion;
  agent: AgentRegion;
  iteration: IterationRegion;
  session: SessionRegion;
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
// Processor
// ---------------------------------------------------------------------------

export interface AbortSignal {
  type: 'abort';
  reason: string;
  retryFrom?: PipelineStage;
}

export interface PipelineCheckpoint {
  context: PipelineContext;
  nextStages: PipelineStage[];
  iteration: number;
}

export interface SuspensionSignal {
  type: 'suspend';
  suspensionId: string;
  reason: string;
  checkpoint: PipelineCheckpoint;
  expiresAt?: string;
}

export type ProcessorResult = PipelineContext | AbortSignal | SuspensionSignal;

export interface Processor {
  stage: PipelineStage;
  execute(context: PipelineContext): Promise<ProcessorResult>;
}

// ---------------------------------------------------------------------------
// Tool System
// ---------------------------------------------------------------------------

export interface ToolExecutionContext {
  harness?: unknown;
  span?: unknown;
  sessionId?: string;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  requireApproval?: boolean;
  allowOutputMutation?: boolean;
  renderCall?(input: TInput): string;
  renderResult?(output: TOutput): string;
}

export type ToolDefinition = Tool;

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
  increment(name: string): void;
  gauge(name: string, value: number): void;
  histogram(name: string, value: number): void;
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
  | { type: 'stage_start'; stage: PipelineStage }
  | { type: 'stage_complete'; stage: PipelineStage }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'complete'; context: PipelineContext }
  | { type: 'abort'; reason: string; retryFrom?: PipelineStage }
  | { type: 'suspended'; suspensionId: string; reason: string; checkpoint: PipelineCheckpoint };

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

export interface AgentHookInput {
  sessionId: string;
  request: RequestRegion;
  agentConfig: AgentConfig;
}

export interface StageHookInput {
  stage: PipelineStage;
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
  stage: PipelineStage;
  sessionId: string;
}

export interface ResourceDeclaration {
  id: string;
  type: string;
  config: Record<string, unknown>;
  start: () => Promise<unknown>;
  stop: (instance: unknown) => Promise<void>;
}

export interface HarnessAPI {
  registerProcessor(stage: PipelineStage, processor: Processor): void;
  registerTool(tool: ToolDefinition): void;
  unregisterTool(name: string): boolean;
  registerCommand(name: string, handler: (args: string) => Promise<void>): void;
  registerHook(hook: Hook): void;
  subscribe(eventType: string, handler: (data?: unknown) => void): () => void;
  registerResource(declaration: ResourceDeclaration): void;
  registerProvider(name: string, factory: unknown): void;
  registerCompressionStrategy(strategy: CompressionStrategy): void;
  emit(eventType: string, data?: unknown): void;
}

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
 * Merged from multiple layers (highest priority first):
 *   1. Session-level — runtime parameters passed to agent.run()
 *   2. Project-level — .agentforge/config.jsonc in project root
 *   3. Global-level  — ~/.agentforge/config.jsonc in user home
 *   4. Environment   — AGENTFORGE_CONFIG env var (inline JSON)
 */
export interface HarnessConfig {
  agents?: Record<string, Partial<AgentConfig>>;
  tools?: { enabled?: string[]; disabled?: string[] };
  plugins?: string[];
  session?: { storage?: 'file' | 'memory'; path?: string };
  modelProfiles?: ModelProfile[];
  modelGateways?: GatewayConfig[];
  hooks?: { profile?: HookProfile; disabledHooks?: string[] };
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
}

// ---------------------------------------------------------------------------
// Session Persistence
// ---------------------------------------------------------------------------

export type SessionStatus = 'active' | 'completed' | 'suspended' | 'error';

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
}

export interface SessionStorage {
  append(sessionId: string, event: SessionEvent): Promise<void>;
  read(sessionId: string): AsyncIterable<SessionEvent>;
  list(filter?: { parentSessionId?: string; status?: SessionStatus }): Promise<SessionRecord[]>;
  updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void>;
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
  resume(sessionId: string, input?: string): Promise<string>;
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
