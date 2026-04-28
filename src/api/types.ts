/**
 * AgentForge L2 API Type Definitions
 *
 * Configuration-driven API types for creating agents.
 * This module provides the public-facing types for the L2 API.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/12-API-DESIGN.md
 */

import type { Observable } from 'rxjs';
import type { MonoTypeOperatorFunction } from 'rxjs';
import type {
  AgentEvent,
  AgentEventType,
  Checkpoint,
  Message,
  ModelConfig,
  ModelSpec,
  ToolDefinition,
  LLMAdapter,
  Tracer,
  Metrics,
  CheckpointStorage,
} from '../core/index.js';
import type { Plugin } from '../plugins/index.js';

// ============================================================
// Model Configuration
// ============================================================

/**
 * Model configuration for L2 API
 */
export interface AgentModelConfig extends ModelConfig {
  /** API key (optional, may use environment variable) */
  apiKey?: string;
  /** Base URL for API (optional) */
  baseUrl?: string;
  /** Temperature for sampling */
  temperature?: number;
  /** Maximum tokens in response */
  maxTokens?: number;
}

// ============================================================
// Checkpoint Configuration
// ============================================================

/**
 * Checkpoint configuration options
 */
export interface CheckpointConfig {
  /** Storage type */
  storage: 'memory' | 'sqlite' | 'custom';
  /** Path for file-based storage (sqlite) */
  path?: string;
  /** When to save checkpoints */
  interval?: 'step' | 'tool_result' | 'llm_response';
  /** Custom storage implementation */
  customStorage?: CheckpointStorage;
}

// ============================================================
// HITL Configuration
// ============================================================

/**
 * HITL (Human-in-the-Loop) configuration
 */
export interface HITLConfig {
  /** Callback for permission requests */
  onPermissionAsk?: (ask: {
    permission: string;
    context?: Record<string, unknown>;
  }) => Promise<string>;
  /** Tools that are automatically allowed */
  autoAllow?: string[];
}

// ============================================================
// Tracing Configuration
// ============================================================

/**
 * Tracing configuration options
 */
export interface TracingConfig {
  /** Exporter type */
  exporter: 'console' | 'otel' | 'custom';
  /** Endpoint for OTLP exporter */
  endpoint?: string;
  /** Custom tracer implementation */
  customTracer?: Tracer;
}

// ============================================================
// Metrics Configuration
// ============================================================

/**
 * Metrics configuration options
 */
export interface MetricsConfig {
  /** Prefix for metric names */
  prefix?: string;
  /** Custom metrics implementation */
  customMetrics?: Metrics;
}

// ============================================================
// Subagent Configuration
// ============================================================

/**
 * Subagent configuration for nested agents
 */
export interface SubagentConfig {
  /** Subagent name */
  name: string;
  /** Agent mode */
  mode?: 'primary' | 'subagent' | 'all';
  /** Model configuration (inherits from parent if not specified) */
  model?: AgentModelConfig;
  /** Tools available to this subagent */
  tools?: string[];
  /** System prompt */
  systemPrompt?: string;
}

// ============================================================
// MCP Configuration
// ============================================================

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  /** Server name */
  name: string;
  /** Transport type */
  type: 'stdio' | 'http' | 'sse';
  /** Command for stdio transport */
  command?: string;
  /** Arguments for stdio transport */
  args?: string[];
  /** URL for http/sse transport */
  url?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

// ============================================================
// Agent Configuration (Main Entry Point)
// ============================================================

/**
 * Agent configuration.
 *
 * This is the main configuration object passed to createAgent().
 * All fields have sensible defaults except `model`.
 */
export interface AgentConfig {
  // ----- Required -----
  /** Agent name (default: 'agent') */
  name?: string;

  /**
   * Model configuration - REQUIRED
   *
   * Supports three formats:
   * 1. String format: "provider/model" (e.g., "openai/gpt-4o")
   * 2. Auto-detect: "model-name" (e.g., "gpt-4o" → auto-detected as openai)
   * 3. Object format: { provider: "openai", model: "gpt-4o" } (backward compatible)
   */
  model: AgentModelConfig | ModelSpec;

  /**
   * LLM adapter options (optional)
   * Passed to adapter factory when using string model format
   */
  llmOptions?: Record<string, unknown>;

  // ----- Agent Behavior -----
  /** Maximum steps before termination (default: 10) */
  maxSteps?: number;

  /** System prompt template */
  systemPrompt?: string;

  /**
   * Conversation history for multi-turn context
   *
   * Pass previous messages to maintain conversation context.
   * Messages should be in chronological order.
   *
   * @example
   * ```typescript
   * const agent = createAgent({
   *   model: 'openai/gpt-4o',
   *   history: [
   *     { role: 'user', content: 'Hello' },
   *     { role: 'assistant', content: 'Hi there!' },
   *   ],
   * });
   * ```
   */
  history?: Message[];

  /** Tool names or definitions */
  tools?: (string | ToolDefinition)[];

  /** Enable parallel tool calls (default: true) */
  parallelToolCalls?: boolean;

  /** Enable streaming LLM responses (default: false) */
  streaming?: boolean;

  // ----- Control Flow -----
  /** Total timeout in milliseconds (default: no timeout) */
  timeout?: number;

  /** Retry count for recoverable errors (default: 0) */
  retry?: number;

  /** Retry delay in milliseconds (default: 1000) */
  retryDelay?: number;

  /** Maximum LLM repair attempts (default: 3) */
  maxLLMRepairAttempts?: number;

  // ----- Observability -----
  /** Enable tracing */
  tracing?: boolean | TracingConfig;

  /** Enable metrics */
  metrics?: boolean | MetricsConfig;

  // ----- Persistence -----
  /** Enable checkpointing */
  checkpoint?: boolean | CheckpointConfig;

  // ----- HITL -----
  /** Human-in-the-loop configuration */
  hitl?: HITLConfig;

  // ----- Subsystems -----
  /** Subagent configurations */
  subagents?: SubagentConfig[];

  /** MCP server configurations */
  mcp?: MCPServerConfig[];

  // ----- Memory & Skills -----
  /** Persistent memory configuration (AGENTS.md files) */
  memory?: {
    /** Whether memory is enabled */
    enabled: boolean;
    /** AGENTS.md file paths */
    sources: string[];
  };

  /** Skills configuration (SKILL.md directories) */
  skills?: {
    /** Skill directory paths */
    sources: string[];
  };

  // ----- Advanced -----
  /** LLM adapter instance (overrides model config) */
  llmAdapter?: LLMAdapter;

  /** Custom operators to apply */
  operators?: MonoTypeOperatorFunction<AgentEvent>[];

  /** Plugin configurations for event interception and observation */
  plugins?: Plugin[];

  /** Preset configuration ('production' | 'debug' | 'test') */
  preset?: 'production' | 'debug' | 'test';
}

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default agent configuration values
 */
export const DEFAULT_AGENT_CONFIG: Required<
  Pick<
    AgentConfig,
    | 'name'
    | 'maxSteps'
    | 'parallelToolCalls'
    | 'streaming'
    | 'retry'
    | 'retryDelay'
    | 'maxLLMRepairAttempts'
  >
> = {
  name: 'agent',
  maxSteps: 10,
  parallelToolCalls: true,
  streaming: false,
  retry: 0,
  retryDelay: 1000,
  maxLLMRepairAttempts: 3,
};

// ============================================================
// Stream Handlers
// ============================================================

/**
 * Stream handlers for the stream() method
 */
export interface StreamHandlers {
  /** Called when text delta is received (streaming only) */
  onText?: (delta: string) => void;

  /** Called when a tool is invoked */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;

  /** Called when a tool completes */
  onToolResult?: (name: string, result: string, isError?: boolean) => void;

  /** Called on each step */
  onStep?: (step: number, maxSteps: number) => void;

  /** Called when agent completes successfully */
  onComplete?: (result: string) => void;

  /** Called when an error occurs */
  onError?: (error: Error) => void;

  /** Called for every event (advanced users) */
  onEvent?: (event: AgentEvent) => void;
}

// ============================================================
// Agent Subscription
// ============================================================

/**
 * Subscription returned by stream() method
 */
export interface AgentSubscription {
  /** Cancel the execution */
  unsubscribe(): void;

  /** Promise that resolves with final result */
  result: Promise<string>;
}

// ============================================================
// Agent Interface
// ============================================================

/**
 * Agent interface returned by createAgent()
 *
 * Provides multiple ways to execute the agent:
 * - run(): Promise-based, returns final result
 * - stream(): Callback-based, provides real-time updates
 * - run$(): RxJS Observable, full control (L3 access)
 */
export interface Agent {
  // ----- Execution -----

  /** Run the agent and return the final result */
  run(input: string): Promise<string>;

  /** Run the agent with streaming callbacks */
  stream(input: string, handlers: StreamHandlers): AgentSubscription;

  /** Run the agent and return an Observable of events (L3 access) */
  run$(input: string): Observable<AgentEvent>;

  // ----- Control -----

  /** Cancel current execution */
  cancel(reason?: string): void;

  /** Pause current execution and return checkpoint */
  pause(): Promise<Checkpoint>;

  /** Resume from checkpoint */
  resume(checkpoint: Checkpoint): Promise<string>;

  // ----- Event Listening -----

  /** Listen for specific event types */
  on(eventType: AgentEventType, handler: (event: AgentEvent) => void): () => void;

  // ----- Dynamic Configuration -----

  /** Add a custom operator to the pipeline */
  use(operator: MonoTypeOperatorFunction<AgentEvent>): this;

  /** Clear all additional operators */
  clearOperators(): this;

  /** Register tools dynamically */
  registerTool(tool: ToolDefinition | ToolDefinition[]): this;

  // ----- Lifecycle -----

  /** Destroy the agent and clean up resources */
  destroy(): void;
}

// ============================================================
// Create Agent Result
// ============================================================

/**
 * Result from createAgent function
 *
 * Can be used as either:
 * - Agent instance: const agent = createAgent(config); agent.run('hello')
 * - Direct Observable: createAgent(config)('hello').subscribe(...)
 */
export interface CreateAgentResult extends Agent {
  /** The underlying agent context */
  readonly context: {
    readonly sessionId: string;
    readonly agentName: string;
  };
}
