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
import type { PluginManager } from '../plugins/manager.js';
import type { QuotaController } from '../quota/quota-controller.js';
import type { CompactionManager } from '../memory/index.js';
import type { WorkingMemory, WorkingMemoryProcessor } from '../memory/working-memory.js';

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
import type { CheckpointRegistry } from './checkpoint-registry.js';
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

// ============================================================
// Agent Context Sub-Interfaces
// ============================================================

/** Agent identity — session and agent name */
export interface AgentIdentity {
  sessionId: string;
  agentName: string;
}

/** Core services — always available */
export interface AgentCore {
  llm: LLMAdapter;
  tools: ToolRegistry;
  memory: MemoryStore;
  pauseController: PauseController;
  services: ApplicationServices;
  logger?: Logger;
}

/** Security controls */
export interface AgentSecurity {
  permissionPolicy?: PermissionPolicy;
  permissionController?: PermissionController;
  sandboxExecutor?: SandboxExecutor;
  auditLogger?: AuditLogger;
  inputSanitizer?: InputSanitizer;
  securityGuard?: SecurityGuard;
}

/** Flow controls */
export interface AgentControls {
  hitl?: HITLController;
  rateLimiter?: RateLimiter;
  quota?: QuotaController;
  checkpoint?: CheckpointStorage;
  abortSignal?: AbortSignal;
}

/** Memory management (compaction, working memory, quality gate) */
export interface AgentMemoryContext {
  compactionManager?: CompactionManager;
  workingMemory?: WorkingMemory;
  workingMemoryProcessor?: WorkingMemoryProcessor;
  qualityGate?: QualityGate;
}

/** Resilience (error handling, circuit breaker, auto-repair) */
export interface AgentResilience {
  errorClassifier?: ErrorClassifier;
  circuitBreaker?: CircuitBreaker;
  autoRepairer?: AutoRepairer;
  onError?: ErrorHandler;
}

/** Extensions (MCP, subagents, planning) */
export interface AgentExtensions {
  mcpClients?: Map<string, MCPClient>;
  subagents?: SubagentRegistry;
  planner?: Planner;
}

/** Harness runtime — internal plugin wiring */
export interface AgentHarness {
  hookRegistry: HookRegistry;
  pluginManager?: PluginManager;
  checkpointRegistry?: CheckpointRegistry;
}

/**
 * Agent Context
 *
 * Created per agent session, contains session-specific state and dependencies.
 * Grouped into 8 sub-objects by concern.
 */
export interface AgentContext {
  identity: AgentIdentity;
  core: AgentCore;
  security: AgentSecurity;
  controls: AgentControls;
  memory: AgentMemoryContext;
  resilience: AgentResilience;
  extensions: AgentExtensions;
  harness: AgentHarness;
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
    parentSessionId: agentCtx.identity.sessionId,
  };

  if (options?.timeout !== undefined) {
    result.timeout = options.timeout;
  }
  if (options?.metadata !== undefined) {
    result.metadata = options.metadata;
  }
  if (agentCtx.controls.abortSignal) {
    result.signal = agentCtx.controls.abortSignal;
  }

  return result;
}
