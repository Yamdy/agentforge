import type {
  AbortSignal,
  AgentConfig,
  Dynamic,
  PipelineContext,
  PipelineStage,
  Processor,
  ResolveContext,
  Tool,
} from '@agentforge/sdk';
import { PipelineRunner } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { PluginManager, type PluginFactory } from './plugin-manager.js';
import { LLMInvoker } from './llm-invoker.js';
import { resolveModel } from './model-resolver.js';
import { echoTool } from '@agentforge/tools';
import { resolveDynamic } from './dynamic-resolver.js';

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

  async run(input: string, signal?: globalThis.AbortSignal): Promise<string> {
    if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

    const context = this.createContext(input);

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

    if (signal?.aborted) throw new DOMException('Agent run aborted', 'AbortError');

    // Post-loop stage
    result = await this.runner.run(ctx, POST_LOOP_STAGES);
    if (this.isAbort(result)) throw new Error(`Agent aborted: ${(result as AbortSignal).reason}`);

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
    if (!this._llm) {
      const model = await resolveModel(this.config.model);
      this._llm = new LLMInvoker({
        model,
        system: systemPrompt,
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
      execute: async (ctx) => {
        const resolveCtx: ResolveContext = {
          input: ctx.request.input,
          sessionId: ctx.request.sessionId,
          metadata: {},
        };
        const config = { ...ctx.agent.config };
        if (config.systemPrompt != null) {
          config.systemPrompt = await resolveDynamic<string>(config.systemPrompt as Dynamic<string>, resolveCtx);
        }
        if (config.maxIterations != null) {
          config.maxIterations = await resolveDynamic<number>(config.maxIterations as Dynamic<number>, resolveCtx);
        }
        return { ...ctx, agent: { ...ctx.agent, config } };
      },
    };

    const buildContext: Processor = {
      stage: 'buildContext',
      execute: async (ctx) => ({
        ...ctx,
        agent: {
          ...ctx.agent,
          systemPrompt: ctx.agent.config.systemPrompt as string | undefined,
          toolDeclarations: this.registry.getAll().map(t => ({
            name: t.name,
            description: t.description,
          })),
        },
      }),
    };

    const prepareStep: Processor = {
      stage: 'prepareStep',
      execute: async (ctx) => {
        // Filter message history: keep only recent messages to bound context size
        const maxHistory = 50;
        const history = ctx.session.messageHistory;
        const messageHistory = history && history.length > maxHistory
          ? history.slice(-maxHistory)
          : history;

        // Refresh tool declarations (plugins may have registered/removed tools)
        const toolDeclarations = this.registry.getAll().map(t => ({
          name: t.name,
          description: t.description,
        }));

        return {
          ...ctx,
          session: { ...ctx.session, messageHistory },
          agent: { ...ctx.agent, toolDeclarations },
        };
      },
    };

    const invokeLLM: Processor = {
      stage: 'invokeLLM',
      execute: async (ctx) => {
        const systemPrompt = typeof ctx.agent.config.systemPrompt === 'string'
          ? ctx.agent.config.systemPrompt : undefined;
        const llm = await this.getLLM(systemPrompt);
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
          maxSteps: typeof ctx.agent.config.maxIterations === 'number' ? ctx.agent.config.maxIterations : undefined,
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
      execute: async (ctx) => {
        // Detect token overflow: if usage exceeds threshold, signal compression
        const tokenUsage = ctx.iteration.tokenUsage;
        if (tokenUsage) {
          const totalTokens = (tokenUsage.input ?? 0) + (tokenUsage.output ?? 0);
          const overflowThreshold = 100_000;
          if (totalTokens > overflowThreshold) {
            ctx.iteration.span?.setAttribute('context.overflow', true);
            ctx.iteration.span?.setAttribute('context.tokens', totalTokens);
            return {
              ...ctx,
              iteration: {
                ...ctx.iteration,
                loopDirective: { action: 'stop' },
              },
            };
          }
        }
        return {
          ...ctx,
          iteration: { ...ctx.iteration, loopDirective: { action: 'stop' } },
        };
      },
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
