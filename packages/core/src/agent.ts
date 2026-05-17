import type {
  AgentConfig,
  AgentSimpleConfig,
  CheckpointStore,
  PipelineContext,
  PipelineStageConfig,
  Processor,
  SessionManager,
  Tool,
  Tracer,
} from '@primo-ai/sdk';
import { PipelineRunner } from './pipeline.js';
import { serialize } from './serialize.js';
import { ToolRegistry } from './tool-registry.js';
import { PluginManager, type PluginFactory } from './plugin-manager.js';
import { LLMInvoker } from './llm-invoker.js';
import { ModelFactory } from './model-factory.js';
import { BuiltInGateway, getDefaultBuiltInGateway } from './gateways/builtin-gateway.js';
import { AuthError, ModelNotFoundError } from './errors.js';
import { LoopOrchestrator } from './loop-orchestrator.js';
import { JsonlCheckpointStore } from './checkpoint-store.js';
import { echoTool } from '@primo-ai/tools';
import {
  processInputProcessor,
  prepareStepExtensionPoint,
  createInvokeLLMProcessor,
  processStepOutputProcessor,
  gateToolExtensionPoint,
  createExecuteToolsProcessor,
  createEvaluateIterationProcessor,
  processOutputProcessor,
} from './processors/index.js';
import { ContextBuilder } from './context-builder.js';

export interface AgentDependencies {
  runner?: PipelineRunner;
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  tracer?: Tracer;
  modelFactory?: ModelFactory;
  sessionManager?: SessionManager;
  checkpointStore?: CheckpointStore<ReturnType<typeof serialize>>;
  /** When provided, creates a JsonlCheckpointStore for crash-safe checkpoint persistence */
  checkpointDir?: string;
  /** When true, saves a checkpoint after each completed iteration */
  autoCheckpoint?: boolean;
  contextBuilder?: ContextBuilder;
  /** Override default pipeline stage order. */
  stageConfig?: PipelineStageConfig;
}

export interface AgentRunResult {
  response: string;
  tokenUsage: import('@primo-ai/sdk').TokenUsage;
  sessionId: string;
  /** Number of compat retries that occurred during the agentic loop. */
  compatRetries: number;
}

export class Agent {
  private config: AgentConfig;
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private _pluginManager: PluginManager;
  private _tracer?: Tracer;
  private _autoCheckpoint: boolean;
  private _model: import('ai').LanguageModel | null = null;
  private modelFactory: ModelFactory;
  private orchestrator: LoopOrchestrator;
  private sessionManager?: SessionManager;
  private contextBuilder: ContextBuilder;
  private activeAbortController: AbortController | null = null;
  private lastContext?: PipelineContext;

  constructor(config: AgentSimpleConfig);
  constructor(config: AgentConfig, deps?: AgentDependencies);
  constructor(config: AgentConfig | AgentSimpleConfig, deps?: AgentDependencies) {
    this.config = config;
    this.modelFactory = deps?.modelFactory ?? new ModelFactory();
    this.modelFactory.registerGateway(getDefaultBuiltInGateway());
    this._tracer = deps?.tracer;
    this.runner = deps?.runner ?? new PipelineRunner({ tracer: deps?.tracer });
    this.registry = deps?.registry ?? new ToolRegistry();
    this.contextBuilder = deps?.contextBuilder ?? new ContextBuilder({ registry: this.registry });
    this._pluginManager = deps?.pluginManager ?? new PluginManager(this.runner, this.registry, this.contextBuilder);
    this.registry.setHookManager(this._pluginManager.hookManager);
    this.registry.setEventBus(this._pluginManager.eventBus);
    this.runner.setHookManager(this._pluginManager.hookManager);
    const store = deps?.checkpointStore ?? (deps?.checkpointDir ? new JsonlCheckpointStore<ReturnType<typeof serialize>>(deps.checkpointDir) : undefined);
    this.orchestrator = new LoopOrchestrator(this.runner, this._pluginManager.hookManager, store, this._pluginManager.eventBus, deps?.stageConfig);
    this.sessionManager = deps?.sessionManager;
    this._autoCheckpoint = deps?.autoCheckpoint ?? false;
    this.registerTools();
    this.registerBuiltinProcessors();
    this._pluginManager.setStageMutator((m) => this.orchestrator.applyMutation(m));
  }

  use(factory: Processor | PluginFactory): void {
    if (typeof factory === 'function') {
      this._pluginManager.initializePlugin(factory as PluginFactory);
    } else {
      this.runner.register(factory as Processor);
    }
  }

  async teardown(): Promise<void> {
    await this._pluginManager.shutdown();
  }

  get pipelineRunner(): PipelineRunner {
    return this.runner;
  }

  get toolRegistry(): ToolRegistry {
    return this.registry;
  }

  get pluginManager(): PluginManager {
    return this._pluginManager;
  }

  get eventBus(): import('./event-bus.js').EventBus {
    return this._pluginManager.eventBus;
  }

  get eventSystem(): import('./event-system.js').EventSystem {
    return this._pluginManager.eventSystem;
  }

  get state(): import('./state-machine.js').AgentState {
    return this.orchestrator.state;
  }

  /** Subscribe to an event type. Returns an unsubscribe function. */
  on(eventType: string, handler: (data?: unknown) => void): () => void {
    return this.eventBus.subscribe(eventType, handler);
  }

  /** Subscribe to an event type for at most one emission. */
  once(eventType: string, handler: (data?: unknown) => void): void {
    this.eventBus.once(eventType, handler);
  }

  /** Remove a specific handler for an event type. */
  off(eventType: string, handler: (data?: unknown) => void): void {
    this.eventBus.unsubscribe(eventType, handler);
  }

  get _contextBuilder(): ContextBuilder {
    return this.contextBuilder;
  }

  async run(input: string, signal?: globalThis.AbortSignal): Promise<AgentRunResult> {
    if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');
    this._pluginManager.freezeHarnessInstances();

    const context = await this.buildContext(input);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    const controller = new AbortController();
    this.activeAbortController = controller;
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      const { context: finalCtx, compatRetries } = await this.orchestrator.runLoop(context, {
        maxIterations: maxIter,
        signal: controller.signal,
        modelString: this.config.model,
        sessionId: context.request.sessionId,
        autoCheckpoint: this._autoCheckpoint,
      });

      this.lastContext = finalCtx;

      return {
        response: finalCtx.iteration.response as string ?? '',
        tokenUsage: finalCtx.session.totalTokenUsage ?? { input: 0, output: 0 },
        sessionId: context.request.sessionId,
        compatRetries,
      };
    } catch (error) {
      this.autoInvalidateModel(error);
      throw error;
    } finally {
      this.activeAbortController = null;
      // agent.end hook — always fires, even on error; suppress hook errors to preserve original
      try { await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {}); } catch { /* hook error must not mask original */ }
    }
  }

  async resume(sessionId: string, signal?: globalThis.AbortSignal): Promise<AgentRunResult> {
    if (signal?.aborted) throw new DOMException('Agent resume aborted', 'AbortError');

    const hm = this._pluginManager.hookManager;
    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;

    try {
      const { context: finalCtx, compatRetries } = await this.orchestrator.resumeLoop(sessionId, {
        maxIterations: maxIter,
        signal,
        modelString: this.config.model,
        sessionId,
        autoCheckpoint: this._autoCheckpoint,
      });

      return {
        response: finalCtx.iteration.response as string ?? '',
        tokenUsage: finalCtx.session.totalTokenUsage ?? { input: 0, output: 0 },
        sessionId,
        compatRetries,
      };
    } catch (error) {
      this.autoInvalidateModel(error);
      throw error;
    } finally {
      try { await hm.invoke('agent.end', { sessionId }, {}); } catch { /* hook error must not mask original */ }
    }
  }

  async *stream(input: string, signal?: globalThis.AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    const context = await this.buildContext(input);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    const controller = new AbortController();
    this.activeAbortController = controller;
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      let finalCtx: PipelineContext | undefined;
      for await (const event of this.orchestrator.streamEvents(context, {
        maxIterations: maxIter,
        signal: controller.signal,
        modelString: this.config.model,
        sessionId: context.request.sessionId,
        autoCheckpoint: this._autoCheckpoint,
      })) {
        if (event.type === 'text_delta') yield event.text;
        if (event.type === 'suspended') yield ` [suspended: ${(event as { reason: string }).reason}]`;
        if (event.type === 'complete') finalCtx = (event as { context: PipelineContext }).context;
      }
      this.lastContext = finalCtx;
    } finally {
      this.activeAbortController = null;
      try { await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {}); } catch { /* hook error must not mask original */ }
    }
  }

  async *streamEvents(input: string, signal?: globalThis.AbortSignal): AsyncGenerator<import('@primo-ai/sdk').StreamEvent> {
    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    const context = await this.buildContext(input);
    const hm = this._pluginManager.hookManager;

    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    const controller = new AbortController();
    this.activeAbortController = controller;
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      let finalCtx: PipelineContext | undefined;
      for await (const event of this.orchestrator.streamEvents(context, {
        maxIterations: maxIter,
        signal: controller.signal,
        modelString: this.config.model,
        sessionId: context.request.sessionId,
        autoCheckpoint: this._autoCheckpoint,
      })) {
        if (event.type === 'complete') finalCtx = (event as { context: PipelineContext }).context;
        yield event;
      }
      this.lastContext = finalCtx;
    } finally {
      this.activeAbortController = null;
      try { await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {}); } catch { /* hook error must not mask original */ }
    }
  }

  /** Abort a running agent. Idempotent — no-op if agent is not running. */
  abort(): void {
    if (!this.orchestrator.stateMachine.canTransition('cancelled')) return;
    this.orchestrator.stateMachine.transition('cancelled');
    this.activeAbortController?.abort();
    this.activeAbortController = null;
  }

  /** Clear conversation state so the next run/stream starts a fresh session. */
  reset(): void {
    this.lastContext = undefined;
  }

  /** Clear the cached model so the next run re-resolves from the factory. */
  invalidateModel(): void {
    this._model = null;
  }

  /** Auto-invalidate cached model when the error indicates auth failure or model-not-found. */
  private autoInvalidateModel(error: unknown): void {
    if (isAuthOrNotFoundError(error)) {
      this._model = null;
    }
  }

  private async getLLM(systemPrompt?: string): Promise<LLMInvoker> {
    if (!this._model) {
      this._model = await this.modelFactory.resolve(this.config.model);
    }
    return new LLMInvoker({
      model: this._model,
      system: systemPrompt,
      retryOptions: { maxRetries: 3, baseDelay: 1000 },
      tracer: this._tracer,
    });
  }

  private async buildContext(input: string): Promise<PipelineContext> {
    if (this.lastContext) {
      return {
        request: { input, sessionId: this.lastContext.request.sessionId },
        agent: { config: { ...this.config }, promptFragments: [], toolDeclarations: [] },
        iteration: { step: 0 },
        session: {
          messageHistory: [
            ...(this.lastContext.session.messageHistory ?? []),
            { role: 'user', content: input },
          ],
          totalTokenUsage: this.lastContext.session.totalTokenUsage,
          custom: { ...this.lastContext.session.custom },
        },
      };
    }
    return this.createContext(input);
  }

  private async createContext(input: string): Promise<PipelineContext> {
    let sessionId: string = crypto.randomUUID();
    if (this.sessionManager) {
      const record = await this.sessionManager.start(input);
      sessionId = record.sessionId;
    }
    return {
      request: { input, sessionId },
      agent: { config: { ...this.config }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { custom: {} },
    };
  }

  private registerTools(): void {
    const userToolNames = new Set((this.config.tools ?? []).map(t => t.name));
    if (!userToolNames.has(echoTool.name)) {
      this.registry.register(echoTool as Tool);
    }
    for (const tool of this.config.tools ?? []) {
      this.registry.register(tool as Tool);
    }
  }

  private registerBuiltinProcessors(): void {
    this.runner.register(processInputProcessor);
    this.runner.register(this.contextBuilder.createProcessor());
    this.runner.register(prepareStepExtensionPoint);
    this.runner.register(createInvokeLLMProcessor({
      getLLM: (systemPrompt) => this.getLLM(systemPrompt),
      registry: this.registry,
      hookManager: this._pluginManager.hookManager,
      modelString: this.config.model,
    }));
    this.runner.register(processStepOutputProcessor);
    this.runner.register(gateToolExtensionPoint);
    this.runner.register(createExecuteToolsProcessor(this.registry));
    this.runner.register(createEvaluateIterationProcessor({ eventBus: this._pluginManager.eventBus }));
    this.runner.register(processOutputProcessor);
  }
}

/**
 * Create an Agent from a simple config. Convenience wrapper for single-agent usage.
 * For advanced usage (Dynamic config, providerOptions, custom dependencies), use `new Agent(config, deps)`.
 */
export function createAgent(config: AgentSimpleConfig): Agent {
  return new Agent(config);
}

function isAuthOrNotFoundError(error: unknown): boolean {
  if (error instanceof AuthError || error instanceof ModelNotFoundError) return true;
  if (!(error instanceof Error)) return false;
  const err = error as Error & { statusCode?: number; status?: number };
  const code = err.statusCode ?? err.status;
  return code === 401 || code === 403 || code === 404;
}
