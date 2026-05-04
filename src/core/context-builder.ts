/**
 * AgentForge Context Builder
 *
 * Builder pattern for assembling AgentContext.
 * Used for:
 * - Configuration-driven DI (createAgent)
 * - Manual assembly (programming mode)
 * - Testing (mock injection)
 *
 */

import type {
  LLMAdapter,
  LLMAdapterFactory,
  ToolRegistry,
  ToolDefinition,
  ToolContext,
  FunctionDefinition as FunctionDefinitionInterface,
} from './interfaces.js';
import type { ApplicationServices, AgentContext } from './context.js';
import {
  InMemoryStore,
  DefaultPauseController,
  SimpleSchemaRegistry,
  createDefaultAppServices,
  generateSessionId,
} from './context.js';
import { toolToFunctionDef } from './zod-to-schema.js';
import { HookRegistry } from './hooks.js';

// ============================================================
// Context Builder State
// ============================================================

/**
 * Flat builder state — internal storage for ContextBuilder.
 * Mirrors the old flat AgentContext fields before they were grouped into sub-objects.
 */
interface BuilderState {
  sessionId?: string;
  agentName?: string;
  llm?: LLMAdapter;
  tools?: ToolRegistry | ToolDefinition[];
  memory?: import('./interfaces.js').MemoryStore;
  pauseController?: import('./interfaces.js').PauseController;
  checkpoint?: import('./interfaces.js').CheckpointStorage;
  hitl?: import('./interfaces.js').HITLController;
  mcpClients?: Map<string, import('./interfaces.js').MCPClient>;
  subagents?: import('./interfaces.js').SubagentRegistry;
  abortSignal?: AbortSignal;
  onError?: import('./interfaces.js').ErrorHandler;
}

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
 *   .with({ sessionId: 'my-session', llm: myLLMAdapter, checkpoint: myStorage })
 *   .withTools(myTools)
 *   .build();
 * ```
 */
export class ContextBuilder {
  private state: BuilderState = {};
  private appServices?: ApplicationServices;

  private constructor() {}

  static create(): ContextBuilder {
    return new ContextBuilder();
  }

  with(partial: BuilderState): this {
    Object.assign(this.state, partial);
    return this;
  }

  withAppServices(services: ApplicationServices): this {
    this.appServices = services;
    return this;
  }

  withTools(tools: ToolRegistry | ToolDefinition[]): this {
    if (Array.isArray(tools)) {
      const registry = new SimpleToolRegistry();
      tools.forEach(t => registry.register(t));
      this.state.tools = registry;
    } else {
      this.state.tools = tools;
    }
    return this;
  }

  build(): AgentContext {
    if (!this.state.llm) {
      throw new Error('LLM adapter is required');
    }
    if (!this.state.tools) {
      throw new Error('ToolRegistry is required');
    }

    const services = this.appServices ?? createDefaultAppServices();
    const sessionId = this.state.sessionId ?? generateSessionId();
    const memory = this.state.memory ?? new InMemoryStore();
    const pauseController = this.state.pauseController ?? new DefaultPauseController();

    let tools: ToolRegistry;
    if (Array.isArray(this.state.tools)) {
      const registry = new SimpleToolRegistry();
      for (const tool of this.state.tools) {
        registry.register(tool);
      }
      tools = registry;
    } else {
      tools = this.state.tools;
    }

    const ctx: AgentContext = {
      identity: {
        sessionId,
        agentName: this.state.agentName ?? 'agent',
      },
      core: {
        llm: this.state.llm,
        tools,
        memory,
        pauseController,
        services,
      },
      security: {},
      controls: {},
      memory: {},
      resilience: {},
      extensions: {},
      harness: { hookRegistry: new HookRegistry() },
    };

    if (this.state.checkpoint) ctx.controls.checkpoint = this.state.checkpoint;
    if (this.state.hitl) ctx.controls.hitl = this.state.hitl;
    if (this.state.mcpClients !== undefined) ctx.extensions.mcpClients = this.state.mcpClients;
    if (this.state.subagents) ctx.extensions.subagents = this.state.subagents;
    if (this.state.abortSignal) ctx.controls.abortSignal = this.state.abortSignal;
    if (this.state.onError) ctx.resilience.onError = this.state.onError;

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
