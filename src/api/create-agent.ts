/**
 * AgentForge L2 API - createAgent Factory
 *
 * Creates an Agent instance from a declarative configuration.
 * This is the main entry point for the L2 (configuration-based) API.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/12-API-DESIGN.md
 */

import { Observable, Subject, firstValueFrom, Subscription } from 'rxjs';
import { tap, takeUntil, toArray } from 'rxjs/operators';
import type { MonoTypeOperatorFunction } from 'rxjs';
import {
  type AgentEvent,
  type AgentEventType,
  type AgentState,
  type AgentContext,
  type Checkpoint,
  type Message,
  type ToolDefinition,
  type LLMAdapter,
  type LLMResponse,
  type LLMChunk,
  type CheckpointStorage,
  type ToolRegistryInterface,
  ContextBuilder,
  generateSessionId,
  DefaultHITLController,
} from '../core/index.js';
import { createAgentLoop, type AgentLoopConfig, type AgentLoop } from '../loop/index.js';
import {
  debugPreset,
  testPreset,
  productionPreset,
  timeoutOnEventType,
  retryOnEventType,
} from '../operators/index.js';
import { createLLMAdapter, parseModelSpec } from '../adapters/index.js';
import { createPluginManager, createPluginContext, type Plugin } from '../plugins/index.js';
import {
  createMemoryPlugin,
  createSkillsPlugin,
  createSummarizationPlugin,
} from '../plugins/index.js';
import { FileBasedMemory } from '../memory/index.js';
import { createMCPClient, adaptMCPTools } from '../mcp/index.js';
import type { MCPClient, MCPStatus } from '../core/interfaces.js';
import {
  type AgentConfig,
  type Agent,
  type StreamHandlers,
  type AgentSubscription,
  type CreateAgentResult,
  type CheckpointConfig,
  type TracingConfig,
  type MetricsConfig,
  type AgentModelConfig,
  DEFAULT_AGENT_CONFIG,
} from './types.js';

// ============================================================
// Internal Types
// ============================================================

/**
 * Resolved configuration after applying defaults
 */
interface ResolvedConfig {
  name: string;
  model: AgentModelConfig | string;
  llmOptions: Record<string, unknown> | undefined;
  maxSteps: number;
  parallelToolCalls: boolean;
  streaming: boolean;
  timeout: number | undefined;
  retry: number;
  retryDelay: number;
  maxLLMRepairAttempts: number;
  tools: ToolDefinition[];
  toolNames: string[]; // Tool names to resolve from global registry
  llmAdapter: LLMAdapter | undefined;
  checkpoint: CheckpointConfig | undefined;
  tracing: TracingConfig | undefined;
  metrics: MetricsConfig | undefined;
  operators: MonoTypeOperatorFunction<AgentEvent>[];
  preset: 'production' | 'debug' | 'test' | undefined;
  history: Message[];
  systemPrompt: string | undefined;
}

// ============================================================
// Agent Implementation
// ============================================================

/**
 * Agent implementation class
 */
class AgentImpl implements Agent {
  private readonly sessionId: string;
  private readonly agentName: string;
  private readonly loop: AgentLoop;
  private readonly tools: ToolRegistryInterface;
  private readonly config: ResolvedConfig;
  private readonly ctx: AgentContext;
  private readonly destroy$ = new Subject<void>();
  private readonly eventHandlers = new Map<AgentEventType, Set<(event: AgentEvent) => void>>();
  private readonly eventSubject = new Subject<AgentEvent>();
  private readonly additionalOperators: MonoTypeOperatorFunction<AgentEvent>[] = [];
  private readonly mcpSubscriptions: Subscription[] = []; // MCP status change subscriptions

  // Allow createAgent to add MCP subscriptions for cleanup
  addMCPSubscription(sub: Subscription): void {
    this.mcpSubscriptions.push(sub);
  }
  private currentSubscription: Subscription | null = null;
  private loopDestroySubscription: Subscription | null = null;
  private currentResult: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(
    sessionId: string,
    agentName: string,
    loop: AgentLoop,
    tools: ToolRegistryInterface,
    config: ResolvedConfig,
    ctx: AgentContext
  ) {
    this.sessionId = sessionId;
    this.agentName = agentName;
    this.loop = loop;
    this.tools = tools;
    this.config = config;
    this.ctx = ctx;

    // Subscribe to event subject for event distribution
    this.loopDestroySubscription = this.loop.destroy$.subscribe(() => {
      this.destroy$.next();
      this.destroy$.complete();
    });
  }

  // ----- Execution -----

  run(input: string): Promise<string> {
    return firstValueFrom(
      this.run$(input).pipe(
        // Collect all events until terminal event
        takeUntil(this.destroy$),
        toArray()
      )
    ).then(events => {
      // Find the completion output
      for (const event of events) {
        if (event.type === 'agent.complete') {
          return event.output;
        }
        if (event.type === 'agent.error') {
          throw new Error(event.error.message);
        }
        if (event.type === 'done') {
          if (event.reason === 'error') {
            throw new Error('Agent terminated with error');
          }
          if (event.reason === 'cancelled') {
            throw new Error('Agent was cancelled');
          }
        }
      }
      // No terminal event found
      return '';
    });
  }

  stream(input: string, handlers: StreamHandlers): AgentSubscription {
    let resultResolve: (value: string) => void;
    let resultReject: (error: Error) => void;
    const resultPromise = new Promise<string>((resolve, reject) => {
      resultResolve = resolve;
      resultReject = reject;
    });

    const subscription = this.run$(input).subscribe({
      next: event => {
        // Call general event handler
        handlers.onEvent?.(event);

        // Call specific handlers based on event type
        switch (event.type) {
          case 'llm.stream.text':
            handlers.onText?.(event.delta);
            break;
          case 'tool.call':
            handlers.onToolCall?.(event.toolName, event.args);
            break;
          case 'tool.result':
            handlers.onToolResult?.(event.toolName, event.result, event.isError);
            break;
          case 'agent.step':
            handlers.onStep?.(event.step, event.maxSteps);
            break;
          case 'agent.complete':
            handlers.onComplete?.(event.output);
            resultResolve(event.output);
            break;
          case 'agent.error': {
            const error = new Error(event.error.message);
            error.name = event.error.name;
            handlers.onError?.(error);
            resultReject(error);
            break;
          }
          case 'done':
            if (event.reason === 'error' && !handlers.onError) {
              resultReject(new Error('Agent terminated with error'));
            } else if (event.reason === 'cancelled') {
              resultReject(new Error('Agent was cancelled'));
            }
            break;
        }
      },
      error: err => {
        const error = err instanceof Error ? err : new Error(String(err));
        handlers.onError?.(error);
        resultReject(error);
      },
      complete: () => {
        // Stream completed - result may have been resolved via agent.complete
      },
    });

    this.currentSubscription = subscription;
    this.currentResult = { resolve: resultResolve!, reject: resultReject! };

    return {
      unsubscribe: (): void => {
        subscription.unsubscribe();
        this.currentSubscription = null;
        this.currentResult = null;
      },
      result: resultPromise,
    };
  }

  run$(input: string): Observable<AgentEvent> {
    // Build the pipeline
    let observable = this.loop.run(input);

    // Apply additional operators
    for (const op of this.additionalOperators) {
      observable = observable.pipe(op);
    }

    // Apply timeout if configured
    if (this.config.timeout !== undefined) {
      observable = observable.pipe(timeoutOnEventType('done', this.config.timeout));
    }

    // Apply retry if configured
    if (this.config.retry > 0) {
      observable = observable.pipe(
        retryOnEventType('agent.error', this.config.retry, this.config.retryDelay)
      );
    }

    // Apply preset if configured
    if (this.config.preset === 'debug') {
      observable = observable.pipe(debugPreset());
    } else if (this.config.preset === 'test') {
      observable = observable.pipe(testPreset());
    } else if (this.config.preset === 'production') {
      // Use configured services or noop fallbacks
      const tracer = this.ctx.services.tracer ?? {
        startSpan: (): string => '',
        endSpan: (): void => {},
        addEvent: (): void => {},
        recordException: (): void => {},
      };
      const metrics = this.ctx.services.metrics ?? {
        increment: (): void => {},
        histogram: (): void => {},
        gauge: (): void => {},
      };
      const checkpointStorage = this.ctx.checkpoint ?? createInMemoryCheckpointStorage();
      observable = observable.pipe(
        productionPreset({
          tracer,
          metrics,
          checkpointStorage,
          sessionId: this.sessionId,
        })
      );
    }

    // Apply custom operators from config
    for (const op of this.config.operators) {
      observable = observable.pipe(op);
    }

    // Tap to distribute events to handlers
    observable = observable.pipe(
      tap(event => {
        this.eventSubject.next(event);
        const handlers = this.eventHandlers.get(event.type);
        if (handlers) {
          handlers.forEach(handler => {
            try {
              handler(event);
            } catch {
              // Ignore handler errors
            }
          });
        }
      })
    );

    return observable;
  }

  // ----- Control -----

  cancel(reason?: string): void {
    // Emit cancel event and complete
    this.eventSubject.next({
      type: 'cancel',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      reason,
    });

    if (this.currentSubscription) {
      this.currentSubscription.unsubscribe();
      this.currentSubscription = null;
    }

    if (this.currentResult) {
      this.currentResult.reject(new Error(reason ?? 'Agent cancelled'));
      this.currentResult = null;
    }

    this.destroy();
  }

  destroy(): void {
    // Clean up MCP status subscriptions
    for (const sub of this.mcpSubscriptions) {
      sub.unsubscribe();
    }
    this.mcpSubscriptions.length = 0;

    // Disconnect MCP clients
    if (this.ctx.mcpClients) {
      for (const [, client] of this.ctx.mcpClients) {
        try {
          client.disconnect().catch(() => {});
        } catch {
          // Ignore disconnect errors during cleanup
        }
      }
    }

    this.loopDestroySubscription?.unsubscribe();
    this.loopDestroySubscription = null;
    if (!this.eventSubject.closed) {
      this.eventSubject.complete();
    }
    if (!this.destroy$.closed) {
      this.destroy$.complete();
    }
  }

  pause(): Promise<Checkpoint> {
    // Use real state from the agent loop if available
    const currentState: AgentState = this.loop.getCurrentState() ?? {
      sessionId: this.sessionId,
      agentName: this.agentName,
      model: normalizeModelForLoop(this.config.model),
      messages: [],
      step: 0,
      maxSteps: this.config.maxSteps,
      pendingToolCalls: [],
      output: '',
      tokens: { prompt: 0, completion: 0 },
    };

    const checkpoint: Checkpoint = {
      id: `cp-${generateSessionId()}`,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      position: 'after_llm',
      state: currentState,
      pendingA2A: [],
      executedTools: [],
      recoveryMetadata: { recoveryCount: 0 },
      compactionHistory: [],
    };
    return Promise.resolve(checkpoint);
  }

  resume(checkpoint: Checkpoint): Promise<string> {
    // Restore state from checkpoint and continue execution
    const { state } = checkpoint;

    // Build the messages array from checkpoint state
    const messages = [...state.messages];

    // Add a continuation message to prompt the agent to continue
    messages.push({ role: 'user', content: 'Please continue from where you left off.' });

    // Create a new run with the restored state context
    // The agent will continue from the checkpoint's message history
    return this.run('Resumed from checkpoint');
  }

  // ----- Event Listening -----

  on(eventType: AgentEventType, handler: (event: AgentEvent) => void): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    const handlers = this.eventHandlers.get(eventType)!;
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventType);
      }
    };
  }

  // ----- Dynamic Configuration -----

  use(operator: MonoTypeOperatorFunction<AgentEvent>): this {
    this.additionalOperators.push(operator);
    return this;
  }

  /**
   * Clear all additional operators.
   * Call this before adding new operators if you want to reset the pipeline.
   */
  clearOperators(): this {
    this.additionalOperators.length = 0;
    return this;
  }

  registerTool(tool: ToolDefinition | ToolDefinition[]): this {
    const tools = Array.isArray(tool) ? tool : [tool];
    tools.forEach(t => {
      this.tools.register(t);
    });
    return this;
  }
}

// ============================================================
// Model Normalization
// ============================================================

/**
 * Normalize model config to the format expected by AgentLoopConfig.
 *
 * Converts:
 * - String "provider/model" → { provider, model }
 * - String "model" (auto-detect) → { provider, model }
 * - Object { provider, model } → { provider, model }
 */
function normalizeModelForLoop(model: AgentModelConfig | string): {
  provider: string;
  model: string;
} {
  if (typeof model === 'string') {
    return parseModelSpec(model);
  }

  return {
    provider: model.provider,
    model: model.model,
  };
}

// ============================================================
// LLM Adapter Resolution
// ============================================================

/**
 * Resolve configuration with defaults
 */
function resolveConfig(config: AgentConfig): ResolvedConfig {
  const name = config.name ?? DEFAULT_AGENT_CONFIG.name;
  const maxSteps = config.maxSteps ?? DEFAULT_AGENT_CONFIG.maxSteps;
  const parallelToolCalls = config.parallelToolCalls ?? DEFAULT_AGENT_CONFIG.parallelToolCalls;
  const streaming = config.streaming ?? DEFAULT_AGENT_CONFIG.streaming;
  const retry = config.retry ?? DEFAULT_AGENT_CONFIG.retry;
  const retryDelay = config.retryDelay ?? DEFAULT_AGENT_CONFIG.retryDelay;
  const maxLLMRepairAttempts =
    config.maxLLMRepairAttempts ?? DEFAULT_AGENT_CONFIG.maxLLMRepairAttempts;

  // Resolve tools
  const tools: ToolDefinition[] = [];
  const toolNames: string[] = [];
  if (config.tools) {
    for (const t of config.tools) {
      if (typeof t === 'string') {
        // Tool name reference - will be resolved from global registry later
        toolNames.push(t);
      } else {
        tools.push(t);
      }
    }
  }

  // Resolve checkpoint
  let checkpoint: CheckpointConfig | undefined;
  if (config.checkpoint) {
    if (typeof config.checkpoint === 'boolean') {
      checkpoint = { storage: 'memory' };
    } else {
      checkpoint = config.checkpoint;
    }
  }

  // Resolve tracing
  let tracing: TracingConfig | undefined;
  if (config.tracing) {
    if (typeof config.tracing === 'boolean') {
      tracing = { exporter: 'console' };
    } else {
      tracing = config.tracing;
    }
  }

  // Resolve metrics
  let metrics: MetricsConfig | undefined;
  if (config.metrics) {
    if (typeof config.metrics === 'boolean') {
      metrics = {};
    } else {
      metrics = config.metrics;
    }
  }

  return {
    name,
    model: config.model,
    llmOptions: config.llmOptions,
    maxSteps,
    parallelToolCalls,
    streaming,
    timeout: config.timeout,
    retry,
    retryDelay,
    maxLLMRepairAttempts,
    tools,
    toolNames,
    llmAdapter: config.llmAdapter,
    checkpoint,
    tracing,
    metrics,
    operators: config.operators ?? [],
    preset: config.preset,
    history: config.history ?? [],
    systemPrompt: config.systemPrompt,
  };
}

/**
 * Create in-memory checkpoint storage
 */
function createInMemoryCheckpointStorage(): CheckpointStorage {
  const checkpoints = new Map<string, Checkpoint>();
  return {
    save: (cp: Checkpoint): Promise<void> => {
      checkpoints.set(cp.id, cp);
      return Promise.resolve();
    },
    load: (sessionId: string): Promise<Checkpoint | null> => {
      for (const cp of checkpoints.values()) {
        if (cp.sessionId === sessionId) {
          return Promise.resolve(cp);
        }
      }
      return Promise.resolve(null);
    },
    list: (sessionId?: string): Promise<Checkpoint[]> => {
      const all = Array.from(checkpoints.values());
      if (sessionId) {
        return Promise.resolve(all.filter(cp => cp.sessionId === sessionId));
      }
      return Promise.resolve(all);
    },
    delete: (id: string): Promise<void> => {
      checkpoints.delete(id);
      return Promise.resolve();
    },
    deleteAll: (sessionId: string): Promise<void> => {
      for (const [id, cp] of checkpoints) {
        if (cp.sessionId === sessionId) {
          checkpoints.delete(id);
        }
      }
      return Promise.resolve();
    },
  };
}

// ============================================================
// createAgent Factory
// ============================================================

/**
 * Resolve LLM adapter from config.
 *
 * Supports:
 * 1. Explicit llmAdapter in config
 * 2. String model format: "provider/model" or "model" (auto-detect)
 * 3. Object model format: { provider, model, apiKey?, baseUrl?, ... }
 */
function resolveLLMAdapterFromConfig(config: ResolvedConfig): LLMAdapter {
  const { model, llmOptions } = config;

  // String format: "provider/model" or "model" (auto-detect)
  if (typeof model === 'string') {
    return createLLMAdapter(model, llmOptions);
  }

  // Object format: { provider, model, apiKey?, baseUrl?, ... }
  if (typeof model === 'object') {
    const spec = `${model.provider}/${model.model}`;
    const options = {
      ...llmOptions,
      apiKey: model.apiKey,
      baseURL: model.baseUrl,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
    };
    return createLLMAdapter(spec, options);
  }

  // Fallback: placeholder adapter
  return {
    name: 'placeholder',
    provider: 'none',
    chat: (): Promise<LLMResponse> => {
      throw new Error('LLM adapter not configured. Please provide model config or llmAdapter.');
    },
    stream: (): Observable<LLMChunk> => {
      throw new Error('LLM adapter not configured. Please provide model config or llmAdapter.');
    },
  };
}

/**
 * Create an Agent instance from declarative configuration.
 *
 * This is the main entry point for the L2 (configuration-based) API.
 * The returned Agent provides multiple execution modes:
 *
 * - `agent.run(input)` - Promise-based, returns final result
 * - `agent.stream(input, handlers)` - Callback-based streaming
 * - `agent.run$(input)` - RxJS Observable (L3 access)
 *
 * @param config - Agent configuration
 * @returns Agent instance
 *
 * @example
 * ```typescript
 * import { createAgent } from 'agentforge';
 *
 * const agent = createAgent({
 *   name: 'assistant',
 *   model: { provider: 'openai', model: 'gpt-4o' },
 *   maxSteps: 10,
 *   timeout: 60000,
 * });
 *
 * // Promise mode
 * const result = await agent.run('Hello, how are you?');
 *
 * // Streaming mode
 * agent.stream('Tell me a story', {
 *   onText: (delta) => process.stdout.write(delta),
 *   onComplete: (result) => console.log('\nDone:', result),
 * });
 * ```
 */
export function createAgent(config: AgentConfig): CreateAgentResult {
  // Resolve configuration with defaults
  const resolved = resolveConfig(config);

  // Generate session ID
  const sessionId = generateSessionId();

  // Build context using ContextBuilder
  let builder = ContextBuilder.create().withSessionId(sessionId).withAgentName(resolved.name);

  // Add LLM adapter
  if (resolved.llmAdapter) {
    // Priority 1: Explicitly provided adapter
    builder = builder.withLLM(resolved.llmAdapter);
  } else {
    // Priority 2: Create adapter from model config
    const llmAdapter = resolveLLMAdapterFromConfig(resolved);
    builder = builder.withLLM(llmAdapter);
  }

  // Add tools (always create a ToolRegistry, even if empty)
  builder = builder.withTools(resolved.tools);

  // Add checkpoint storage
  if (resolved.checkpoint) {
    const storage = resolved.checkpoint.customStorage ?? createInMemoryCheckpointStorage();
    builder = builder.withCheckpoint(storage);
  }

  // Add HITL if configured
  if (config.hitl) {
    builder = builder.withHITL(new DefaultHITLController());
  }

  // Build the context
  const ctx = builder.build();

  // Set up plugin pipeline if configured
  // Collect all plugins: explicit plugins + auto-created memory/skills plugins
  const allPlugins: Plugin[] = [...(config.plugins ?? [])];

  // Auto-create Memory Plugin if memory config is provided
  if (config.memory?.enabled && config.memory.sources.length > 0) {
    const memory = new FileBasedMemory(config.memory);
    allPlugins.push(createMemoryPlugin(memory, config.memory));
  }

  // Auto-create Skills Plugin if skills config is provided
  if (config.skills?.sources && config.skills.sources.length > 0) {
    allPlugins.push(createSkillsPlugin(config.skills.sources));
  }

  // Auto-create Summarization Plugin if summarization config is provided
  if (config.summarization) {
    allPlugins.push(createSummarizationPlugin(config.summarization));
  }

  if (allPlugins.length > 0) {
    const manager = createPluginManager();
    const pluginContext = createPluginContext({
      sessionId,
      agentName: resolved.name,
      ...(ctx.services.tracer !== undefined ? { tracer: ctx.services.tracer } : {}),
      ...(ctx.services.metrics !== undefined ? { metrics: ctx.services.metrics } : {}),
    });
    manager.setContext(pluginContext);
    for (const plugin of allPlugins) {
      manager.register(plugin);
    }
    ctx.pluginPipeline = (source: Observable<AgentEvent>): Observable<AgentEvent> => {
      return manager.buildPipeline(source);
    };
  }

  // Resolve tool names from global registry
  if (resolved.toolNames.length > 0 && ctx.services.toolRegistry) {
    for (const toolName of resolved.toolNames) {
      const toolDef = ctx.services.toolRegistry.get(toolName);
      if (toolDef) {
        ctx.tools.register(toolDef);
      } else {
        ctx.logger?.warn(`Tool "${toolName}" not found in global registry, skipping.`);
      }
    }
  }

  // Set up MCP clients if configured (background connection, non-blocking)
  const mcpSubscriptions: Subscription[] = [];

  if (config.mcp && config.mcp.length > 0) {
    const mcpClients = new Map<string, MCPClient>();

    for (const serverConfig of config.mcp) {
      try {
        const client = createMCPClient(serverConfig, {
          serverName: serverConfig.name,
          sessionId,
          timeout: 30000,
        });

        mcpClients.set(serverConfig.name, client);

        // Subscribe to status changes for automatic tool re-registration on reconnect
        const statusSub = client.onStatusChange().subscribe({
          next: (status: MCPStatus) => {
            if (status === 'connected') {
              client
                .tools()
                .then(mcpTools => {
                  const adaptedTools = adaptMCPTools(mcpTools, client, serverConfig.name);
                  for (const tool of adaptedTools) {
                    ctx.tools.register(tool);
                  }
                })
                .catch(() => {
                  // Tool discovery failure must never crash the agent
                });
            }
          },
          error: () => {
            // Status change subscription error — ignore
          },
        });
        mcpSubscriptions.push(statusSub);

        // Background connection and tool discovery (fire-and-forget)
        // Tools will be registered in the tool registry when ready
        client
          .connect()
          .then(async () => {
            const mcpTools = await client.tools();
            const adaptedTools = adaptMCPTools(mcpTools, client, serverConfig.name);
            for (const tool of adaptedTools) {
              ctx.tools.register(tool);
            }
          })
          .catch((error: unknown) => {
            // MCP connection failure must never crash the agent
            ctx.logger?.warn(
              `Failed to connect to MCP server "${serverConfig.name}": ${error instanceof Error ? error.message : String(error)}`
            );
          });
      } catch (error) {
        // createMCPClient can throw synchronously for invalid configs
        ctx.logger?.warn(
          `Failed to create MCP client for "${serverConfig.name}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (mcpClients.size > 0) {
      ctx.mcpClients = mcpClients;
    }
  }

  // Transfer MCP subscriptions to agent for cleanup
  // (will be done after agent is created below)

  // Create loop configuration - build conditionally for exactOptionalPropertyTypes
  const normalizedModel = normalizeModelForLoop(resolved.model);

  // Build base config
  const baseConfig = {
    model: normalizedModel,
    maxSteps: resolved.maxSteps,
    maxLLMRepairAttempts: resolved.maxLLMRepairAttempts,
    parallelToolCalls: resolved.parallelToolCalls,
    streaming: resolved.streaming,
  };

  // Add optional fields conditionally
  const loopConfig: AgentLoopConfig = {
    ...baseConfig,
    ...(resolved.checkpoint && {
      checkpoint: {
        enabled: true,
        interval: resolved.checkpoint.interval ?? 'llm_response',
      },
    }),
    ...(resolved.history.length > 0 && {
      history: resolved.history,
    }),
    ...(resolved.systemPrompt && {
      systemPrompt: resolved.systemPrompt,
    }),
  };

  // Create the agent loop
  const loop = createAgentLoop(ctx, loopConfig);

  // Create the agent instance
  const agent = new AgentImpl(sessionId, resolved.name, loop, ctx.tools, resolved, ctx);

  // Transfer MCP subscriptions to agent for cleanup
  for (const sub of mcpSubscriptions) {
    agent.addMCPSubscription(sub);
  }

  // Return with context info
  return Object.assign(agent, {
    context: {
      sessionId,
      agentName: resolved.name,
    },
  });
}

// ============================================================
// Re-export Types
// ============================================================

export {
  type AgentConfig,
  type Agent,
  type StreamHandlers,
  type AgentSubscription,
  type CreateAgentResult,
  type CheckpointConfig,
  type TracingConfig,
  type MetricsConfig,
  type AgentModelConfig,
  type SubagentConfig,
  type MCPServerConfig,
  type HITLConfig,
  DEFAULT_AGENT_CONFIG,
} from './types.js';
