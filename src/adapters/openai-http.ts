/**
 * OpenAI HTTP Adapter — uses @ai-sdk/openai-compatible
 *
 * Supports any v1-compatible API (MiMo, DeepSeek, Groq, etc.)
 * with full AI SDK integration: streaming, tool calling, type safety.
 */

import { generateText, streamText, jsonSchema } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { JSONSchema7 } from 'json-schema';
import type {
  LLMAdapter,
  LLMResponse,
  LLMOptions,
  Message,
  LLMChunk,
  FunctionDefinition,
  ToolChoice,
} from '../core/interfaces.js';
import type { ToolCall } from '../core/events.js';
import { extractText } from '../core/content-utils.js';

export interface OpenAIHttpAdapterOptions {
  apiKey?: string;
  baseURL?: string;
}

// ============================================================
// Message Conversion (same pattern as OpenAIAdapter)
// ============================================================

function convertMessages(messages: Message[]): Array<{
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
        | { type: 'tool-result'; toolCallId: string; toolName: string; output: string }
      >;
}> {
  const result: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content:
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
          | { type: 'tool-result'; toolCallId: string; toolName: string; output: string }
        >;
  }> = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: msg.toolCallId ?? '',
            toolName: msg.name ?? '',
            output: extractText(msg.content),
          },
        ],
      });
    } else {
      result.push({
        role: msg.role,
        content: msg.content as
          | string
          | Array<
              | { type: 'text'; text: string }
              | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
            >,
      });
    }
  }

  return result;
}

// ============================================================
// Adapter Factory
// ============================================================

/**
 * Create OpenAI-compatible HTTP adapter using AI SDK
 *
 * Supports any v1-compatible API (DeepSeek, MiMo, Groq, Together, etc.)
 * with full streaming and tool calling support via @ai-sdk/openai-compatible.
 */
export function createOpenAIHttpAdapter(
  modelName: string,
  options: OpenAIHttpAdapterOptions
): LLMAdapter {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  const baseURL = options.baseURL ?? 'https://api.openai.com/v1';

  const aiProvider = createOpenAICompatible({
    name: 'openai-http',
    apiKey,
    baseURL,
  });
  const aiModel = aiProvider(modelName);

  return {
    name: `openai-http-${modelName}`,
    provider: 'openai',

    async chat(messages: Message[], llmOptions?: LLMOptions): Promise<LLMResponse> {
      const config: Record<string, unknown> = {
        model: aiModel,
        messages: convertMessages(messages),
      };

      if (llmOptions?.temperature !== undefined) {
        config.temperature = llmOptions.temperature;
      }
      if (llmOptions?.maxTokens !== undefined) {
        config.maxTokens = llmOptions.maxTokens;
      } else {
        config.maxTokens = 1024; // Default for v1 models
      }
      if (llmOptions?.topP !== undefined) {
        config.topP = llmOptions.topP;
      }
      if (llmOptions?.stopSequences && llmOptions.stopSequences.length > 0) {
        config.stopSequences = llmOptions.stopSequences;
      }

      const tools = llmOptions?.tools as FunctionDefinition[] | undefined;
      if (tools && tools.length > 0) {
        const toolsRecord: Record<
          string,
          { description: string; parameters: ReturnType<typeof jsonSchema> }
        > = {};
        for (const tool of tools) {
          toolsRecord[tool.name] = {
            description: tool.description,
            parameters: jsonSchema(tool.parameters as JSONSchema7),
          };
        }
        config.tools = toolsRecord;

        if (llmOptions?.toolChoice) {
          const choice = llmOptions.toolChoice as ToolChoice;
          if (typeof choice === 'string') {
            config.toolChoice = choice;
          } else {
            config.toolChoice = { type: 'tool', toolName: choice.name };
          }
        }
      }

      const result = await generateText(config as Parameters<typeof generateText>[0]);

      const toolCalls: ToolCall[] | undefined =
        result.toolCalls && result.toolCalls.length > 0
          ? result.toolCalls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: (tc as { input?: Record<string, unknown> }).input ?? {},
            }))
          : undefined;

      const response: LLMResponse = {
        content: result.text,
        finishReason: result.finishReason as LLMResponse['finishReason'],
      };

      if (toolCalls) response.toolCalls = toolCalls;
      if (result.usage) {
        response.usage = {
          promptTokens: result.usage.inputTokens ?? 0,
          completionTokens: result.usage.outputTokens ?? 0,
        };
      }

      return response;
    },

    async *stream(messages: Message[], llmOptions?: LLMOptions): AsyncGenerator<LLMChunk> {
      const config: Record<string, unknown> = {
        model: aiModel,
        messages: convertMessages(messages),
      };

      if (llmOptions?.temperature !== undefined) config.temperature = llmOptions.temperature;
      if (llmOptions?.maxTokens !== undefined) config.maxTokens = llmOptions.maxTokens;
      if (llmOptions?.topP !== undefined) config.topP = llmOptions.topP;
      if (llmOptions?.stopSequences && llmOptions.stopSequences.length > 0) {
        config.stopSequences = llmOptions.stopSequences;
      }

      const tools = llmOptions?.tools as FunctionDefinition[] | undefined;
      if (tools && tools.length > 0) {
        const toolsRecord: Record<
          string,
          { description: string; parameters: ReturnType<typeof jsonSchema> }
        > = {};
        for (const tool of tools) {
          toolsRecord[tool.name] = {
            description: tool.description,
            parameters: jsonSchema(tool.parameters as JSONSchema7),
          };
        }
        config.tools = toolsRecord;
        if (llmOptions?.toolChoice) {
          const choice = llmOptions.toolChoice as ToolChoice;
          if (typeof choice === 'string') {
            config.toolChoice = choice;
          } else {
            config.toolChoice = { type: 'tool', toolName: choice.name };
          }
        }
      }

      const result = streamText(config as Parameters<typeof streamText>[0]);
      for await (const textPart of result.textStream) {
        yield { text: textPart };
      }
    },
  };
}
