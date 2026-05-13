import type {
  AbortSignal,
  AgentConfig,
  PipelineContext,
  PipelineStage,
  Processor,
  Tool,
} from '@agentforge/sdk';
import { PipelineRunner } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { PluginManager, type PluginFactory } from './plugin-manager.js';
import { LLMInvoker } from './llm-invoker.js';
import { resolveModel } from './model-resolver.js';
import { applyReactiveRules } from './processors/provider-history-compat.js';
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

const PRE_LOOP_STAGES: PipelineStage[] = ['processInput', 'buildContext'];
const LOOP_STAGES: PipelineStage[] = [
  'prepareStep', 'invokeLLM', 'processStepOutput', 'executeTools', 'evaluateIteration',
];
const POST_LOOP_STAGES: PipelineStage[] = ['processOutput'];

export class Agent {
  private config: AgentConfig;
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private _pluginManager: PluginManager;
  private _model: import('ai').LanguageModel | null = null;

  constructor(config: AgentConfig, options?: { tracer?: import('@agentforge/sdk').Tracer }) {
    this.config = config;
    this.runner = new PipelineRunner({ tracer: options?.tracer });
    this.registry = new ToolRegistry();
    this._pluginManager = new PluginManager(this.runner, this.registry);
    this.runner.setHookManager(this._pluginManager.hookManager);
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

  async run(input: string, signal?: globalThis.AbortSignal): Promise<string> {
    if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

    const context = this.createContext(input);
    const hm = this._pluginManager.hookManager;

    // agent.start hook
    await hm.invoke('agent.start', { sessionId: context.request.sessionId, request: context.request, agentConfig: this.config }, {});

    // Pre-loop stages
    let result = await this.runner.run(context, PRE_LOOP_STAGES);
    if (this.isAbort(result)) throw new Error(`Agent aborted: ${(result as AbortSignal).reason}`);

    // Agentic loop
    let ctx = result as PipelineContext;
    const maxIter = typeof ctx.agent.config.maxIterations === 'number' ? ctx.agent.config.maxIterations : 10;
    for (let i = 0; i < maxIter; i++) {
      if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

      const { ctx: loopCtx, stages } = this.computeLoopStages(ctx, i);
      ctx = loopCtx;

      try {
        result = await this.runner.run(ctx, stages);
      } catch (error) {
        await hm.invoke('error', { error, stage: 'invokeLLM' as PipelineStage, sessionId: ctx.request.sessionId }, {});
        const fixed = applyReactiveRules(
          ctx.session.messageHistory ?? [],
          ctx.agent.config.model,
          error,
        );
        if (fixed) {
          ctx = { ...ctx, session: { ...ctx.session, messageHistory: fixed } };
          continue;
        }
        throw error;
      }
      if (this.isAbort(result)) {
        const abort = result as AbortSignal;
        if (abort.retryFrom) {
          ctx = { ...ctx, iteration: { ...ctx.iteration, loopDirective: { action: 'retry', retryFrom: abort.retryFrom } } };
          continue;
        }
        throw new Error(`Agent aborted: ${abort.reason}`);
      }
      ctx = result as PipelineContext;

      // iteration.end hook
      await hm.invoke('iteration.end', { step: ctx.iteration.step, sessionId: ctx.request.sessionId }, {});

      if (ctx.iteration.loopDirective?.action === 'stop') break;
    }

    if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

    // Post-loop stage
    result = await this.runner.run(ctx, POST_LOOP_STAGES);
    if (this.isAbort(result)) throw new Error(`Agent aborted: ${(result as AbortSignal).reason}`);

    // agent.end hook
    await hm.invoke('agent.end', { sessionId: context.request.sessionId }, {});

    return (result as PipelineContext).iteration.response as string ?? '';
  }

  async *stream(input: string, signal?: globalThis.AbortSignal): AsyncGenerator<string> {
    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    const context = this.createContext(input);

    let ctx = context;
    for await (const event of this.runner.stream(ctx, PRE_LOOP_STAGES)) {
      if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');
      if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignal).reason}`);
      if (event.type === 'text_delta') yield event.text;
      if (event.type === 'complete') ctx = (event as { context: PipelineContext }).context;
    }

    const maxIter = typeof ctx.agent.config.maxIterations === 'number' ? ctx.agent.config.maxIterations : 10;
    for (let i = 0; i < maxIter; i++) {
      if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

      const { ctx: loopCtx, stages } = this.computeLoopStages(ctx, i);
      ctx = loopCtx;

      let loopBreak = false;
      let compatRetry = false;
      try {
        for await (const event of this.runner.stream(ctx, stages)) {
          if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');
          if (event.type === 'abort') {
            const abortEvent = event as { type: 'abort'; reason: string; retryFrom?: PipelineStage };
            if (abortEvent.retryFrom) {
              ctx = { ...ctx, iteration: { ...ctx.iteration, loopDirective: { action: 'retry', retryFrom: abortEvent.retryFrom } } };
              loopBreak = true;
              break;
            }
            throw new Error(`Agent aborted: ${abortEvent.reason}`);
          }
          if (event.type === 'text_delta') yield event.text;
          if (event.type === 'complete') ctx = (event as { context: PipelineContext }).context;
        }
      } catch (error) {
        const fixed = applyReactiveRules(
          ctx.session.messageHistory ?? [],
          ctx.agent.config.model,
          error,
        );
        if (fixed) {
          ctx = { ...ctx, session: { ...ctx.session, messageHistory: fixed } };
          compatRetry = true;
        } else {
          throw error;
        }
      }
      if (compatRetry) continue;
      if (loopBreak) continue;
      if (ctx.iteration.loopDirective?.action === 'stop') break;
    }

    if (signal?.aborted) throw new DOMException('Agent stream aborted', 'AbortError');

    for await (const event of this.runner.stream(ctx, POST_LOOP_STAGES)) {
      if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignal).reason}`);
      if (event.type === 'text_delta') yield event.text;
    }
  }

  private async getLLM(systemPrompt?: string): Promise<LLMInvoker> {
    if (!this._model) {
      this._model = await resolveModel(this.config.model);
    }
    return new LLMInvoker({
      model: this._model,
      system: systemPrompt,
      retryOptions: { maxRetries: 3, baseDelay: 1000 },
    });
  }

  private createContext(input: string): PipelineContext {
    return {
      request: { input, sessionId: crypto.randomUUID() },
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
    this.runner.register(createPrepareStepProcessor(this.registry));
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

  private computeLoopStages(
    ctx: PipelineContext,
    step: number,
  ): { ctx: PipelineContext; stages: PipelineStage[] } {
    const prevDirective = ctx.iteration.loopDirective;
    const newCtx = { ...ctx, iteration: { ...ctx.iteration, step, loopDirective: undefined } };
    const retryFrom = prevDirective?.action === 'retry' ? prevDirective.retryFrom : undefined;
    const stages = retryFrom ? LOOP_STAGES.slice(LOOP_STAGES.indexOf(retryFrom)) : LOOP_STAGES;
    return { ctx: newCtx, stages };
  }

  private isAbort(result: PipelineContext | AbortSignal): result is AbortSignal {
    return 'type' in result && result.type === 'abort';
  }
}
