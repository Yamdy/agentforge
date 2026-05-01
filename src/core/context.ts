/**
 * AgentForge Context System
 *
 * Three-layer context structure:
 * - ApplicationServices: Global singleton, shared across all agents
 * - AgentContext: Session-level instance, unique per agent
 * - ToolContext: Transient, created per tool execution (defined in interfaces.ts)
 *
 * Key design:
 * - Context passed through closure, not event payload
 * - Session-level state is isolated per agent
 * - Global services are shared for efficiency
 *
 * @see docs/RXJS-EVENT-STREAM-DESIGN.md - 轻量依赖注入 section
 */

import type { AgentEvent, Message } from './events.js';
import type { ModelConfig } from './state.js';
import type {
  LLMAdapter,
  LLMAdapterFactory,
  ToolRegistry,
  ToolDefinition,
  FunctionDefinition,
  MemoryStore,
  CheckpointStorage,
  Tracer,
  Metrics,
  HITLController,
  PauseController,
  MCPClient,
  SubagentRegistry,
  SchemaRegistry,
  ErrorHandler,
  PermissionPolicy,
  PermissionController,
  SandboxExecutor,
  AuditLogger,
  RateLimiter,
  InputSanitizer,
} from './interfaces.js';
import type { Logger } from './logger.js';
import { NoopTracer, NoopMetrics } from './defaults.js';
import type { QuotaController } from '../quota/quota-controller.js';
import type { CompactionManager } from '../memory/index.js';
import type { PromptBuilder } from './interfaces.js';
import type { QualityGate } from '../validation/quality-gate.js';
import type {
  HealthChecker,
  MetricsCollector,
  AuditStore,
  CostTracker,
  ResultValidator,
  ErrorClassifier,
  CircuitBreaker,
  AutoRepairer,
} from '../contracts/mpu-interfaces.js';
import type { SecurityGuard } from '../security/guard.js';
import type { Planner } from '../planning/types.js';
import type { HITLAskOptions } from './interfaces.js';
import type { HookRegistry } from './hooks.js';
// ============================================================
// Application Services (Global Singleton)
// ============================================================

/**
 * Application-level Services
 *
 * Created once at application startup, shared across all agents.
 * Contains global resources and factories.
 */
export interface ApplicationServices {
  /** Global tracer for distributed tracing */
  tracer?: Tracer;

  /** Global metrics collector */
  metrics?: Metrics;

  /** Schema registry for Zod schemas */
  schemaRegistry: SchemaRegistry;

  /** LLM adapter factory */
  llmFactory: LLMAdapterFactory;

  /** Global tool registry (shared tools) */
  toolRegistry: ToolRegistry;

  // ----- MPU Global Services (optional — zero overhead if not configured) -----
  /** Health checker for component status monitoring */
  healthChecker?: HealthChecker;

  /** MPU metrics collector for counters, histograms, and gauges */
  metricsCollector?: MetricsCollector;

  /** Audit store for security event recording with hash-chain integrity */
  auditStore?: AuditStore;

  /** Cost tracker for LLM token/cost monitoring and limiting */
  costTracker?: CostTracker;

  /** Result validator for tool output validation */
  resultValidator?: ResultValidator;
}

// ============================================================
// Agent Context (Session-Level Instance)
// ============================================================

/**
 * Agent Context
 *
 * Created per agent session, contains session-specific state and dependencies.
 * Session-level state is isolated between agents.
 *
 * Scope:
 * - sessionId, agentName: Unique per agent
 * - memory, pauseController: New instance per agent
 * - llm: Created via factory (may share connection pool)
 * - tools: Reference to global registry (or wrapped with agent-specific tools)
 * - services: Reference to ApplicationServices
 */
export interface AgentContext {
  // ----- Identity -----
  /** Unique session ID */
  sessionId: string;

  /** Agent name */
  agentName: string;

  // ----- Session-Independent State (New Instance Per Agent) -----
  /** Session memory store */
  memory: MemoryStore;

  /** Pause/resume controller */
  pauseController: PauseController;

  // ----- Reference to Global Services -----
  /** Application-level services */
  services: ApplicationServices;

  // ----- Adapter Instances -----
  /** LLM adapter for this session */
  llm: LLMAdapter;

  /** Tool registry (usually reference to global + session-specific) */
  tools: ToolRegistry;

  // ----- Optional Dependencies -----
  /** Structured logger for replacing console.* calls */
  logger?: Logger;

  /** Checkpoint storage for resumption */
  checkpoint?: CheckpointStorage;

  /** HITL controller for human-in-the-loop */
  hitl?: HITLController;

  // ----- MCP (optional — zero overhead if not configured) -----
  /** MCP client instances keyed by server name */
  mcpClients?: Map<string, MCPClient>;

  /** Subagent registry for nested agents */
  subagents?: SubagentRegistry;

  // ----- Security (optional — zero overhead if not configured) -----
  /** Permission policy for tool execution control */
  permissionPolicy?: PermissionPolicy;

  /** Permission controller for human approval flow */
  permissionController?: PermissionController;

  /** Sandbox executor for isolated tool execution */
  sandboxExecutor?: SandboxExecutor;

  /** Audit logger for security event recording */
  auditLogger?: AuditLogger;

  /** Rate limiter for request frequency control */
  rateLimiter?: RateLimiter;

  /** Input sanitizer for prompt injection detection */
  inputSanitizer?: InputSanitizer;

  // ----- Memory Management (optional) -----
  /** Compaction manager for context window management */
  compactionManager?: CompactionManager;

  /** Quality gate — validates LLM output before it enters context */
  qualityGate?: QualityGate;

  // ----- Quota (optional) ----
  /** Quota controller (optional). When set, enables quota checking before LLM calls. */
  quota?: QuotaController;

  // ----- MPU Session-Level Services (optional — zero overhead if not configured) -----
  /** Security guard for command/path/network blocklist validation */
  securityGuard?: SecurityGuard;

  /** Error classifier for error severity classification */
  errorClassifier?: ErrorClassifier;

  /** Circuit breaker for failure threshold tracking and circuit tripping */
  circuitBreaker?: CircuitBreaker;

  /** Auto-repairer for automatic error recovery strategies */
  autoRepairer?: AutoRepairer;

  /** Planner for task planning and plan validation */
  planner?: Planner;

  // ----- Decision Trace (optional) -----
  /** Decision trace storage for decision traceability */
  decisionTraceStorage?: import('../contracts/decision-trace-storage.js').DecisionTraceStorage;

  // ----- Prompt Construction (optional) -----
  /** Prompt builder for constructing LLM prompts. If not set, messages are passed through as-is. */
  promptBuilder?: PromptBuilder;

  // ----- Plugin Pipeline (optional) -----
  /** Plugin pipeline for event interception and observation */
  /** Hook registry for lifecycle/request/tool hooks */
  hookRegistry?: HookRegistry;

  // ----- Control Signals -----
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;

  // ----- Error Handling -----
  /** Error callback */
  onError?: ErrorHandler;
}

// ============================================================
// Model Configuration
// ============================================================

/**
 * Agent model configuration
 */
export interface AgentModelConfig extends ModelConfig {
  /** API key (optional, may use environment variable) */
  apiKey?: string;

  /** Base URL for API (optional) */
  baseUrl?: string;
}

// ============================================================
// Agent Configuration
// ============================================================

/**
 * Agent configuration schema
 */
export interface AgentConfig {
  // ----- Required -----
  /** Agent name */
  name: string;

  /** Model configuration */
  model: AgentModelConfig;

  // ----- Agent Behavior -----
  /** Maximum steps before termination */
  maxSteps?: number;

  /** System prompt */
  systemPrompt?: string;

  /** Tool names or definitions */
  tools?: string[];

  /** Enable parallel tool calls */
  parallelToolCalls?: boolean;

  // ----- Control Flow -----
  /** Total timeout in milliseconds */
  timeout?: number;

  /** Retry count for recoverable errors */
  retry?: number;

  /** Retry delay in milliseconds */
  retryDelay?: number;

  // ----- Observability -----
  /** Enable tracing */
  tracing?:
    | boolean
    | {
        exporter: 'console' | 'otel' | 'custom';
        endpoint?: string;
      };

  /** Enable metrics */
  metrics?:
    | boolean
    | {
        prefix?: string;
      };

  // ----- Checkpoint -----
  /** Enable checkpointing */
  checkpoint?:
    | boolean
    | {
        storage: 'memory' | 'sqlite' | 'custom';
        path?: string;
        interval?: 'step' | 'tool_result' | 'llm_response';
      };

  // ----- HITL -----
  /** HITL configuration */
  hitl?: {
    onPermissionAsk?: (ask: {
      permission: string;
      context?: Record<string, unknown>;
    }) => Promise<string>;
    autoAllow?: string[];
  };

  // ----- Subsystems -----
  /** Subagent configurations */
  subagents?: Array<{
    name: string;
    mode?: 'primary' | 'subagent' | 'all';
    model?: AgentModelConfig;
    tools?: string[];
    systemPrompt?: string;
  }>;

  /** MCP server configurations */
  mcp?: Array<{
    name: string;
    type: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }>;
}

// ============================================================
// Step Context (For Agent Loop)
// ============================================================

/**
 * Step Context
 *
 * Passed through the agent loop, contains current event and state.
 * Used in expand() recursion pattern.
 */
export interface StepContext {
  /** Current event being processed */
  event: AgentEvent;

  /** Current agent state */
  state: {
    sessionId: string;
    messages: Message[];
    step: number;
    maxSteps: number;
    output: string;
    pendingToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    batchContext?: {
      batchId: string;
      totalCalls: number;
      completedCalls: number;
      startedAt: number;
    };
    tokens: {
      prompt: number;
      completion: number;
    };
    contextManagement?: {
      totalTokens: number;
      compactionCount: number;
      lastCompactionAt?: number;
    };
    lastCheckpoint?: {
      id: string;
      timestamp: number;
      position: 'before_llm' | 'after_llm' | 'before_tool' | 'after_tool';
    };
  };
}

// ============================================================
// Default Implementations
// ============================================================

/**
 * In-memory Memory Store
 *
 * Simple implementation for single-session use.
 */
export class InMemoryStore implements MemoryStore {
  private messages: Message[] = [];

  add(message: Message): void {
    this.messages.push(message);
  }

  getAll(): Message[] {
    return [...this.messages];
  }

  getRecent(count: number): Message[] {
    return this.messages.slice(-count);
  }

  clear(): void {
    this.messages = [];
  }

  count(): number {
    return this.messages.length;
  }
}

/**
 * Default Pause Controller
 *
 * Simple implementation using Subject for resume signal.
 */
export class DefaultPauseController implements PauseController {
  private paused = false;
  private resumeCallbacks: Array<() => void> = [];

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    const callbacks = [...this.resumeCallbacks];
    this.resumeCallbacks = [];
    callbacks.forEach(cb => cb());
  }

  isPaused(): boolean {
    return this.paused;
  }

  onResume(callback: () => void): () => void {
    if (!this.paused) {
      callback();
      return () => {};
    }
    this.resumeCallbacks.push(callback);
    return () => {
      const idx = this.resumeCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.resumeCallbacks.splice(idx, 1);
      }
    };
  }
}

/**
 * Default HITL Controller
 *
 * Implements callback-based HITL pattern.
 * The ask() method registers an onAnswer callback and returns unsubscribe.
 *
 * This enables the NEVER-blocking pattern in the imperative loop:
 * - hitl.ask() registers callback, loop awaits Promise
 * - External answer() call → callback fires → Promise resolves → loop continues
 */
export class DefaultHITLController implements HITLController {
  private askListeners: Array<
    (prompt: {
      askId: string;
      question: string;
      options?: string[];
      metadata?: Record<string, unknown>;
    }) => void
  > = [];
  private pendingAsks = new Map<string, (answer: string) => void>();

  /**
   * Ask a question - registers onAnswer callback. Returns unsubscribe.
   */
  ask(options: HITLAskOptions, onAnswer: (answer: string) => void): () => void {
    // Register the answer callback
    this.pendingAsks.set(options.askId, onAnswer);

    // Notify listeners (UI)
    const askNotification: {
      askId: string;
      question: string;
      options?: string[];
      metadata?: Record<string, unknown>;
    } = {
      askId: options.askId,
      question: options.question,
    };
    if (options.options !== undefined) {
      askNotification.options = options.options;
    }
    if (options.metadata !== undefined) {
      askNotification.metadata = options.metadata;
    }
    for (const listener of this.askListeners) {
      listener(askNotification);
    }

    // Return unsubscribe
    return () => {
      this.pendingAsks.delete(options.askId);
    };
  }

  /**
   * Subscribe to HITL prompts (for UI). Returns unsubscribe.
   */
  onAsk(
    listener: (prompt: {
      askId: string;
      question: string;
      options?: string[];
      metadata?: Record<string, unknown>;
    }) => void
  ): () => void {
    this.askListeners.push(listener);
    return () => {
      const idx = this.askListeners.indexOf(listener);
      if (idx >= 0) {
        this.askListeners.splice(idx, 1);
      }
    };
  }

  /**
   * Provide an answer - called by external system (UI, CLI, etc.)
   */
  answer(askId: string, answer: string): void {
    const callback = this.pendingAsks.get(askId);
    if (callback) {
      callback(answer);
      this.pendingAsks.delete(askId);
    }
  }

  /**
   * Destroy the controller - cleanup all pending asks.
   */
  destroy(): void {
    this.pendingAsks.clear();
    this.askListeners = [];
  }
}

/**
 * Simple Schema Registry
 *
 * Basic implementation for schema management.
 */
export class SimpleSchemaRegistry implements SchemaRegistry {
  private schemas = new Map<string, unknown>();

  register(name: string, schema: unknown): void {
    this.schemas.set(name, schema);
  }

  get(name: string): unknown {
    return this.schemas.get(name);
  }

  has(name: string): boolean {
    return this.schemas.has(name);
  }

  validate(name: string, data: unknown): boolean {
    const schema = this.schemas.get(name);
    if (!schema) {
      return false;
    }
    // Assume Zod schema with safeParse method
    const parseFn = (schema as { safeParse: (d: unknown) => { success: boolean } }).safeParse;
    if (typeof parseFn === 'function') {
      return parseFn(data).success;
    }
    return false;
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Generate unique session ID
 */
export function generateSessionId(prefix = 'session'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Create default application services
 */
export function createDefaultAppServices(): ApplicationServices {
  return {
    schemaRegistry: new SimpleSchemaRegistry(),
    tracer: new NoopTracer(),
    metrics: new NoopMetrics(),
    llmFactory: {
      create: (): LLMAdapter => {
        throw new Error('LLMFactory not configured');
      },
      listProviders: () => [],
      hasProvider: () => false,
    },
    toolRegistry: {
      list: (): string[] => [],
      has: (): boolean => false,
      get: (): ToolDefinition => {
        throw new Error('Tool not found');
      },
      getFunctionDef: (): FunctionDefinition => {
        throw new Error('Tool not found');
      },
      getFunctionDefs: (): FunctionDefinition[] => [],
      execute: (): Promise<string> => {
        throw new Error('Tool not found');
      },
      register: (): void => {},
      registerAll: (): void => {},
    },
  };
}

/**
 * Create tool context (transient)
 */
export function createToolContext(
  agentCtx: AgentContext,
  toolCallId: string,
  options?: { timeout?: number; metadata?: Record<string, unknown> }
): {
  toolCallId: string;
  parentSessionId: string;
  timeout?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
} {
  const result: {
    toolCallId: string;
    parentSessionId: string;
    timeout?: number;
    signal?: AbortSignal;
    metadata?: Record<string, unknown>;
  } = {
    toolCallId,
    parentSessionId: agentCtx.sessionId,
  };

  if (options?.timeout !== undefined) {
    result.timeout = options.timeout;
  }
  if (options?.metadata !== undefined) {
    result.metadata = options.metadata;
  }
  if (agentCtx.abortSignal) {
    result.signal = agentCtx.abortSignal;
  }

  return result;
}
