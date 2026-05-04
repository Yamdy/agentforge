/**
 * AgentForge L2 API Type Definitions
 *
 * Configuration-driven API types for creating agents.
 * This module provides the public-facing types for the L2 API.
 *
 */

import type {
  AgentEvent,
  Message,
  ModelConfig,
  AgentState,
  Tracer,
  Metrics,
  ModelSpec,
  ToolDefinition,
  CheckpointStorage,
} from '../core/index.js';
import type { Plugin } from '../plugins/index.js';
import type { PluginSpec } from '../plugins/plugin-loader.js';
import type { VectorStore } from '../memory/vector-store.js';
import type { EmbeddingModel } from '../memory/embedding.js';

export type { PluginSpec };

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
  /** Exporter type. 'none' explicitly disables tracing (equivalent to omitting tracing config) */
  exporter: 'console' | 'otel' | 'custom' | 'none';
  /** Endpoint for OTLP exporter (required when exporter='otel') */
  endpoint?: string;
  /** Service name for OTel resource attribution (default: 'agentforge') */
  serviceName?: string;
  /** Additional HTTP headers for OTLP export */
  headers?: Record<string, string>;
  /** Sampling ratio 0-1 (default: 1.0 = sample all) */
  sampler?: number;
  /** Custom tracer implementation (exporter='custom') */
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
// Grouped Configuration Sub-Interfaces
// ============================================================

/**
 * Execution configuration group.
 * Controls HOW the agent loop runs — its operational mode and output style.
 */
export interface ExecutionConfig {
  /** Enable parallel tool calls (default: true) */
  parallelToolCalls?: boolean;
  /** Enable streaming LLM responses (default: false) */
  streaming?: boolean;
  /**
   * Execution mode for the planner.
   *
   * - 'react': ReAct loop only, planner is never invoked (default)
   * - 'plan-then-execute': Try planner first, fall back to ReAct on failure
   * - 'plan-then-execute-strict': Planner MUST succeed, otherwise error
   */
  executionMode?: 'react' | 'plan-then-execute' | 'plan-then-execute-strict';
}

/**
 * Controls configuration group.
 * Safety and flow control: timeouts, token budgets, retry policy, and HITL.
 */
export interface ControlsConfig {
  /** Total timeout in milliseconds */
  timeout?: number;
  /** Token budget cap for the entire session */
  tokenBudget?: number;
  /** Retry count for recoverable errors (default: 0) */
  retry?: number;
  /** Retry delay in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Maximum LLM repair attempts (default: 3) */
  maxLLMRepairAttempts?: number;
  /** Human-in-the-loop configuration */
  hitl?: HITLConfig;
}

/**
 * Observability configuration group.
 * Tracing, metrics, checkpointing, and preset-based defaults.
 */
export interface ObservabilityConfig {
  /** Enable tracing */
  tracing?: boolean | TracingConfig;
  /** Enable metrics */
  metrics?: boolean | MetricsConfig;
  /** Enable checkpointing */
  checkpoint?: boolean | CheckpointConfig;
  /** Preset that adjusts defaults ('production' | 'debug' | 'development' | 'test') */
  preset?: 'production' | 'debug' | 'development' | 'test';
}

/**
 * Extensions configuration group.
 * Memory, skills, summarization, compaction, subagents, and MCP.
 */
export interface ExtensionsConfig {
  /** Persistent memory configuration (AGENTS.md files) */
  memory?: {
    enabled: boolean;
    sources: string[];
  };
  /** Skills configuration (SKILL.md directories) */
  skills?: {
    sources: string[];
  };
  /** Summarization configuration (auto-compress long conversations) */
  summarization?: {
    tokenThreshold: number;
    preserveRecent: number;
    offloadDir?: string;
  };
  /** Compaction configuration */
  compaction?: {
    strategy?: string;
    vectorStore?: VectorStore;
    embeddingModel?: EmbeddingModel;
  };
  /** Subagent configurations */
  subagents?: SubagentConfig[];
  /** MCP server configurations */
  mcp?: MCPServerConfig[];
}

/**
 * Plugin configuration group.
 */
export interface PluginConfig {
  /** Plugin instances for event interception */
  plugins?: Plugin[];
  /** Dynamic plugin specifiers for runtime loading */
  pluginSpecs?: PluginSpec[];
}

// ============================================================
// Agent Configuration (Main Entry Point)
// ============================================================

/**
 * Agent configuration passed to createAgent().
 *
 * ## Quick start (80% case)
 *
 * ```typescript
 * const agent = createAgent({
 *   model: 'openai/gpt-4o',
 *   tools: ['fs', 'bash'],
 * });
 * ```
 *
 * ## With harness controls
 *
 * ```typescript
 * const agent = createAgent({
 *   model: 'openai/gpt-4o',
 *   tools: ['fs', 'bash'],
 *   controls: { hitl: { autoAllow: ['fs'] } },
 *   observability: { tracing: { exporter: 'console' } },
 * });
 * ```
 *
 * ## Legacy flat format (still supported)
 *
 * ```typescript
 * const agent = createAgent({
 *   model: 'openai/gpt-4o',
 *   maxSteps: 20,
 *   tracing: true,        // @deprecated — use observability.tracing
 *   parallelToolCalls: false, // @deprecated — use execution.parallelToolCalls
 * });
 * ```
 *
 * Grouped sub-objects (`execution`, `controls`, `observability`, `extensions`,
 * `pluginsConfig`) take precedence over their flat equivalents when both are provided.
 */
export interface AgentConfig {
  // ── Core (top-level, 80% use case) ──

  /** Agent name (default: 'agent') */
  name?: string;

  /**
   * Model configuration.
   * String format: "provider/model" (e.g. "openai/gpt-4o").
   * Object format: { provider: "openai", model: "gpt-4o" }.
   */
  model: AgentModelConfig | ModelSpec;

  /** LLM adapter options passed to the adapter factory */
  llmOptions?: Record<string, unknown>;

  /** System prompt template */
  systemPrompt?: string;

  /** Conversation history for multi-turn context */
  history?: Message[];

  /** Maximum steps before termination (default: 10) */
  maxSteps?: number;

  /** Tool names or definitions. Prefer string names resolved from a tool registry. */
  tools?: (string | ToolDefinition)[];

  // ── Grouped sub-objects (recommended for advanced config) ──

  /** Execution settings: parallelToolCalls, streaming, executionMode */
  execution?: ExecutionConfig;

  /** Control flow settings: timeout, tokenBudget, retry, HITL */
  controls?: ControlsConfig;

  /** Observability settings: tracing, metrics, checkpoint, preset */
  observability?: ObservabilityConfig;

  /** Extension settings: memory, skills, summarization, compaction, subagents, MCP */
  extensions?: ExtensionsConfig;

  /** Plugin settings: inline plugins and dynamic plugin specs */
  pluginsConfig?: PluginConfig;

  // ── @deprecated Legacy flat fields (use grouped equivalents above) ──

  /** @deprecated Use `execution.parallelToolCalls` */
  parallelToolCalls?: boolean;

  /** @deprecated Use `execution.streaming` */
  streaming?: boolean;

  /** @deprecated Use `execution.executionMode` */
  executionMode?: 'react' | 'plan-then-execute' | 'plan-then-execute-strict';

  /** @deprecated Use `controls.timeout` */
  timeout?: number;

  /** @deprecated Use `controls.tokenBudget` */
  tokenBudget?: number;

  /** @deprecated Use `controls.retry` */
  retry?: number;

  /** @deprecated Use `controls.retryDelay` */
  retryDelay?: number;

  /** @deprecated Use `controls.maxLLMRepairAttempts` */
  maxLLMRepairAttempts?: number;

  /** @deprecated Use `controls.hitl` */
  hitl?: HITLConfig;

  /** @deprecated Use `observability.tracing` */
  tracing?: boolean | TracingConfig;

  /** @deprecated Use `observability.metrics` */
  metrics?: boolean | MetricsConfig;

  /** @deprecated Use `observability.checkpoint` */
  checkpoint?: boolean | CheckpointConfig;

  /** @deprecated Use `observability.preset` */
  preset?: 'production' | 'debug' | 'development' | 'test';

  /** @deprecated Use `extensions.memory` */
  memory?: {
    enabled: boolean;
    sources: string[];
  };

  /** @deprecated Use `extensions.skills` */
  skills?: {
    sources: string[];
  };

  /** @deprecated Use `extensions.summarization` */
  summarization?: {
    tokenThreshold: number;
    preserveRecent: number;
    offloadDir?: string;
  };

  /** @deprecated Use `extensions.compaction` */
  compaction?: {
    strategy?: string;
    vectorStore?: VectorStore;
    embeddingModel?: EmbeddingModel;
  };

  /** @deprecated Use `extensions.subagents` */
  subagents?: SubagentConfig[];

  /** @deprecated Use `extensions.mcp` */
  mcp?: MCPServerConfig[];

  /** @deprecated Use `pluginsConfig.plugins` */
  plugins?: Plugin[];

  /** @deprecated Use `pluginsConfig.pluginSpecs` */
  pluginSpecs?: PluginSpec[];

  // ── Truly deprecated (no grouped equivalent) ──

  /** @deprecated LLM adapter instance (overrides model config) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llmAdapter?: any;

  /** @deprecated Custom operators to apply */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operators?: any[];
}

// ============================================================
// Errors
// ============================================================

/**
 * Error thrown when agent configuration is invalid.
 */
export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConfigError';
  }
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
    | 'executionMode'
    | 'retry'
    | 'retryDelay'
    | 'maxLLMRepairAttempts'
  >
> = {
  name: 'agent',
  maxSteps: 10,
  parallelToolCalls: true,
  streaming: false,
  executionMode: 'react',
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
// Run Handlers
// ============================================================

/**
 * Callback handlers for agent.run()
 */
export interface RunHandlers {
  /** @deprecated Streaming is not yet implemented; this handler will never fire. Reserved for future use. */
  onToken?: (delta: string) => void;
  onToolCall?: (event: AgentEvent) => void;
  onToolResult?: (event: AgentEvent) => void;
  onComplete?: (output: string) => void;
  onError?: (error: AgentEvent) => void;
  onEvent?: (event: AgentEvent) => void;
}

// ============================================================
// Agent Interface
// ============================================================

/**
 * Agent interface returned by createAgent()
 *
 * Imperative API: run() returns Promise<string>, events via on() callback.
 */
export interface Agent {
  // ----- Execution -----

  /** Run the agent and return the final result */
  run(input: string, handlers?: RunHandlers): Promise<string>;

  /**
   * AsyncGenerator-based iteration. Yields all emitted events as they occur,
   * returns the final output string. Use `for await (const event of iterate(...))`
   * for streaming access to the agent's full event stream.
   */
  iterate(input: string): AsyncGenerator<AgentEvent, string, void>;

  /** @deprecated wrapper for backward compat */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run$?(input: string): any;

  // ----- Control -----

  /** Cancel current execution */
  cancel(): void;

  /** Pause current execution */
  pause(): Promise<void>;

  /** Resume execution */
  resume(): void;

  // ----- Event Listening -----

  /** Listen for specific event types */
  on(eventType: string, handler: (event: AgentEvent) => void): () => void;

  // ----- State -----

  /** Get current agent loop state (null if not started) */
  getState(): AgentState | null;

  /** Get current lifecycle status from state machine */
  getStatus(): string;

  /** Subscribe to lifecycle state changes. Returns unsubscribe function. */
  onStateChange(fn: (from: string, to: string) => void): () => void;

  /** @deprecated Internal context for backward compat */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx?: any;

  /** Destroy the agent and clean up resources */
  destroy(): void;
}

// ============================================================
// Re-exports
// ============================================================

export type { NormalizedAgentConfig } from './config-normalizer.js';
