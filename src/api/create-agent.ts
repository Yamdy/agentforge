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
  type Checkpoint,
  type ToolDefinition,
  type LLMAdapter,
  type CheckpointStorage,
  ContextBuilder,
  generateSessionId,
  DefaultHITLController,
} from '../core/index.js';
import { createAgentLoop, type AgentLoopConfig, type AgentLoop } from '../loop/index.js';
import {
  debugPreset,
  testPreset,
  timeoutOnEventType,
  retryOnEventType,
} from '../operators/index.js';
import {
  type AgentConfig,
  type Agent,
  type StreamHandlers,
  type AgentSubscription,
  type CreateAgentResult,
  type CheckpointConfig,
  type TracingConfig,
  type MetricsConfig,
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
  model: { provider: string; model: string };
  maxSteps: number;
  parallelToolCalls: boolean;
  streaming: boolean;
  timeout: number | undefined;
  retry: number;
  retryDelay: number;
  maxLLMRepairAttempts: number;
  tools: ToolDefinition[];
  llmAdapter: LLMAdapter | undefined;
  checkpoint: CheckpointConfig | undefined;
  tracing: TracingConfig | undefined;
  metrics: MetricsConfig | undefined;
  operators: MonoTypeOperatorFunction<AgentEvent>[];
  preset: 'production' | 'debug' | 'test' | undefined;
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
  private readonly config: ResolvedConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly eventHandlers = new Map<AgentEventType, Set<(event: AgentEvent) => void>>();
  private readonly eventSubject = new Subject<AgentEvent>();
  private readonly additionalOperators: MonoTypeOperatorFunction<AgentEvent>[] = [];
  private currentSubscription: Subscription | null = null;
  private currentResult: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(
    sessionId: string,
    agentName: string,
    loop: AgentLoop,
    config: ResolvedConfig
  ) {
    this.sessionId = sessionId;
    this.agentName = agentName;
    this.loop = loop;
    this.config = config;

    // Subscribe to event subject for event distribution
    this.loop.destroy$.subscribe(() => {
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
          case 'agent.error':
            const error = new Error(event.error.message);
            error.name = event.error.name;
            handlers.onError?.(error);
            resultReject(error);
            break;
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
      unsubscribe: () => {
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
      observable = observable.pipe(
        timeoutOnEventType('done', this.config.timeout)
      );
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
    }
    // Note: production preset requires tracer/metrics/checkpoint - applied separately if those are configured

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

    this.destroy$.next();
  }

  async pause(): Promise<Checkpoint> {
    // Return a placeholder checkpoint - actual implementation requires state capture
    const checkpoint: Checkpoint = {
      id: `cp-${generateSessionId()}`,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      position: 'after_llm',
      state: {
        sessionId: this.sessionId,
        agentName: this.agentName,
        model: this.config.model,
        messages: [],
        step: 0,
        maxSteps: this.config.maxSteps,
        pendingToolCalls: [],
        output: '',
        tokens: { prompt: 0, completion: 0 },
      },
      pendingA2A: [],
      executedTools: [],
      recoveryMetadata: { recoveryCount: 0 },
      compactionHistory: [],
    };
    return checkpoint;
  }

  async resume(_checkpoint: Checkpoint): Promise<string> {
    // Resume from checkpoint - basic implementation
    // Full implementation would restore state and continue
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

  registerTool(tool: ToolDefinition | ToolDefinition[]): this {
    // Tools are registered via the tool registry in the context
    // This method would need access to the context's tool registry
    // For now, we just store them for reference
    const tools = Array.isArray(tool) ? tool : [tool];
    tools.forEach(t => {
      // Would call this.context.tools.register(t) if we had access
      console.debug(`Tool registered: ${t.name}`);
    });
    return this;
  }
}

// ============================================================
// Configuration Resolution
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
  if (config.tools) {
    for (const t of config.tools) {
      if (typeof t === 'string') {
        // Tool name reference - would need lookup from global registry
        console.debug(`Tool reference: ${t}`);
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
    maxSteps,
    parallelToolCalls,
    streaming,
    timeout: config.timeout,
    retry,
    retryDelay,
    maxLLMRepairAttempts,
    tools,
    llmAdapter: config.llmAdapter,
    checkpoint,
    tracing,
    metrics,
    operators: config.operators ?? [],
    preset: config.preset,
  };
}

/**
 * Create in-memory checkpoint storage
 */
function createInMemoryCheckpointStorage(): CheckpointStorage {
  const checkpoints = new Map<string, Checkpoint>();
  return {
    save: async (cp: Checkpoint) => {
      checkpoints.set(cp.id, cp);
    },
    load: async (sessionId: string) => {
      for (const cp of checkpoints.values()) {
        if (cp.sessionId === sessionId) {
          return cp;
        }
      }
      return null;
    },
    list: async (sessionId?: string) => {
      const all = Array.from(checkpoints.values());
      if (sessionId) {
        return all.filter(cp => cp.sessionId === sessionId);
      }
      return all;
    },
    delete: async (id: string) => {
      checkpoints.delete(id);
    },
    deleteAll: async (sessionId: string) => {
      for (const [id, cp] of checkpoints) {
        if (cp.sessionId === sessionId) {
          checkpoints.delete(id);
        }
      }
    },
  };
}

// ============================================================
// createAgent Factory
// ============================================================
// createAgent Factory
// ============================================================

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
  let builder = ContextBuilder.create()
    .withSessionId(sessionId)
    .withAgentName(resolved.name);

  // Add LLM adapter
  if (resolved.llmAdapter) {
    builder = builder.withLLM(resolved.llmAdapter);
  } else {
    // Create a placeholder LLM adapter that throws
    // In production, this would be replaced with actual implementation
    const placeholderLLM: LLMAdapter = {
      chat: async () => {
        throw new Error('LLM adapter not configured. Please provide llmAdapter in config.');
      },
      stream: () => {
        throw new Error('LLM adapter not configured. Please provide llmAdapter in config.');
      },
    };
    builder = builder.withLLM(placeholderLLM);
  }

  // Add tools
  if (resolved.tools.length > 0) {
    builder = builder.withTools(resolved.tools);
  }

  // Add checkpoint storage
  if (resolved.checkpoint) {
    const storage =
      resolved.checkpoint.customStorage ?? createInMemoryCheckpointStorage();
    builder = builder.withCheckpoint(storage);
  }

  // Add HITL if configured
  if (config.hitl) {
    builder = builder.withHITL(new DefaultHITLController());
  }

  // Build the context
  const ctx = builder.build();

  // Create loop configuration - build conditionally for exactOptionalPropertyTypes
  const loopConfig: AgentLoopConfig = resolved.checkpoint
    ? {
        model: resolved.model,
        maxSteps: resolved.maxSteps,
        maxLLMRepairAttempts: resolved.maxLLMRepairAttempts,
        parallelToolCalls: resolved.parallelToolCalls,
        streaming: resolved.streaming,
        checkpoint: {
          enabled: true,
          interval: resolved.checkpoint.interval ?? 'llm_response',
        },
      }
    : {
        model: resolved.model,
        maxSteps: resolved.maxSteps,
        maxLLMRepairAttempts: resolved.maxLLMRepairAttempts,
        parallelToolCalls: resolved.parallelToolCalls,
        streaming: resolved.streaming,
      };

  // Create the agent loop
  const loop = createAgentLoop(ctx, loopConfig);

  // Create the agent instance
  const agent = new AgentImpl(sessionId, resolved.name, loop, resolved);

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
