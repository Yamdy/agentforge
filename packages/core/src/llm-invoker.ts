import { streamText, stepCountIs } from 'ai';
import type { LanguageModel } from 'ai';
import type { TokenUsage, Tracer } from '@agentforge/sdk';
import { streamWithRetry, type RetryOptions } from './retry.js';

export interface LLMInvokerOptions {
  model: LanguageModel;
  system?: string;
  retryOptions?: RetryOptions;
  tracer?: Tracer;
}

export interface LLMInvokeInput {
  prompt: string;
  tools?: Record<string, unknown>;
  maxSteps?: number;
}

export interface LLMInvokeResult {
  response: string;
  tokenUsage: TokenUsage;
}

export interface LLMStreamHandle {
  textStream: AsyncIterable<string>;
  usage: Promise<TokenUsage>;
}

function extractTokenUsage(usage: any): TokenUsage {
  return {
    input: typeof usage?.inputTokens === 'number'
      ? usage.inputTokens
      : (usage?.inputTokens as any)?.total ?? 0,
    output: typeof usage?.outputTokens === 'number'
      ? usage.outputTokens
      : (usage?.outputTokens as any)?.total ?? 0,
  };
}

export class LLMInvoker {
  private options: LLMInvokerOptions;

  constructor(options: LLMInvokerOptions) {
    this.options = options;
  }

  async invoke(input: LLMInvokeInput): Promise<LLMInvokeResult> {
    return streamWithRetry(async () => {
      const streamOpts: Record<string, unknown> = {
        model: this.options.model,
        system: this.options.system,
        prompt: input.prompt,
        maxRetries: 0,
      };

      if (input.tools && Object.keys(input.tools).length > 0) {
        streamOpts.tools = input.tools;
        streamOpts.stopWhen = stepCountIs(input.maxSteps ?? 5);
      }

      const result = streamText(streamOpts as any);

      // Use fullStream to detect error events carrying the original error
      // (with statusCode). The textStream silently swallows doStream errors.
      const chunks: string[] = [];
      let usage: any = null;

      for await (const event of result.fullStream) {
        switch (event.type) {
          case 'text-delta':
            chunks.push(event.text);
            break;
          case 'error':
            throw event.error;
          case 'finish-step':
            usage = event.usage;
            break;
        }
      }

      // Fallback: if no usage from finish event, try result.usage
      if (!usage) {
        try { usage = await result.usage; } catch { /* usage unavailable */ }
      }

      return {
        response: chunks.join(''),
        tokenUsage: extractTokenUsage(usage),
      };
    }, this.options.retryOptions ?? { maxRetries: 3, baseDelay: 1000 });
  }

  stream(input: LLMInvokeInput): LLMStreamHandle {
    const streamOpts: Record<string, unknown> = {
      model: this.options.model,
      system: this.options.system,
      prompt: input.prompt,
      maxRetries: 0,
    };

    if (input.tools && Object.keys(input.tools).length > 0) {
      streamOpts.tools = input.tools;
      streamOpts.stopWhen = stepCountIs(input.maxSteps ?? 5);
    }

    const result = streamText(streamOpts as any);

    return {
      textStream: result.textStream,
      usage: Promise.resolve(result.usage).then(extractTokenUsage),
    };
  }
}
