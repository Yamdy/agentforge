import { streamText } from 'ai';
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
  messages: unknown[];
  tools?: Record<string, unknown>;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface LLMInvokeResult {
  response: string;
  tokenUsage: TokenUsage;
}

export interface LLMStreamHandle {
  fullStream: AsyncIterable<unknown>;
  usage: Promise<TokenUsage>;
  reasoning: Promise<string | undefined>;
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
    const span = this.options.tracer?.startSpan('llm.invoke');
    try {
      return await streamWithRetry(async () => {
        const streamOpts: Record<string, unknown> = {
          model: this.options.model,
          system: this.options.system,
          messages: input.messages,
          maxRetries: 0,
        };

        if (input.tools && Object.keys(input.tools).length > 0) {
          streamOpts.tools = input.tools;
        }
        if (input.providerOptions) {
          streamOpts.providerOptions = input.providerOptions;
        }

        span?.setAttribute('llm.model', (this.options.model as any).modelId ?? 'unknown');

        const result = streamText(streamOpts as any);

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

        if (!usage) {
          try { usage = await result.usage; } catch { /* usage unavailable */ }
        }

        return {
          response: chunks.join(''),
          tokenUsage: extractTokenUsage(usage),
        };
      }, this.options.retryOptions ?? { maxRetries: 3, baseDelay: 1000 });
    } finally {
      span?.end();
    }
  }

  stream(input: LLMInvokeInput): LLMStreamHandle {
    const streamOpts: Record<string, unknown> = {
      model: this.options.model,
      system: this.options.system,
      messages: input.messages,
      maxRetries: 0,
    };

    if (input.tools && Object.keys(input.tools).length > 0) {
      streamOpts.tools = input.tools;
    }
    if (input.providerOptions) {
      streamOpts.providerOptions = input.providerOptions;
    }

    const result = streamText(streamOpts as any);

    // Suppress AI_NoOutputGeneratedError: when the model returns only tool-calls
    // (no text), the AI SDK's internal flush rejects. Since we consume fullStream
    // directly to extract tool-call events, this error is expected and harmless.
    Promise.resolve(result.text).catch(() => {});

    return {
      fullStream: result.fullStream,
      usage: Promise.resolve(result.usage)
        .then(extractTokenUsage)
        .catch(() => ({ input: 0, output: 0 })),
      reasoning: Promise.resolve(result.reasoningText).catch(() => undefined),
    };
  }
}
