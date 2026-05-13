import type {
  AgentConfig,
  PipelineContext,
  Processor,
  SessionManager,
  Tool,
  Tracer,
} from '@agentforge/sdk';
import { PipelineRunner } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { PluginManager, type PluginFactory } from './plugin-manager.js';
import { LLMInvoker } from './llm-invoker.js';
import { ModelFactory } from './model-factory.js';
import { BuiltInGateway } from './gateways/builtin-gateway.js';
import { LoopOrchestrator } from './loop-orchestrator.js';
import { echoTool } from '@agentforge/tools';
import {
  processInputProcessor,
  createBuildContextProcessor,
  createPrepareStepProcessor,
  createInvokeLLMProcessor,
  processStepOutputProcessor,
  createExecuteToolsProcessor,
  evaluateIterationProcessor,
  processOutputProcessor,
} from './processors/index.js';

export interface AgentDependencies {
  runner?: PipelineRunner;
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  tracer?: Tracer;
  modelFactory?: ModelFactory;
  sessionManager?: SessionManager;
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
  private _model: import('ai').LanguageModel | null = null;
  private modelFactory: ModelFactory;
  private orchestrator: LoopOrchestrator;
  private sessionManager?: SessionManager;

  constructor(config: AgentConfig, deps?: AgentDependencies) {
    this.config = config;
    this.modelFactory = deps?.modelFactory ?? new ModelFactory();
    this.modelFactory.registerGateway(new BuiltInGateway());
    this.runner = deps?.runner ?? new PipelineRunner({ tracer: deps?.tracer });
    this.registry = deps?.registry ?? new ToolRegistry();
    this._pluginManager = deps?.pluginManager ?? new PluginManager(this.runner, this.registry);
    this.runner.setHookManager(this._pluginManager.hookManager);
    this.orchestrator = new LoopOrchestrator(this.runner, this._pluginManager.hookManager);
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

  get state(): import('./state-machine.js').AgentState {
    return this.orchestrator.state;
  }

  async run(input: string, signal?: globalThis.AbortSignal): Promise<AgentRunResult> {
    if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

    const context = await this.createContext(input);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    const finalCtx = await this.orchestrator.runLoop(context, {
      maxIterations: maxIter,
      signal,
      modelString: this.config.model,
      sessionId: context.request.sessionId,
    });

    // agent.end hook
    await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {});

    return {
      response: finalCtx.iteration.response as string ?? '',
      tokenUsage: finalCtx.session.totalTokenUsage ?? { input: 0, output: 0 },
      sessionId: context.request.sessionId,
    };
  }

  async resume(sessionId: string, signal?: globalThis.AbortSignal): Promise<AgentRunResult> {
    if (signal?.aborted) throw new DOMException('Agent resume aborted', 'AbortError');

    const hm = this._pluginManager.hookManager;
    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;

    const finalCtx = await this.orchestrator.resumeLoop(sessionId, {
      maxIterations: maxIter,
      signal,
      modelString: this.config.model,
      sessionId,
    });

    // agent.end hook
    await hm.invoke('agent.end', { sessionId }, {});

    return {
      response: finalCtx.iteration.response as string ?? '',
      tokenUsage: finalCtx.session.totalTokenUsage ?? { input: 0, output: 0 },
      sessionId,
    };
  }

  async *stream(input: string, signal?: globalThis.AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    const context = await this.createContext(input);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    const maxIter = typeof this.config.maxIterations === 'number' ? this.config.maxIterations : 10;
    yield* this.orchestrator.streamLoop(context, {
      maxIterations: maxIter,
      signal,
      modelString: this.config.model,
      sessionId: context.request.sessionId,
    });

    // agent.end hook
    await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {});
  }

  private async getLLM(systemPrompt?: string): Promise<LLMInvoker> {
    if (!this._model) {
      this._model = await this.modelFactory.resolve(this.config.model);
    }
    return new LLMInvoker({
      model: this._model,
      system: systemPrompt,
      retryOptions: { maxRetries: 3, baseDelay: 1000 },
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
    this.runner.register(createBuildContextProcessor(this.registry));
    this.runner.register(createPrepareStepProcessor());
    this.runner.register(createInvokeLLMProcessor({
      getLLM: (systemPrompt) => this.getLLM(systemPrompt),
      registry: this.registry,
      hookManager: this._pluginManager.hookManager,
      modelString: this.config.model,
    }));
    this.runner.register(processStepOutputProcessor);
    this.runner.register(createExecuteToolsProcessor(this.registry));
    this.runner.register(evaluateIterationProcessor);
    this.runner.register(processOutputProcessor);
  }
}
