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
// Pipeline Context (skeleton)
// ---------------------------------------------------------------------------

export interface PipelineContext {
  request: { input: string; sessionId: string };
  iteration: { step: number };
  pipeline: Record<string, unknown>;
  session: Record<string, unknown>;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export interface AbortSignal {
  type: 'abort';
  reason: string;
}

export type ProcessorResult = PipelineContext | AbortSignal;

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
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  requireApproval?: boolean;
  renderCall?: (input: TInput) => string;
  renderResult?: (output: TOutput) => string;
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
// Plugin System
// ---------------------------------------------------------------------------

export type EventType = 'agent:start' | 'agent:end' | 'tool:before' | 'tool:after' | string;

export interface HarnessAPI {
  registerProcessor(stage: PipelineStage, processor: Processor): void;
  registerTool(tool: ToolDefinition): void;
  registerCommand(name: string, handler: (args: string) => Promise<void>): void;
  registerProvider(config: unknown): void;
  onEvent(eventType: EventType, handler: (...args: unknown[]) => void): void;
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
// Suspend / Resume
// ---------------------------------------------------------------------------

export interface SuspendResult {
  type: 'suspended';
  resumeToken: string;
  reason: string;
}
