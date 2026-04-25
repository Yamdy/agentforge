/**
 * AgentForge Dependency Injection Interfaces
 *
 * Core interfaces for the lightweight DI system.
 * All external capabilities are injected through these interfaces.
 *
 * Design principles:
 * - Dependency Inversion: Core loop depends on interfaces, not implementations
 * - Constructor Injection: All external capabilities injected via constructor
 * - No IoC Container: No decorators, no reflection, no container classes
 * - Context Closure: Dependencies passed through closure, not event payloads
 *
 * @see docs/RXJS-EVENT-STREAM-DESIGN.md - 轻量依赖注入 section
 */

import { Observable } from 'rxjs';
import type { Message, ToolCall, AgentEvent } from './events.js';
import type { Checkpoint } from './checkpoint.js';

// Re-export types used in interfaces
export type { Message } from './events.js';

// ============================================================
// LLM Adapter
// ============================================================

/**
 * LLM chunk for streaming responses
 */
export interface LLMChunk {
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsDelta?: string;
}

/**
 * LLM usage statistics
 */
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * LLM response (non-streaming)
 */
export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
  usage?: LLMUsage;
}

/**
 * LLM request options
 */
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  [key: string]: unknown;
}

/**
 * LLM Adapter Interface
 *
 * Abstracts LLM provider communication.
 * Implementations: OpenAIAdapter, AnthropicAdapter, OllamaAdapter, etc.
 *
 * Design patterns from multi-provider research:
 * - AgentScope: Vendor-specific formatToolsJsonSchemas() + formatToolChoice()
 * - OpenCode: Pre-registered factory functions + string model spec
 * - Mastra: Gateway abstraction + schema compat layer
 */
export interface LLMAdapter {
  /** Adapter name for debugging/logging */
  readonly name: string;

  /** Provider identifier (e.g., 'openai', 'anthropic', 'ollama') */
  readonly provider: string;

  /** Non-streaming chat completion */
  chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;

  /** Streaming chat completion */
  stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk>;

  // ===== Provider-specific normalization methods =====

  /**
   * Format tool definitions to provider-compatible schema.
   *
   * Different providers have different tool schema formats:
   * - OpenAI: { type: "function", function: { name, description, parameters } }
   * - Anthropic: { name, description, input_schema }
   * - AI SDK: { toolName: { description, parameters, execute } }
   * - Gemini: { function_declarations: [...] }
   *
   * @param tools - AgentForge FunctionDefinition[]
   * @returns Provider-specific tool schema format
   */
  formatTools?(tools: FunctionDefinition[]): unknown;

  /**
   * Normalize messages to provider-compatible format.
   *
   * Handles multi-turn tool calling message sequence:
   * - OpenAI: user → assistant(tool_calls) → tool(content)
   * - AI SDK v6: user → assistant(content: [{ type: "tool-call" }]) → tool(content: [{ type: "tool-result", output }])
   * - Anthropic: user → assistant(content: [..., tool_use]) → user(content: [..., tool_result])
   *
   * @param messages - AgentForge Message[]
   * @returns Provider-specific message format
   */
  normalizeMessages?(messages: Message[]): unknown[];

  /**
   * Format tool choice to provider-compatible format.
   *
   * @param choice - "auto" | "none" | "required" | { name: string }
   * @returns Provider-specific tool choice format
   */
  formatToolChoice?(choice: ToolChoice): unknown;
}

/**
 * Tool choice options
 */
export type ToolChoice = 'auto' | 'none' | 'required' | { name: string };

/**
 * Model specification string format
 *
 * Supported formats:
 * - "provider/model": "openai/gpt-4o", "anthropic/claude-sonnet-4-5"
 * - "model" (auto-detect): "gpt-4o" → openai, "claude-3-5-sonnet" → anthropic
 */
export type ModelSpec = string;

/**
 * LLM Adapter Factory Interface
 *
 * Creates LLM adapter instances based on model specification.
 *
 * Usage:
 * ```typescript
 * const factory = new LLMAdapterFactory();
 * const adapter = factory.create("openai/gpt-4o", { apiKey: "..." });
 * ```
 */
export interface LLMAdapterFactory {
  /**
   * Create an LLM adapter from model specification.
   *
   * @param spec - Model specification string (e.g., "openai/gpt-4o")
   * @param options - Provider-specific options (apiKey, baseURL, etc.)
   * @returns LLMAdapter instance
   */
  create(spec: ModelSpec, options?: ProviderOptions): LLMAdapter;

  /**
   * List available providers.
   */
  listProviders(): string[];

  /**
   * Check if a provider is supported.
   */
  hasProvider(provider: string): boolean;
}

/**
 * Provider-specific options
 */
export interface ProviderOptions {
  /** API key (or read from env: PROVIDER_API_KEY) */
  apiKey?: string;

  /** Custom base URL for OpenAI-compatible providers */
  baseURL?: string;

  /** Request timeout in milliseconds */
  timeout?: number;

  /** Additional headers */
  headers?: Record<string, string>;

  /** Provider allows additional options */
  [key: string]: unknown;
}

// ============================================================
// Tool Registry
// ============================================================

/**
 * Tool definition with Zod schema for parameters
 */
export interface ToolDefinition<TSchema = unknown> {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (args: unknown, ctx?: ToolContext) => Promise<string>;
}

/**
 * Function definition for LLM (JSON Schema format)
 */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool Registry Interface
 *
 * Manages tool registration and execution.
 */
export interface ToolRegistry {
  /** List all registered tool names */
  list(): string[];

  /** Check if a tool is registered */
  has(name: string): boolean;

  /** Get tool definition */
  get(name: string): ToolDefinition | undefined;

  /** Get function definition for LLM */
  getFunctionDef(name: string): FunctionDefinition | undefined;

  /** Get all function definitions for LLM */
  getFunctionDefs(): FunctionDefinition[];

  /** Execute a tool */
  execute(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<string>;

  /** Register a tool */
  register(tool: ToolDefinition): void;

  /** Register multiple tools */
  registerAll(tools: ToolDefinition[]): void;
}

// ============================================================
// Memory Store
// ============================================================

/**
 * Memory Store Interface
 *
 * Manages conversation history for a single session.
 */
export interface MemoryStore {
  /** Add a message to history */
  add(message: Message): void;

  /** Get all messages */
  getAll(): Message[];

  /** Get recent N messages */
  getRecent(count: number): Message[];

  /** Clear all messages */
  clear(): void;

  /** Get message count */
  count(): number;
}

// ============================================================
// Checkpoint Storage
// ============================================================

/**
 * Checkpoint Storage Interface
 *
 * Manages checkpoint persistence.
 */
export interface CheckpointStorage {
  /** Save a checkpoint */
  save(checkpoint: Checkpoint): Promise<void>;

  /** Load latest checkpoint for a session */
  load(sessionId: string): Promise<Checkpoint | null>;

  /** List all checkpoints (optionally filtered by session) */
  list(sessionId?: string): Promise<Checkpoint[]>;

  /** Delete a checkpoint */
  delete(id: string): Promise<void>;

  /** Delete all checkpoints for a session */
  deleteAll(sessionId: string): Promise<void>;
}

// ============================================================
// Observability
// ============================================================

/**
 * Span options for tracing
 */
export interface SpanOptions {
  attributes?: Record<string, unknown>;
  parent?: string;
}

/**
 * Tracer Interface
 *
 * Distributed tracing for observability.
 */
export interface Tracer {
  /** Start a new span */
  startSpan(name: string, options?: SpanOptions): string;

  /** End a span */
  endSpan(spanId: string, options?: { code?: string }): void;

  /** Add event to span */
  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void;

  /** Record exception in span */
  recordException(spanId: string, error: Error): void;
}

/**
 * Metrics Interface
 *
 * Metrics collection for observability.
 */
export interface Metrics {
  /** Increment a counter */
  increment(name: string, value?: number, tags?: Record<string, string>): void;

  /** Record a histogram value */
  histogram(name: string, value: number, tags?: Record<string, string>): void;

  /** Record a gauge value */
  gauge(name: string, value: number, tags?: Record<string, string>): void;
}

// ============================================================
// HITL (Human-in-the-Loop)
// ============================================================

/**
 * HITL Ask options
 */
export interface HITLAskOptions {
  question: string;
  askId: string;
  toolCallId: string;
  toolName: string;
  options?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * HITL Controller Interface
 *
 * Manages human-in-the-loop interactions using Observable-based async pattern.
 * This enables the NEVER-blocking pattern where the stream pauses for external input.
 *
 * Design: ask() returns Observable<string> that emits when the human answers.
 * The Observable represents a "pause until answered" semantic - the expand recursion
 * subscribes and waits for the answer before continuing.
 */
export interface HITLController {
  /** Ask a question - returns Observable that emits the answer when human responds */
  ask(options: HITLAskOptions): Observable<string>;

  /** Observable of asks (for UI to subscribe) */
  onAsk(): Observable<{
    askId: string;
    question: string;
    options?: string[];
    metadata?: Record<string, unknown>;
  }>;

  /** Provide an answer (for UI to call) */
  answer(askId: string, answer: string): void;
}

// ============================================================
// Pause Controller
// ============================================================

/**
 * Pause Controller Interface
 *
 * Manages pause/resume for agent execution.
 *
 * Important: Pause blocks next step, doesn't cache events.
 * Use NEVER to block, not bufferToggle (avoids memory leak).
 */
export interface PauseController {
  /** Pause execution */
  pause(): void;

  /** Resume execution */
  resume(): void;

  /** Check if paused */
  isPaused(): boolean;

  /** Observable that emits when resumed */
  onResume(): Observable<void>;
}

// ============================================================
// MCP (Model Context Protocol)
// ============================================================

/**
 * MCP connection status type
 */
export type MCPStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP Client Interface
 *
 * Manages connection to MCP server and tool invocation.
 */
export interface MCPClient {
  /** Connect to MCP server */
  connect(): Promise<void>;

  /** Disconnect from MCP server */
  disconnect(): Promise<void>;

  /** List available tools */
  tools(): Promise<MCPTool[]>;

  /** Call a tool */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;

  /** Get connection status */
  status(): MCPStatus;

  /** Observable of status changes */
  onStatusChange(): Observable<MCPStatus>;
}

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

// ============================================================
// Subagent
// ============================================================

/**
 * Subagent mode
 */
export type AgentMode = 'primary' | 'subagent' | 'all';

/**
 * Subagent info
 */
export interface SubagentInfo {
  name: string;
  mode: AgentMode;
  description?: string;
}

/**
 * Subagent Registry Interface
 *
 * Manages subagent invocation.
 */
export interface SubagentRegistry {
  /** Check if subagent exists */
  has(name: string): boolean;

  /** Run a subagent */
  run(
    name: string,
    input: string,
    options?: { sessionMessages?: Message[] }
  ): Observable<AgentEvent>;

  /** List all subagents */
  list(): SubagentInfo[];

  /** Get subagent info */
  get(name: string): SubagentInfo | undefined;
}

// ============================================================
// Tool Context (Transient)
// ============================================================

/**
 * Tool Context (Transient Scope)
 *
 * Created for each tool execution, discarded after completion.
 * Used to pass execution-specific context to tool implementations.
 */
export interface ToolContext {
  /** Unique ID for this tool call */
  toolCallId: string;

  /** Parent session ID */
  parentSessionId: string;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================
// Error Handling
// ============================================================

/**
 * Error severity
 */
export type ErrorSeverity = 'recoverable' | 'fatal';

/**
 * Error category for classification
 */
export type ErrorCategory =
  | 'llm_timeout'
  | 'llm_rate_limit'
  | 'llm_server_error'
  | 'llm_invalid_response'
  | 'tool_execution'
  | 'tool_validation'
  | 'tool_not_found'
  | 'schema_violation'
  | 'context_corrupted'
  | 'permission_denied'
  | 'checkpoint_failed'
  | 'unknown';

/**
 * Classified error
 */
export interface ClassifiedError {
  severity: ErrorSeverity;
  category: ErrorCategory;
  originalError: Error;
  recoverable: boolean;
}

/**
 * Error handler callback
 */
export type ErrorHandler = (error: Error, event: AgentEvent, category: ErrorCategory) => void;

// ============================================================
// Prompt Builder
// ============================================================

/**
 * Options for building a prompt
 */
export interface PromptBuildOptions {
  /** Custom system prompt template (uses {{var}} interpolation) */
  systemTemplate?: string;

  /** Variables for template rendering */
  templateVars?: Record<string, unknown>;

  /** Additional instructions to append to system prompt */
  extraInstructions?: string[];

  /** Optional token budget limit for prompt construction */
  tokenBudget?: number;
}

/**
 * Built prompt result
 */
export interface BuiltPrompt {
  /** Built message array for LLM */
  messages: Message[];

  /** Converted tool definitions for LLM */
  tools: FunctionDefinition[];

  /** Estimated token count */
  tokenEstimate: number;
}

/**
 * Prompt Builder Interface
 *
 * Constructs the full prompt payload for LLM invocation,
 * including system message, tool instructions, and tool definitions.
 */
export interface PromptBuilder {
  /**
   * Build a complete prompt for LLM invocation.
   *
   * @param history - Prior conversation messages
   * @param input - Current user input
   * @param tools - Available tool definitions (with Zod schemas)
   * @param options - Optional build configuration
   * @returns Built prompt with messages, tools, and token estimate
   */
  build(
    history: Message[],
    input: string,
    tools: ToolDefinition[],
    options?: PromptBuildOptions
  ): BuiltPrompt;
}

// ============================================================
// Schema Registry
// ============================================================

/**
 * Schema Registry Interface
 *
 * Manages Zod schema registration for events and data contracts.
 */
export interface SchemaRegistry {
  /** Register a schema */
  register(name: string, schema: unknown): void;

  /** Get a schema by name */
  get(name: string): unknown;

  /** Check if schema exists */
  has(name: string): boolean;

  /** Validate data against schema */
  validate(name: string, data: unknown): boolean;
}
