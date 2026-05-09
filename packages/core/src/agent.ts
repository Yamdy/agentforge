import type { AgentConfig, PipelineContext, Processor } from '@agentforge/sdk';
import { PipelineRunner } from './pipeline.js';

export interface LLMProvider {
  generate(messages: Array<{ role: string; content: string }>): Promise<string>;
}

export class Agent {
  private config: AgentConfig;
  private provider: LLMProvider;
  private runner: PipelineRunner;

  constructor(config: AgentConfig, provider: LLMProvider) {
    this.config = config;
    this.provider = provider;
    this.runner = new PipelineRunner();
    this.registerBuiltinProcessors();
  }

  async run(input: string): Promise<string> {
    const context: PipelineContext = {
      request: { input, sessionId: crypto.randomUUID() },
      iteration: { step: 0 },
      pipeline: {},
      session: {},
      config: { ...this.config },
    };

    const stages = ['processInput', 'invokeLLM', 'processOutput'] as const;
    const result = await this.runner.run(context, [...stages]);

    if ('type' in result && result.type === 'abort') {
      throw new Error(`Agent aborted: ${result.reason}`);
    }

    return (result as PipelineContext).pipeline.response as string ?? '';
  }

  private registerBuiltinProcessors(): void {
    const processInput: Processor = {
      stage: 'processInput',
      execute: async (ctx) => ctx,
    };

    const invokeLLM: Processor = {
      stage: 'invokeLLM',
      execute: async (ctx) => {
        const messages: Array<{ role: string; content: string }> = [];
        if (this.config.systemPrompt) {
          messages.push({ role: 'system', content: this.config.systemPrompt });
        }
        messages.push({ role: 'user', content: ctx.request.input });
        const response = await this.provider.generate(messages);
        return { ...ctx, pipeline: { ...ctx.pipeline, response } };
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
