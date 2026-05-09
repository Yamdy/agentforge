import type { AgentConfig, PipelineContext, Processor, Tool } from '@agentforge/sdk';
import { PipelineRunner } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { LLMInvoker } from './llm-invoker.js';
import { resolveModel } from './model-resolver.js';
import { echoTool } from '@agentforge/tools';

export class Agent {
  private config: AgentConfig;
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private _llm: LLMInvoker | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.runner = new PipelineRunner();
    this.registry = new ToolRegistry();
    this.registerTools();
    this.registerBuiltinProcessors();
  }

  async run(input: string): Promise<string> {
    const context = this.createContext(input);
    const stages = ['processInput', 'invokeLLM', 'processOutput'] as const;
    const result = await this.runner.run(context, [...stages]);

    if ('type' in result && result.type === 'abort') {
      throw new Error(`Agent aborted: ${result.reason}`);
    }

    return (result as PipelineContext).pipeline.response as string ?? '';
  }

  async *stream(input: string): AsyncGenerator<string> {
    const context = this.createContext(input);
    const stages = ['processInput', 'invokeLLM', 'processOutput'] as const;

    for await (const event of this.runner.stream(context, [...stages])) {
      if (event.type === 'text_delta') {
        yield event.text;
      }
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
      iteration: { step: 0 },
      pipeline: {},
      session: {},
      config: { ...this.config },
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
        });

        const handle = llm.stream({
          prompt: ctx.request.input,
          tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
          maxSteps: this.config.maxIterations,
        });

        return {
          ...ctx,
          pipeline: {
            ...ctx.pipeline,
            textStream: handle.textStream,
            usagePromise: handle.usage,
          },
        };
      },
    };

    const processOutput: Processor = {
      stage: 'processOutput',
      execute: async (ctx) => ctx,
    };

    this.runner.register(processInput);
    this.runner.register(invokeLLM);
    this.runner.register(processOutput);
  }
}
