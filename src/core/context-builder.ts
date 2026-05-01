/**
 * AgentForge Context Builder
 *
 * Builder pattern for assembling AgentContext.
 * Used for:
 * - Configuration-driven DI (createAgent)
 * - Manual assembly (programming mode)
 * - Testing (mock injection)
 *
 * @see docs/RXJS-EVENT-STREAM-DESIGN.md - 轻量依赖注入 section
 */

import type {
  LLMAdapter,
  LLMAdapterFactory,
  ToolRegistry,
  ToolDefinition,
  MemoryStore,
  CheckpointStorage,
  HITLController,
  PauseController as PauseControllerInterface,
  MCPClient,
  SubagentRegistry,
  ErrorHandler,
  ToolContext,
  FunctionDefinition as FunctionDefinitionInterface,
  PromptBuilder,
} from './interfaces.js';
import type { QuotaController } from '../quota/quota-controller.js';
import type { CompactionManager } from '../memory/index.js';
import type { ApplicationServices, AgentContext } from './context.js';
import {
  InMemoryStore,
  DefaultPauseController,
  SimpleSchemaRegistry,
  createDefaultAppServices,
  generateSessionId,
} from './context.js';
import { toolToFunctionDef } from './zod-to-schema.js';

// ============================================================
// Context Builder
// ============================================================

/**
 * Context Builder
 *
 * Fluent builder for creating AgentContext.
 *
 * Example:
 * ```typescript
 * const ctx = ContextBuilder.create()
 *   .withAppServices(app)
 *   .withSessionId('my-session')
 *   .withLLM(myLLMAdapter)
 *   .withTools(myTools)
 *   .withCheckpoint(myStorage)
 *   .build();
 * ```
 */
export class ContextBuilder {
  private context: Partial<AgentContext> = {};
  private appServices?: ApplicationServices;

  private constructor() {}

  /**
   * Create a new builder instance
   */
  static create(): ContextBuilder {
    return new ContextBuilder();
  }

  /**
   * Inject application services
   *
   * Must be set first, or createAgent will set default.
   */
  withAppServices(services: ApplicationServices): this {
    this.appServices = services;
    this.context.services = services;
    return this;
  }

  /**
   * Set session ID
   */
  withSessionId(sessionId: string): this {
    this.context.sessionId = sessionId;
    return this;
  }

  /**
   * Set agent name
   */
  withAgentName(name: string): this {
    this.context.agentName = name;
    return this;
  }

  /**
   * Set LLM adapter
   */
  withLLM(llm: LLMAdapter): this {
    this.context.llm = llm;
    return this;
  }

  /**
   * Set tool registry or tool definitions
   *
   * If array of tools provided, creates a SimpleToolRegistry.
   */
  withTools(tools: ToolRegistry | ToolDefinition[]): this {
    if (Array.isArray(tools)) {
      const registry = new SimpleToolRegistry();
      tools.forEach(t => registry.register(t));
      this.context.tools = registry;
    } else {
      this.context.tools = tools;
    }
    return this;
  }

  /**
   * Set memory store
   */
  withMemory(memory: MemoryStore): this {
    this.context.memory = memory;
    return this;
  }

  /**
   * Set pause controller
   */
  withPauseController(controller: PauseControllerInterface): this {
    this.context.pauseController = controller;
    return this;
  }

  /**
   * Set checkpoint storage
   */
  withCheckpoint(storage: CheckpointStorage): this {
    this.context.checkpoint = storage;
    return this;
  }

  /**
   * Set HITL controller
   */
  withHITL(hitl: HITLController): this {
    this.context.hitl = hitl;
    return this;
  }

  /**
   * Set MCP client
   */
  withMCPClients(clients: Map<string, MCPClient>): this {
    this.context.mcpClients = clients;
    return this;
  }

  /**
   * Set subagent registry
   */
  withSubagents(subagents: SubagentRegistry): this {
    this.context.subagents = subagents;
    return this;
  }

  /**
   * Set abort signal
   */
  withAbortSignal(signal: AbortSignal): this {
    this.context.abortSignal = signal;
    return this;
  }

  /**
   * Set error handler
   */
  withErrorHandler(handler: ErrorHandler): this {
    this.context.onError = handler;
    return this;
  }

  /**
   * Set quota controller
   */
  withQuota(quota: QuotaController): this {
    this.context.quota = quota;
    return this;
  }

  /**
   * Set compaction manager
   */
  withCompactionManager(manager: CompactionManager): this {
    this.context.compactionManager = manager;
    return this;
  }

  /**
   * Set prompt builder for constructing LLM prompts
   *
   * When set, the prompt builder will be used in the LLM call path
   * to construct messages from templates instead of raw passthrough.
   *
   * @param builder - PromptBuilder instance
   * @returns this
   */
  withPromptBuilder(builder: PromptBuilder): this {
    this.context.promptBuilder = builder;
    return this;
  }

  /**
   * Build the AgentContext
   *
   * Validates that required dependencies are set.
   */
  build(): AgentContext {
    // Validate required dependencies
    if (!this.context.llm) {
      throw new Error('LLM adapter is required');
    }
    if (!this.context.tools) {
      throw new Error('ToolRegistry is required');
    }

    // Create default app services if not provided
    const services = this.appServices ?? createDefaultAppServices();

    // Create default session-level state if not provided
    const sessionId = this.context.sessionId ?? generateSessionId();
    const memory = this.context.memory ?? new InMemoryStore();
    const pauseController = this.context.pauseController ?? new DefaultPauseController();

    // Build context with conditional optional properties
    const ctx: AgentContext = {
      sessionId,
      agentName: this.context.agentName ?? 'agent',
      memory,
      pauseController,
      services,
      llm: this.context.llm,
      tools: this.context.tools,
    };

    if (this.context.checkpoint) ctx.checkpoint = this.context.checkpoint;
    if (this.context.hitl) ctx.hitl = this.context.hitl;
    if (this.context.mcpClients !== undefined) ctx.mcpClients = this.context.mcpClients;
    if (this.context.subagents) ctx.subagents = this.context.subagents;
    if (this.context.abortSignal) ctx.abortSignal = this.context.abortSignal;
    if (this.context.onError) ctx.onError = this.context.onError;
    if (this.context.promptBuilder) ctx.promptBuilder = this.context.promptBuilder;

    return ctx;
  }
}

// ============================================================
// Simple Tool Registry
// ============================================================

/**
 * Simple Tool Registry Implementation
 *
 * Basic implementation for tool management.
 */
export class SimpleToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    tools.forEach(t => this.register(t));
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getFunctionDef(name: string): FunctionDefinitionInterface | undefined {
    const tool = this.tools.get(name);
    if (!tool) return undefined;

    return toolToFunctionDef(tool);
  }

  getFunctionDefs(): FunctionDefinitionInterface[] {
    return this.list().map(name => this.getFunctionDef(name)!);
  }

  async execute(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    return tool.execute(args, ctx);
  }
}

// ============================================================
// Application Services Factory
// ============================================================

/**
 * Create Application Services
 *
 * Called once at application startup.
 */
export function createApplicationServices(config?: {
  tracing?: { exporter: 'console' | 'otel' | 'custom'; endpoint?: string };
  metrics?: { prefix?: string };
  llmFactory?: LLMAdapterFactory;
}): ApplicationServices {
  const schemaRegistry = new SimpleSchemaRegistry();

  const llmFactory: LLMAdapterFactory = config?.llmFactory ?? {
    create: (): LLMAdapter => {
      throw new Error('LLMFactory not configured');
    },
    listProviders: () => [],
    hasProvider: () => false,
  };

  const toolRegistry = new SimpleToolRegistry();

  return {
    // tracer and metrics omitted until factory is implemented
    schemaRegistry,
    llmFactory,
    toolRegistry,
  };
}

// ============================================================
// Delegating Tool Registry
// ============================================================

/**
 * Delegating Tool Registry
 *
 * Wraps a parent registry, allowing local additions.
 * Used for agent-specific tools on top of global registry.
 */
export class DelegatingToolRegistry implements ToolRegistry {
  private localTools = new Map<string, ToolDefinition>();

  constructor(private parent: ToolRegistry) {}

  register(tool: ToolDefinition): void {
    this.localTools.set(tool.name, tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    tools.forEach(t => this.register(t));
  }

  list(): string[] {
    const parentTools = this.parent.list();
    const localTools = Array.from(this.localTools.keys());
    return [...new Set([...parentTools, ...localTools])];
  }

  has(name: string): boolean {
    return this.localTools.has(name) || this.parent.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.localTools.get(name) ?? this.parent.get(name);
  }

  getFunctionDef(name: string): FunctionDefinitionInterface | undefined {
    const tool = this.get(name);
    if (!tool) return undefined;

    return toolToFunctionDef(tool);
  }

  getFunctionDefs(): FunctionDefinitionInterface[] {
    return this.list().map(name => this.getFunctionDef(name)!);
  }

  async execute(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<string> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    return tool.execute(args, ctx);
  }
}
