/**
 * OpenAI HTTP Adapter - Direct HTTP calls without AI SDK
 *
 * Supports v1 model format (compatible with MiMo, DeepSeek, etc.)
 */

import type { LLMAdapter, LLMResponse, LLMOptions, Message } from '../core/interfaces.js';
import type { Observable } from 'rxjs';
import { EMPTY } from 'rxjs';

export interface OpenAIHttpAdapterOptions {
  apiKey?: string;
  baseURL?: string;
}

/**
 * Create OpenAI-compatible HTTP adapter (supports v1 model format)
 */
export function createOpenAIHttpAdapter(
  modelName: string,
  options: OpenAIHttpAdapterOptions
): LLMAdapter {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  const baseURL = options.baseURL ?? 'https://api.openai.com/v1';

  return {
    name: `openai-http-${modelName}`,
    provider: 'openai',

    async chat(messages: Message[], llmOptions?: LLMOptions): Promise<LLMResponse> {
      try {
        const body: Record<string, unknown> = {
          model: modelName,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        };

        if (llmOptions?.temperature !== undefined) {
          body.temperature = llmOptions.temperature;
        }
        if (llmOptions?.maxTokens !== undefined) {
          body.max_tokens = llmOptions.maxTokens;
        }

        const response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage =
            (errorData as { error?: { message?: string } }).error?.message ?? response.statusText;
          throw new Error(`API error ${response.status}: ${errorMessage}`);
        }

        const data = (await response.json()) as {
          choices: Array<{
            message: {
              content: string;
              tool_calls?: Array<{
                id: string;
                function: { name: string; arguments: string };
              }>;
            };
            finish_reason: string;
          }>;
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
          };
        };

        const choice = data.choices[0];
        if (!choice) {
          throw new Error('No choices in response');
        }

        const result: LLMResponse = {
          content: choice.message.content ?? '',
          finishReason:
            choice.finish_reason === 'stop'
              ? 'stop'
              : choice.finish_reason === 'tool_calls'
                ? 'tool_calls'
                : 'stop',
        };

        if (choice.message.tool_calls) {
          result.toolCalls = choice.message.tool_calls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          }));
        }

        if (data.usage) {
          result.usage = {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          };
        }

        return result;
      } catch (error) {
        console.error('[OpenAI HTTP Adapter] Chat error:', error);
        return {
          content: '',
          finishReason: 'error',
        };
      }
    },

    stream(): Observable<never> {
      // Streaming not implemented for HTTP adapter
      return EMPTY;
    },
  };
}
