import type {
  AgentConfig,
  CheckpointStore,
  PipelineContext,
  Processor,
  SessionManager,
  Tool,
  Tracer,
} from '@agentforge/sdk';
import { PipelineRunner } from './pipeline.js';
import { serialize } from './serialize.js';
import { ToolRegistry } from './tool-registry.js';
import { PluginManager, type PluginFactory } from './plugin-manager.js';
import { LLMInvoker } from './llm-invoker.js';
import { ModelFactory } from './model-factory.js';
import { BuiltInGateway } from './gateways/builtin-gateway.js';
import { LoopOrchestrator } from './loop-orchestrator.js';
import { JsonlCheckpointStore } from './checkpoint-store.js';
import { echoTool } from '@agentforge/tools';
import {
  processInputProcessor,
  buildContextExtensionPoint,
  prepareStepExtensionPoint,
  createInvokeLLMProcessor,
  processStepOutputProcessor,
  createExecuteToolsProcessor,
  createEvaluateIterationProcessor,
  processOutputProcessor,
} from './processors/index.js';
import { ContextBuilder, type ContextBuilderOptions } from './context-builder.js';

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
  contextBuilder?: ContextBuilder;
}

export interface AgentRunResult {
  response: string;
  tokenUsage: import('@agentforge/sdk').TokenUsage;
  sessionId: string;
}

export class Agent {
  private config: AgentConfig;
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private _pluginManager: PluginManager;
  private _tracer?: Tracer;
  private _model: import('ai').LanguageModel | null = null;
  private modelFactory: ModelFactory;
  private orchestrator: LoopOrchestrator;
  private sessionManager?: SessionManager;
  private contextBuilder: ContextBuilder;

  constructor(config: AgentConfig, deps?: AgentDependencies) {
    this.config = config;
    this.modelFactory = deps?.modelFactory ?? new ModelFactory();
    this.modelFactory.registerGateway(new BuiltInGateway());
    this._tracer = deps?.tracer;
    this.runner = deps?.runner ?? new PipelineRunner({ tracer: deps?.tracer });
    this.registry = deps?.registry ?? new ToolRegistry();
    this.contextBuilder = deps?.contextBuilder ?? new ContextBuilder({ registry: this.registry });
    this._pluginManager = deps?.pluginManager ?? new PluginManager(this.runner, this.registry, this.contextBuilder);
    this.registry.setHookManager(this._pluginManager.hookManager);
    this.registry.setEventBus(this._pluginManager.eventBus);
    this.runner.setHookManager(this._pluginManager.hookManager);
    const store = deps?.checkpointStore ?? (deps?.checkpointDir ? new JsonlCheckpointStore<ReturnType<typeof serialize>>(deps.checkpointDir) : undefined);
    this.orchestrator = new LoopOrchestrator(this.runner, this._pluginManager.hookManager, store, this._pluginManager.eventBus);
    this.sessionManager = deps?.sessionManager;
    this.registerTools();
    this.registerBuiltinProcessors();
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

  get _contextBuilder(): ContextBuilder {
    return this.contextBuilder;
  }

  async run(input: string, signal?: globalThis.AbortSignal): Promise<AgentRunResult> {
    if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

    const context = await this.createContext(input);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    try {
      const finalCtx = await this.orchestrator.runLoop(context, {
        maxIterations: maxIter,
        signal,
        modelString: this.config.model,
        sessionId: context.request.sessionId,
      });

      return {
        response: finalCtx.iteration.response as string ?? '',
        tokenUsage: finalCtx.session.totalTokenUsage ?? { input: 0, output: 0 },
        sessionId: context.request.sessionId,
      };
    } finally {
      // agent.end hook — always fires, even on error; suppress hook errors to preserve original
      try { await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {}); } catch { /* hook error must not mask original */ }
    }
  }

  async resume(sessionId: string, signal?: globalThis.AbortSignal): Promise<AgentRunResult> {
    if (signal?.aborted) throw new DOMException('Agent resume aborted', 'AbortError');

    const hm = this._pluginManager.hookManager;
    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;

    try {
      const finalCtx = await this.orchestrator.resumeLoop(sessionId, {
        maxIterations: maxIter,
        signal,
        modelString: this.config.model,
        sessionId,
      });

      return {
        response: finalCtx.iteration.response as string ?? '',
        tokenUsage: finalCtx.session.totalTokenUsage ?? { input: 0, output: 0 },
        sessionId,
      };
    } finally {
      try { await hm.invoke('agent.end', { sessionId }, {}); } catch { /* hook error must not mask original */ }
    }
  }

  async *stream(input: string, signal?: globalThis.AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    const context = await this.createContext(input);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    try {
      yield* this.orchestrator.streamLoop(context, {
        maxIterations: maxIter,
        signal,
        modelString: this.config.model,
        sessionId: context.request.sessionId,
      });
    } finally {
      try { await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {}); } catch { /* hook error must not mask original */ }
    }
  }

  async *streamEvents(input: string, signal?: globalThis.AbortSignal): AsyncGenerator<import('@agentforge/sdk').StreamEvent> {
    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    const context = await this.createContext(input);
    const hm = this._pluginManager.hookManager;

    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    try {
      yield* this.orchestrator.streamEvents(context, {
        maxIterations: maxIter,
        signal,
        modelString: this.config.model,
        sessionId: context.request.sessionId,
      });
    } finally {
      try { await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {}); } catch { /* hook error must not mask original */ }
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
    this.runner.register(createExecuteToolsProcessor(this.registry));
    this.runner.register(createEvaluateIterationProcessor({ eventBus: this._pluginManager.eventBus }));
    this.runner.register(processOutputProcessor);
  }
}
