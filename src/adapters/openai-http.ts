/**
 * OpenAI HTTP Adapter - Direct HTTP calls without AI SDK
 *
 * Supports v1 model format (compatible with MiMo, DeepSeek, etc.)
 */

import type {
  LLMAdapter,
  LLMResponse,
  LLMOptions,
  Message,
  ToolDefinition,
  LLMChunk,
} from '../core/interfaces.js';
import type { Logger } from '../core/logger.js';
import { DefaultLogger } from '../core/logger.js';

export interface OpenAIHttpAdapterOptions {
  apiKey?: string;
  baseURL?: string;
  logger?: Logger;
}

/**
 * Convert ToolDefinition to OpenAI function format
 */
function toolToOpenAIFormat(tool: ToolDefinition) {
  // If parameters is a Zod schema, convert to JSON Schema
  let parameters: Record<string, unknown>;

  if (tool.parameters && typeof tool.parameters === 'object' && 'shape' in tool.parameters) {
    // Zod schema - convert to JSON Schema
    const shape = (tool.parameters as { shape: Record<string, unknown> }).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as {
        description?: string;
        _def?: { typeName?: string };
        isOptional?: () => boolean;
      };
      properties[key] = {
        type: 'string', // Simplified - would need proper Zod-to-JSON-Schema conversion
        description: field.description || '',
      };
      if (field.isOptional && !field.isOptional()) {
        required.push(key);
      }
    }

    parameters = {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  } else {
    // Already JSON Schema or other format
    parameters = (tool.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} };
  }

  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
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
  const logger = options.logger ?? new DefaultLogger('openai-http');

  // Store tools for use in chat calls
  const registeredTools: ToolDefinition[] = [];

  const adapter: LLMAdapter = {
    name: `openai-http-${modelName}`,
    provider: 'openai',

    async chat(messages: Message[], llmOptions?: LLMOptions): Promise<LLMResponse> {
      try {
        const body: Record<string, unknown> = {
          model: modelName,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content, // Pass directly — OpenAI API supports both strings and ContentPart[]
          })),
          max_tokens: (llmOptions?.maxTokens as number) ?? 1024, // Default max_tokens
        };

        // Add tools if provided (from llmOptions or registered tools)
        const tools = (llmOptions?.tools as ToolDefinition[]) ?? registeredTools;
        const hasTools = tools.length > 0;

        if (hasTools) {
          body.tools = tools.map(toolToOpenAIFormat);
          body.tool_choice = 'auto';
        }

        if (llmOptions?.temperature !== undefined) {
          body.temperature = llmOptions.temperature;
        }
        if (llmOptions?.maxTokens !== undefined) {
          body.max_tokens = llmOptions.maxTokens;
        }

        let response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        // If API returns error and we sent tools, retry without tools
        if (!response.ok && hasTools) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = (errorData as { error?: { message?: string } }).error?.message ?? '';

          // Only retry without tools if the error is about tools/params
          if (
            errorMsg.includes('Param') ||
            errorMsg.includes('tool') ||
            errorMsg.includes('function')
          ) {
            logger.warn("API doesn't support tools, retrying without tools");

            const bodyWithoutTools: Record<string, unknown> = {
              model: modelName,
              messages: body.messages,
              max_tokens: 1024, // MiMo requires max_tokens
            };

            response = await fetch(`${baseURL}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(bodyWithoutTools),
            });
          }
        }

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
        logger.error('Chat error', error instanceof Error ? error : undefined);
        return {
          content: '',
          finishReason: 'error',
        };
      }
    },

    async *stream(): AsyncGenerator<LLMChunk> {
      // HTTP adapter does not support streaming
    },
  };

  return adapter;
}
