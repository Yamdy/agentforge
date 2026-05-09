import { streamText, stepCountIs } from 'ai';
import type { AgentConfig, PipelineContext, Processor, Tool } from '@agentforge/sdk';
import { PipelineRunner } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { resolveModel } from './model-resolver.js';
import { streamWithRetry } from './retry.js';

export class Agent {
  private config: AgentConfig;
  private runner: PipelineRunner;
  private registry: ToolRegistry;

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
    const model = await resolveModel(this.config.model);

    const result = streamText({
      model,
      system: this.config.systemPrompt,
      prompt: input,
    });

    for await (const chunk of result.textStream) {
      yield chunk;
    }
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
        const model = await resolveModel(this.config.model);

        return streamWithRetry(async () => {
          const streamOpts: Record<string, unknown> = {
            model,
            system: this.config.systemPrompt,
            prompt: ctx.request.input,
          };

          const sdkTools = this.registry.toAiSdkTools();
          if (Object.keys(sdkTools).length > 0) {
            streamOpts.tools = sdkTools;
            streamOpts.stopWhen = stepCountIs(this.config.maxIterations ?? 5);
          }

          const result = streamText(streamOpts as any);

          const chunks: string[] = [];
          for await (const chunk of result.textStream) {
            chunks.push(chunk);
          }

          const response = chunks.join('');
          const usage = await result.usage;

          return {
            ...ctx,
            pipeline: {
              ...ctx.pipeline,
              response,
              tokenUsage: {
                input: typeof usage?.inputTokens === 'number'
                  ? usage.inputTokens
                  : (usage?.inputTokens as any)?.total ?? 0,
                output: typeof usage?.outputTokens === 'number'
                  ? usage.outputTokens
                  : (usage?.outputTokens as any)?.total ?? 0,
              },
            },
          };
        }, { maxRetries: 3, baseDelay: 1000 });
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
