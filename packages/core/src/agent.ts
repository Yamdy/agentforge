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
import { echoTool } from '@agentforge/tools';

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
  private _llm: LLMInvoker | null = null;

  constructor(config: AgentConfig, options?: { tracer?: import('@agentforge/sdk').Tracer }) {
    this.config = config;
    this.runner = new PipelineRunner({ tracer: options?.tracer });
    this.registry = new ToolRegistry();
    this._pluginManager = new PluginManager(this.runner, this.registry);
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

  async run(input: string): Promise<string> {
    const context = this.createContext(input);
    const maxIter = this.config.maxIterations ?? 10;

    // Pre-loop stages
    let result = await this.runner.run(context, PRE_LOOP_STAGES);
    if (this.isAbort(result)) throw new Error(`Agent aborted: ${(result as AbortSignal).reason}`);

    // Agentic loop
    let ctx = result as PipelineContext;
    for (let i = 0; i < maxIter; i++) {
      const prevDirective = ctx.iteration.loopDirective;
      ctx = { ...ctx, iteration: { ...ctx.iteration, step: i, loopDirective: undefined } };

      // Determine start stage (support retry from a specific stage)
      const retryFrom = prevDirective?.action === 'retry' ? prevDirective.retryFrom : undefined;
      const stages = retryFrom ? LOOP_STAGES.slice(LOOP_STAGES.indexOf(retryFrom)) : LOOP_STAGES;

      result = await this.runner.run(ctx, stages);
      if (this.isAbort(result)) {
        const abort = result as AbortSignal;
        if (abort.retryFrom) {
          ctx = { ...ctx, iteration: { ...ctx.iteration, loopDirective: { action: 'retry', retryFrom: abort.retryFrom } } };
          continue;
        }
        throw new Error(`Agent aborted: ${abort.reason}`);
      }
      ctx = result as PipelineContext;
      if (ctx.iteration.loopDirective?.action === 'stop') break;
    }

    // Post-loop stage
    result = await this.runner.run(ctx, POST_LOOP_STAGES);
    if (this.isAbort(result)) throw new Error(`Agent aborted: ${(result as AbortSignal).reason}`);

    return (result as PipelineContext).iteration.response as string ?? '';
  }

  async *stream(input: string): AsyncGenerator<string> {
    const context = this.createContext(input);
    const maxIter = this.config.maxIterations ?? 10;

    let ctx = context;
    for await (const event of this.runner.stream(ctx, PRE_LOOP_STAGES)) {
      if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignal).reason}`);
      if (event.type === 'text_delta') yield event.text;
      if (event.type === 'complete') ctx = (event as { context: PipelineContext }).context;
    }

    for (let i = 0; i < maxIter; i++) {
      ctx = { ...ctx, iteration: { ...ctx.iteration, step: i, loopDirective: undefined } };
      for await (const event of this.runner.stream(ctx, LOOP_STAGES)) {
        if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignal).reason}`);
        if (event.type === 'text_delta') yield event.text;
        if (event.type === 'complete') ctx = (event as { context: PipelineContext }).context;
      }
      if (ctx.iteration.loopDirective?.action === 'stop') break;
    }

    for await (const event of this.runner.stream(ctx, POST_LOOP_STAGES)) {
      if (event.type === 'abort') throw new Error(`Agent aborted: ${(event as AbortSignal).reason}`);
      if (event.type === 'text_delta') yield event.text;
    }
  }

  private async getLLM(): Promise<LLMInvoker> {
    if (!this._llm) {
      const model = await resolveModel(this.config.model);
      this._llm = new LLMInvoker({
        model,
        system: this.config.systemPrompt,
        retryOptions: { maxRetries: 3, baseDelay: 1000 },
      });
    }
    return this._llm;
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
    const processInput: Processor = {
      stage: 'processInput',
      execute: async (ctx) => ctx,
    };

    const buildContext: Processor = {
      stage: 'buildContext',
      execute: async (ctx) => ({
        ...ctx,
        agent: {
          ...ctx.agent,
          systemPrompt: this.config.systemPrompt,
          toolDeclarations: this.registry.getAll().map(t => ({
            name: t.name,
            description: t.description,
          })),
        },
      }),
    };

    const prepareStep: Processor = {
      stage: 'prepareStep',
      execute: async (ctx) => ctx,
    };

    const invokeLLM: Processor = {
      stage: 'invokeLLM',
      execute: async (ctx) => {
        const llm = await this.getLLM();
        const sdkTools = this.registry.toAiSdkTools();

        this.registry.setToolExecutionContext({
          span: {
            spanId: `tool-${ctx.request.sessionId}-${ctx.iteration.step}`,
            traceId: ctx.request.sessionId,
          },
          sessionId: ctx.request.sessionId,
          pluginManager: this._pluginManager,
        });

        const handle = llm.stream({
          prompt: ctx.request.input,
          tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
          maxSteps: this.config.maxIterations,
        });

        return {
          ...ctx,
          iteration: {
            ...ctx.iteration,
            textStream: handle.textStream,
            usagePromise: handle.usage,
          },
        };
      },
    };

    const processStepOutput: Processor = {
      stage: 'processStepOutput',
      execute: async (ctx) => ctx,
    };

    const executeTools: Processor = {
      stage: 'executeTools',
      execute: async (ctx) => ctx,
    };

    const evaluateIteration: Processor = {
      stage: 'evaluateIteration',
      execute: async (ctx) => ({
        ...ctx,
        iteration: { ...ctx.iteration, loopDirective: { action: 'stop' } },
      }),
    };

    const processOutput: Processor = {
      stage: 'processOutput',
      execute: async (ctx) => ctx,
    };

    this.runner.register(processInput);
    this.runner.register(buildContext);
    this.runner.register(prepareStep);
    this.runner.register(invokeLLM);
    this.runner.register(processStepOutput);
    this.runner.register(executeTools);
    this.runner.register(evaluateIteration);
    this.runner.register(processOutput);
  }

  private isAbort(result: PipelineContext | AbortSignal): result is AbortSignal {
    return 'type' in result && result.type === 'abort';
  }
}
