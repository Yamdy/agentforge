/**
 * AgentForge L3 API - Agent Context Builder
 *
 * Fluent builder for creating AgentContext instances in L3 code.
 * Simplifies context assembly with sensible defaults.
 *
 * @example Basic usage
 * ```typescript
 * import { AgentContextBuilder } from 'agentforge/api';
 *
 * const ctx = AgentContextBuilder.create()
 *   .with({ llm: myLLMAdapter, tools: [readTool, writeTool] })
 *   .build();
 * ```
 *
 * @module
 */

import type {
  LLMAdapter,
  ToolRegistry,
  ToolDefinition,
  MemoryStore,
  CheckpointStorage,
  HITLController,
  PauseController,
  MCPClient,
  SubagentRegistry,
  ErrorHandler,
  Tracer,
  Metrics,
  PermissionController,
  PermissionPolicy,
  SandboxExecutor,
  AuditLogger,
  RateLimiter,
  InputSanitizer,
} from '../core/interfaces.js';
import type { AgentContext, ApplicationServices } from '../core/context.js';
import type { SecurityGuard } from '../security/guard.js';
import type {
  ErrorClassifier,
  CircuitBreaker,
  AutoRepairer,
  HealthChecker,
} from '../contracts/mpu-interfaces.js';
import type { Planner } from '../planning/types.js';
import type { Logger } from '../core/logger.js';
import type { CompactionManager } from '../memory/index.js';
import { createCompactionManager } from '../memory/index.js';
import type { QuotaController } from '../quota/quota-controller.js';
import type { QualityGate } from '../validation/quality-gate.js';
import {
  ContextBuilder,
  SimpleToolRegistry,
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  createDefaultAppServices,
  generateSessionId,
} from '../core/index.js';
import { HookRegistry } from '../core/hooks.js';

// ============================================================
// Types
// ============================================================

/**
 * Model configuration for agent
 */
export interface ModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Agent builder configuration state
 *
 * Tracks partial configuration before build.
 */
interface BuilderState {
  sessionId?: string;
  agentName?: string;
  model?: ModelConfig;
  llm?: LLMAdapter;
  tools?: ToolRegistry | ToolDefinition[];
  memory?: MemoryStore;
  pauseController?: PauseController;
  checkpoint?: CheckpointStorage;
  hitl?: HITLController;
  mcpClients?: Map<string, MCPClient>;
  subagents?: SubagentRegistry;
  abortSignal?: AbortSignal;
  onError?: ErrorHandler;
  tracer?: Tracer;
  metrics?: Metrics;
  appServices?: ApplicationServices;
  securityGuard?: SecurityGuard;
  errorClassifier?: ErrorClassifier;
  circuitBreaker?: CircuitBreaker;
  autoRepairer?: AutoRepairer;
  planner?: Planner;
  rateLimiter?: RateLimiter;
  inputSanitizer?: InputSanitizer;
  permissionController?: PermissionController;
  permissionPolicy?: PermissionPolicy;
  sandboxExecutor?: SandboxExecutor;
  auditLogger?: AuditLogger;
  compactionManager?: CompactionManager;
  qualityGate?: QualityGate;
  quota?: QuotaController;
  hookRegistry?: HookRegistry;
  logger?: Logger;
  healthChecker?: HealthChecker;
}

// ============================================================
// AgentContextBuilder
// ============================================================

/**
 * AgentContextBuilder - Fluent builder for AgentContext
 *
 * L3-optimized builder with:
 * - Default implementations for optional dependencies
 * - Generic `with()` method accepting Partial<BuilderState>
 * - Zero-config minimal setup
 *
 * @example Minimal setup
 * ```typescript
 * const ctx = AgentContextBuilder.create()
 *   .with({ llm: myLLM, tools: [myTool] })
 *   .build();
 * ```
 *
 * @example With tool accumulation
 * ```typescript
 * const ctx = AgentContextBuilder.create()
 *   .with({ llm: myLLM })
 *   .withTool(readTool)
 *   .withTool(writeTool)
 *   .build();
 * ```
 */
export class AgentContextBuilder {
  private state: BuilderState = {};

  private constructor() {}

  static create(): AgentContextBuilder {
    return new AgentContextBuilder();
  }

  // ============================================================
  // Generic setter — replaces 36 single-field withXxx() methods
  // ============================================================

  /**
   * Set any builder state fields via partial object.
   *
   * Replaces the previous withSessionId(), withLLM(), withTools(), etc.
   * single-field methods.
   *
   * @param partial - Partial builder state to merge
   * @returns this
   */
  with(partial: Partial<BuilderState>): this {
    Object.assign(this.state, partial);
    return this;
  }

  // ============================================================
  // Methods with logic (not simple setters)
  // ============================================================

  /**
   * Add a single tool
   *
   * Convenience method for adding tools one at a time.
   *
   * @param tool - Tool definition
   * @returns this
   */
  withTool(tool: ToolDefinition): this {
    if (!Array.isArray(this.state.tools)) {
      this.state.tools = [];
    }
    if (Array.isArray(this.state.tools)) {
      this.state.tools = [...this.state.tools, tool];
    }
    return this;
  }

  /**
   * Enable HITL with default controller
   *
   * @returns this
   */
  withDefaultHITL(): this {
    this.state.hitl = new DefaultHITLController();
    return this;
  }

  /**
   * Set abort controller (extracts signal)
   *
   * @param controller - AbortController instance
   * @returns this
   */
  withAbortController(controller: AbortController): this {
    this.state.abortSignal = controller.signal;
    return this;
  }

  /**
   * Set tracing configuration (OTel-compatible).
   *
   * Resolves the appropriate Tracer based on exporter type.
   * For 'otel' exporter, lazy-loads the OTel SDK via dynamic import.
   *
   * @param config - Tracing configuration
   * @returns this
   */
  async withTracingConfig(config: {
    exporter: 'console' | 'otel' | 'custom' | 'none';
    endpoint?: string;
    serviceName?: string;
    headers?: Record<string, string>;
    sampler?: number;
    customTracer?: Tracer;
  }): Promise<this> {
    if (config.customTracer) {
      this.state.tracer = config.customTracer;
    } else if (config.exporter === 'none') {
      // Keep default NoopTracer (set by createDefaultAppServices)
    } else if (config.exporter === 'otel' && config.endpoint) {
      try {
        /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
        const { OTelTracer } = await import('../observability/tracers/otel-tracer.js');
        const otelTracer = new OTelTracer();
        const otelConfig: import('../observability/tracers/otel-tracer.js').OTelConfig = {
          endpoint: config.endpoint,
        };
        if (config.serviceName !== undefined) otelConfig.serviceName = config.serviceName;
        if (config.headers !== undefined) otelConfig.headers = config.headers;
        if (config.sampler !== undefined) otelConfig.sampler = config.sampler;
        await otelTracer.configure(otelConfig);
        this.state.tracer = otelTracer;
        /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
      } catch {
        // OTel SDK failed to load — keep default NoopTracer
      }
    } else if (config.exporter === 'console') {
      const { ConsoleTracer } = await import('../core/defaults.js');
      this.state.tracer = new ConsoleTracer();
    }
    return this;
  }

  // ============================================================
  // Build
  // ============================================================

  /**
   * Build the AgentContext
   *
   * Validates required dependencies and creates the context.
   *
   * @throws Error if LLM or tools not configured
   * @returns AgentContext instance
   */
  build(): AgentContext {
    if (!this.state.llm) {
      throw new Error('LLM adapter is required. Call with({ llm }) before build().');
    }

    // Create tool registry
    let tools: ToolRegistry;
    if (Array.isArray(this.state.tools)) {
      const registry = new SimpleToolRegistry();
      for (const tool of this.state.tools) {
        registry.register(tool);
      }
      tools = registry;
    } else if (this.state.tools) {
      tools = this.state.tools;
    } else {
      throw new Error('Tools are required. Call with({ tools }) before build().');
    }

    // Create/derive defaults
    const sessionId = this.state.sessionId ?? generateSessionId();
    const agentName = this.state.agentName ?? 'agent';
    const memory = this.state.memory ?? new InMemoryStore();
    const pauseController = this.state.pauseController ?? new DefaultPauseController();

    // Create/derive app services
    const appServices = this.state.appServices ?? createDefaultAppServices();

    // Override tracer/metrics if provided
    if (this.state.tracer) {
      (appServices as { tracer?: Tracer }).tracer = this.state.tracer;
    }
    if (this.state.metrics) {
      (appServices as { metrics?: Metrics }).metrics = this.state.metrics;
    }

    // Build context with required fields
    const ctx: AgentContext = {
      identity: { sessionId, agentName },
      core: { llm: this.state.llm, tools, memory, pauseController, services: appServices },
      security: {},
      controls: {},
      memory: {},
      resilience: {},
      extensions: {},
      harness: { hookRegistry: this.state.hookRegistry ?? new HookRegistry() },
    };

    // Attach optional fields
    if (this.state.checkpoint !== undefined) ctx.controls.checkpoint = this.state.checkpoint;
    if (this.state.hitl !== undefined) ctx.controls.hitl = this.state.hitl;
    if (this.state.mcpClients !== undefined) ctx.extensions.mcpClients = this.state.mcpClients;
    if (this.state.subagents !== undefined) ctx.extensions.subagents = this.state.subagents;
    if (this.state.abortSignal !== undefined) ctx.controls.abortSignal = this.state.abortSignal;
    if (this.state.onError !== undefined) ctx.resilience.onError = this.state.onError;

    // MPU session-level
    if (this.state.securityGuard !== undefined)
      ctx.security.securityGuard = this.state.securityGuard;
    if (this.state.errorClassifier !== undefined)
      ctx.resilience.errorClassifier = this.state.errorClassifier;
    if (this.state.circuitBreaker !== undefined)
      ctx.resilience.circuitBreaker = this.state.circuitBreaker;
    if (this.state.autoRepairer !== undefined)
      ctx.resilience.autoRepairer = this.state.autoRepairer;
    if (this.state.planner !== undefined) ctx.extensions.planner = this.state.planner;

    // Security & sandbox
    if (this.state.rateLimiter !== undefined) ctx.controls.rateLimiter = this.state.rateLimiter;
    if (this.state.inputSanitizer !== undefined)
      ctx.security.inputSanitizer = this.state.inputSanitizer;
    if (this.state.permissionController !== undefined)
      ctx.security.permissionController = this.state.permissionController;
    if (this.state.permissionPolicy !== undefined)
      ctx.security.permissionPolicy = this.state.permissionPolicy;
    if (this.state.sandboxExecutor !== undefined)
      ctx.security.sandboxExecutor = this.state.sandboxExecutor;
    if (this.state.auditLogger !== undefined) ctx.security.auditLogger = this.state.auditLogger;

    // Memory & validation — default compaction manager for automatic compaction
    ctx.memory.compactionManager = this.state.compactionManager ?? createCompactionManager();
    if (this.state.qualityGate !== undefined) ctx.memory.qualityGate = this.state.qualityGate;

    // Quota
    if (this.state.quota !== undefined) ctx.controls.quota = this.state.quota;

    // Hooks & logging
    if (this.state.hookRegistry !== undefined) ctx.harness.hookRegistry = this.state.hookRegistry;
    if (this.state.logger !== undefined) ctx.core.logger = this.state.logger;

    // Application services extras
    if (this.state.healthChecker !== undefined) {
      ctx.core.services.healthChecker = this.state.healthChecker;
    }

    return ctx;
  }
}

// ============================================================
// Convenience Factory Functions
// ============================================================

/**
 * Create a minimal AgentContext
 *
 * @param llm - LLM adapter
 * @param tools - Tool definitions
 * @returns AgentContext
 */
export function createMinimalContext(llm: LLMAdapter, tools: ToolDefinition[]): AgentContext {
  return AgentContextBuilder.create().with({ llm, tools }).build();
}

/**
 * Create AgentContext with HITL
 *
 * @param llm - LLM adapter
 * @param tools - Tool definitions
 * @returns AgentContext with HITL enabled
 */
export function createContextWithHITL(llm: LLMAdapter, tools: ToolDefinition[]): AgentContext {
  return AgentContextBuilder.create().with({ llm, tools }).withDefaultHITL().build();
}

// ============================================================
// Re-exports from core
// ============================================================

export {
  ContextBuilder,
  SimpleToolRegistry,
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  generateSessionId,
};
