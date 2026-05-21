import { streamText } from 'ai';
import type { LanguageModel } from 'ai';
import type { TokenUsage, Tracer } from '@primo-ai/sdk';
import { SpanType } from '@primo-ai/sdk';
import { streamWithRetry, type RetryOptions } from './retry.js';
import type { CircuitBreaker } from './circuit-breaker.js';

export interface LLMInvokerOptions {
  model: LanguageModel;
  system?: string;
  retryOptions?: RetryOptions;
  circuitBreaker?: CircuitBreaker;
  tracer?: Tracer;
  eventBus?: { emit: (type: string, data: unknown) => void };
}

export interface LLMInvokeInput {
  messages: unknown[];
  tools?: Record<string, unknown>;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface LLMInvokeResult {
  response: string;
  tokenUsage: TokenUsage | null;
}

export interface LLMStreamHandle {
  fullStream: AsyncIterable<unknown>;
  usage: Promise<TokenUsage | null>;
  reasoning: Promise<string | undefined>;
}

type UsageShape = { inputTokens?: number | { total?: number }; outputTokens?: number | { total?: number } } | null | undefined;

export function extractTokenUsage(usage: unknown): TokenUsage | null {
  const u = usage as UsageShape;
  if (!u) return null;
  const input = typeof u?.inputTokens === 'number'
    ? u.inputTokens
    : u?.inputTokens?.total ?? 0;
  const output = typeof u?.outputTokens === 'number'
    ? u.outputTokens
    : u?.outputTokens?.total ?? 0;
  return { input, output };
}

export class LLMInvoker {
  private options: LLMInvokerOptions;

  constructor(options: LLMInvokerOptions) {
    this.options = options;
  }

  async invoke(input: LLMInvokeInput): Promise<LLMInvokeResult> {
    const span = this.options.tracer?.startSpan(SpanType.MODEL_STEP);
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

        span?.setAttribute('llm.model', (this.options.model as unknown as { modelId: string }).modelId ?? 'unknown');

        const result = streamText(streamOpts as unknown as Parameters<typeof streamText>[0]);

        const chunks: string[] = [];
        let usage: unknown = null;

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
          try { usage = await result.usage; } catch (err) {
            this.options.eventBus?.emit('llm:usage_unavailable', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        return {
          response: chunks.join(''),
          tokenUsage: extractTokenUsage(usage),
        };
      }, this.options.retryOptions ?? { maxRetries: 3, baseDelay: 1000 }, this.options.circuitBreaker);
    } finally {
      span?.end();
    }
  }

  stream(input: LLMInvokeInput): LLMStreamHandle {
    const span = this.options.tracer?.startSpan(SpanType.LLM_STREAM);

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

    span?.setAttribute('llm.model', (this.options.model as unknown as { modelId: string }).modelId ?? 'unknown');

    // Retry only the initial streamText() call (connection phase).
    // Subsequent stream iteration errors are not retried here.
    const maxRetries = this.options.retryOptions?.maxRetries ?? 3;
    let result: ReturnType<typeof streamText>;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        result = streamText(streamOpts as unknown as Parameters<typeof streamText>[0]);
        break;
      } catch (error) {
        if (attempt >= maxRetries) {
          span?.end();
          throw error;
        }
      }
    }

    // Suppress AI_NoOutputGeneratedError: when the model returns only tool-calls
    // (no text), the AI SDK's internal flush rejects. Since we consume fullStream
    // directly to extract tool-call events, this error is expected and harmless.
    Promise.resolve(result!.text).catch(() => {});

    // End the span when usage resolves (i.e. after the stream finishes),
    // matching the lifecycle span pattern used in invoke().
    const endSpan = (): void => { span?.end(); };

    return {
      fullStream: result!.fullStream,
      usage: Promise.resolve(result!.usage)
        .then((u) => { endSpan(); return extractTokenUsage(u); })
        .catch((err) => {
          endSpan();
          this.options.eventBus?.emit('llm:usage_unavailable', { error: err instanceof Error ? err.message : String(err) });
          return null;
        }),
      reasoning: Promise.resolve(result!.reasoningText).catch((err) => {
        this.options.eventBus?.emit('llm:reasoning_error', { error: err instanceof Error ? err.message : String(err) });
        return undefined;
      }),
    };
  }
}
