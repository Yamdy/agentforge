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

export interface Message {
  role: string;
  content: string;
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
}

export interface IterationRegion {
  step: number;
  /** undefined defaults to 'continue'. Default evaluateIteration sets 'stop'. */
  loopDirective?: LoopDirective;
  textStream?: AsyncIterable<string>;
  usagePromise?: Promise<TokenUsage>;
  response?: string;
  tokenUsage?: TokenUsage;
  /** Per-stage observability span. Created by PipelineRunner.executeStage(),
   *  lives for one stage invocation (not one full iteration). */
  span?: Span;
  currentToolCall?: { name: string; args: Record<string, unknown> };
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
  renderCall?: (input: any) => string;
  renderResult?: (output: any) => string;
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
// Agent Config (skeleton)
// ---------------------------------------------------------------------------

export interface AgentConfig {
  model: string;
  systemPrompt?: string;
  maxIterations?: number;
  tools?: Tool<any, any>[];
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
