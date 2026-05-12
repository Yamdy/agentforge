// @agentforge/sdk — public type definitions

// ---------------------------------------------------------------------------
// Pipeline Stage
// ---------------------------------------------------------------------------

/** The 8 agent lifecycle stages + tool sub-pipeline stages. */
export type PipelineStage =
  | 'processInput'
  | 'buildContext'
  | 'prepareStep'
  | 'invokeLLM'
  | 'processStepOutput'
  | 'executeTools'
  | 'evaluateIteration'
  | 'processOutput'
  | 'beforeTool'
  | 'execute'
  | 'afterTool';

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
}

/** Structured conversation message supporting tool-call round-trips. */
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; reasoningContent?: string }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string; result?: unknown; error?: string };

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

export type ProcessorResult = PipelineContext | AbortSignal;

export interface Processor {
  stage: PipelineStage;
  execute(context: PipelineContext): Promise<ProcessorResult>;
}

// ---------------------------------------------------------------------------
// Tool System
// ---------------------------------------------------------------------------

export interface WrapHookInvoker {
  invokeWrapHook(point: HookPoint, data: unknown): Promise<unknown>;
}

export interface ToolExecutionContext {
  harness?: unknown;
  span?: unknown;
  sessionId?: string;
  pluginManager?: WrapHookInvoker;
}

export interface ToolHookContext {
  toolName: string;
  args: unknown;
  result?: unknown;
  error?: Error;
}

export interface ToolWrapContext {
  toolName: string;
  args: unknown;
  result: unknown;
  sessionId: string;
}

export type ToolHook = (context: ToolHookContext) => void | Promise<void>;

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  requireApproval?: boolean;
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
  | { type: 'abort'; reason: string; retryFrom?: PipelineStage };

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
  | 'llm.wrap'
  | 'tool.before'
  | 'tool.after'
  | 'tool.wrap'
  | 'iteration.end'
  | 'error';

export interface Hook {
  point: HookPoint;
  handler: (context: unknown) => unknown | Promise<unknown>;
  priority?: number;
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
}

export interface PluginRegistration {
  processors?: Processor[];
  tools?: ToolDefinition[];
  commands?: Record<string, (args: string) => Promise<void>>;
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
// Suspend / Resume
// ---------------------------------------------------------------------------

export interface SuspendResult {
  type: 'suspended';
  resumeToken: string;
  reason: string;
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
