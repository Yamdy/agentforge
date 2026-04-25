/**
 * AgentForge L3 API - Agent Context Builder
 *
 * Fluent builder for creating AgentContext instances in L3 code.
 * Simplifies context assembly with sensible defaults.
 *
 * Design principles:
 * - Zero-config defaults for quick start
 * - Fluent API for incremental configuration
 * - Type-safe optional dependencies
 * - NO as any - proper type inference
 *
 * @example Basic usage
 * ```typescript
 * import { AgentContextBuilder } from 'agentforge/api';
 *
 * const ctx = AgentContextBuilder.create()
 *   .withModel({ provider: 'openai', model: 'gpt-4o' })
 *   .withLLM(myLLMAdapter)
 *   .withTools([readTool, writeTool])
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
} from '../core/interfaces.js';
import type { AgentContext, ApplicationServices } from '../core/context.js';
import {
  ContextBuilder,
  SimpleToolRegistry,
  InMemoryStore,
  DefaultPauseController,
  DefaultHITLController,
  createDefaultAppServices,
  generateSessionId,
} from '../core/index.js';

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
  mcp?: MCPClient;
  subagents?: SubagentRegistry;
  abortSignal?: AbortSignal;
  errorHandler?: ErrorHandler;
  tracer?: Tracer;
  metrics?: Metrics;
  appServices?: ApplicationServices;
}

// ============================================================
// AgentContextBuilder
// ============================================================

/**
 * AgentContextBuilder - Fluent builder for AgentContext
 *
 * L3-optimized builder with:
 * - Default implementations for optional dependencies
 * - Fluent API with type inference
 * - Zero-config minimal setup
 *
 * @example Minimal setup
 * ```typescript
 * const ctx = AgentContextBuilder.create()
 *   .withLLM(myLLM)
 *   .withTools([myTool])
 *   .build();
 * ```
 *
 * @example Full setup
 * ```typescript
 * const ctx = AgentContextBuilder.create()
 *   .withSessionId('my-session')
 *   .withAgentName('assistant')
 *   .withModel({ provider: 'openai', model: 'gpt-4o' })
 *   .withLLM(myLLM)
 *   .withTools([readTool, writeTool, bashTool])
 *   .withMemory(customMemory)
 *   .withCheckpoint(sqliteStorage)
 *   .withHITL(customHITL)
 *   .withAbortController(controller)
 *   .build();
 * ```
 */
export class AgentContextBuilder {
  private state: BuilderState = {};

  private constructor() {}

  /**
   * Create a new builder instance
   *
   * @returns New AgentContextBuilder
   */
  static create(): AgentContextBuilder {
    return new AgentContextBuilder();
  }

  // ============================================================
  // Identity
  // ============================================================

  /**
   * Set session ID
   *
   * If not provided, a unique ID will be generated.
   *
   * @param sessionId - Unique session identifier
   * @returns this
   */
  withSessionId(sessionId: string): this {
    this.state.sessionId = sessionId;
    return this;
  }

  /**
   * Set agent name
   *
   * If not provided, defaults to 'agent'.
   *
   * @param agentName - Agent name
   * @returns this
   */
  withAgentName(agentName: string): this {
    this.state.agentName = agentName;
    return this;
  }

  /**
   * Set model configuration
   *
   * @param model - Model configuration
   * @returns this
   */
  withModel(model: ModelConfig): this {
    this.state.model = model;
    return this;
  }

  // ============================================================
  // Core Dependencies
  // ============================================================

  /**
   * Set LLM adapter
   *
   * Required: Either this or withLLMFactory must be called.
   *
   * @param llm - LLM adapter instance
   * @returns this
   */
  withLLM(llm: LLMAdapter): this {
    this.state.llm = llm;
    return this;
  }

  /**
   * Set tool registry or tool definitions
   *
   * Required: Must provide tools for agent to use.
   *
   * @param tools - ToolRegistry instance or array of ToolDefinition
   * @returns this
   */
  withTools(tools: ToolRegistry | ToolDefinition[]): this {
    this.state.tools = tools;
    return this;
  }

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

  // ============================================================
  // Optional Dependencies
  // ============================================================

  /**
   * Set memory store
   *
   * If not provided, InMemoryStore is used.
   *
   * @param memory - Memory store instance
   * @returns this
   */
  withMemory(memory: MemoryStore): this {
    this.state.memory = memory;
    return this;
  }

  /**
   * Set pause controller
   *
   * If not provided, DefaultPauseController is used.
   *
   * @param controller - Pause controller instance
   * @returns this
   */
  withPauseController(controller: PauseController): this {
    this.state.pauseController = controller;
    return this;
  }

  /**
   * Set checkpoint storage
   *
   * Enables agent state persistence for resumption.
   *
   * @param storage - Checkpoint storage instance
   * @returns this
   */
  withCheckpoint(storage: CheckpointStorage): this {
    this.state.checkpoint = storage;
    return this;
  }

  /**
   * Set HITL controller
   *
   * Enables human-in-the-loop interactions.
   *
   * @param hitl - HITL controller instance
   * @returns this
   */
  withHITL(hitl: HITLController): this {
    this.state.hitl = hitl;
    return this;
  }

  /**
   * Enable HITL with default controller
   *
   * Convenience method to enable HITL without custom controller.
   *
   * @returns this
   */
  withDefaultHITL(): this {
    this.state.hitl = new DefaultHITLController();
    return this;
  }

  /**
   * Set MCP client
   *
   * @param mcp - MCP client instance
   * @returns this
   */
  withMCP(mcp: MCPClient): this {
    this.state.mcp = mcp;
    return this;
  }

  /**
   * Set subagent registry
   *
   * @param subagents - Subagent registry instance
   * @returns this
   */
  withSubagents(subagents: SubagentRegistry): this {
    this.state.subagents = subagents;
    return this;
  }

  // ============================================================
  // Control
  // ============================================================

  /**
   * Set abort signal
   *
   * @param signal - AbortSignal for cancellation
   * @returns this
   */
  withAbortSignal(signal: AbortSignal): this {
    this.state.abortSignal = signal;
    return this;
  }

  /**
   * Set abort controller
   *
   * Convenience method to use AbortController.
   *
   * @param controller - AbortController instance
   * @returns this
   */
  withAbortController(controller: AbortController): this {
    this.state.abortSignal = controller.signal;
    return this;
  }

  /**
   * Set error handler
   *
   * @param handler - Error handler function
   * @returns this
   */
  withErrorHandler(handler: ErrorHandler): this {
    this.state.errorHandler = handler;
    return this;
  }

  // ============================================================
  // Observability
  // ============================================================

  /**
   * Set tracer
   *
   * @param tracer - Tracer instance
   * @returns this
   */
  withTracer(tracer: Tracer): this {
    this.state.tracer = tracer;
    return this;
  }

  /**
   * Set metrics
   *
   * @param metrics - Metrics instance
   * @returns this
   */
  withMetrics(metrics: Metrics): this {
    this.state.metrics = metrics;
    return this;
  }

  /**
   * Set application services
   *
   * Advanced: Override default app services.
   *
   * @param services - Application services
   * @returns this
   */
  withAppServices(services: ApplicationServices): this {
    this.state.appServices = services;
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
    // Validate required dependencies
    if (!this.state.llm) {
      throw new Error('LLM adapter is required. Call withLLM() before build().');
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
      throw new Error('Tools are required. Call withTools() before build().');
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
      sessionId,
      agentName,
      memory,
      pauseController,
      services: appServices,
      llm: this.state.llm,
      tools,
    };

    // Add optional fields
    if (this.state.checkpoint !== undefined) {
      ctx.checkpoint = this.state.checkpoint;
    }
    if (this.state.hitl !== undefined) {
      ctx.hitl = this.state.hitl;
    }
    if (this.state.mcp !== undefined) {
      ctx.mcp = this.state.mcp;
    }
    if (this.state.subagents !== undefined) {
      ctx.subagents = this.state.subagents;
    }
    if (this.state.abortSignal !== undefined) {
      ctx.abortSignal = this.state.abortSignal;
    }
    if (this.state.errorHandler !== undefined) {
      ctx.onError = this.state.errorHandler;
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
 * Quick factory for minimal configuration.
 * LLM and tools must be provided.
 *
 * @param llm - LLM adapter
 * @param tools - Tool definitions
 * @returns AgentContext
 *
 * @example
 * ```typescript
 * const ctx = createMinimalContext(myLLM, [readTool, writeTool]);
 * ```
 */
export function createMinimalContext(
  llm: LLMAdapter,
  tools: ToolDefinition[]
): AgentContext {
  return AgentContextBuilder.create()
    .withLLM(llm)
    .withTools(tools)
    .build();
}

/**
 * Create AgentContext with HITL
 *
 * Convenience factory for HITL-enabled context.
 *
 * @param llm - LLM adapter
 * @param tools - Tool definitions
 * @returns AgentContext with HITL enabled
 *
 * @example
 * ```typescript
 * const ctx = createContextWithHITL(myLLM, [readTool, writeTool]);
 * const hitl = ctx.hitl!;
 *
 * // Subscribe to asks
 * hitl.onAsk().subscribe(ask => {
 *   showQuestionDialog(ask.question).then(answer => {
 *     hitl.answer(ask.askId, answer);
 *   });
 * });
 * ```
 */
export function createContextWithHITL(
  llm: LLMAdapter,
  tools: ToolDefinition[]
): AgentContext {
  return AgentContextBuilder.create()
    .withLLM(llm)
    .withTools(tools)
    .withDefaultHITL()
    .build();
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
