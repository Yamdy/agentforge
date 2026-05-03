/**
 * OpenAI LLM Adapter for AgentForge
 *
 * Implements LLMAdapter interface using @ai-sdk/openai package.
 * Supports GPT-4, GPT-4o, GPT-3.5-turbo, and o1/o3 series models.
 *
 * @packageDocumentation
 */

import { generateText, streamText, jsonSchema } from 'ai';
import { openai, createOpenAI } from '@ai-sdk/openai';
import type {
  LLMAdapter,
  LLMResponse,
  LLMChunk,
  LLMOptions,
  FunctionDefinition,
  ToolChoice,
} from '../core/interfaces.js';
import type { JSONSchema7 } from 'json-schema';
import type { Message, ToolCall } from '../core/events.js';
import type { Logger } from '../core/logger.js';
import { DefaultLogger } from '../core/logger.js';
import { extractText } from '../core/content-utils.js';

// ============================================================
// Types
// ============================================================

/**
 * OpenAI adapter options
 */
export interface OpenAIAdapterOptions {
  /** API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Base URL for OpenAI-compatible APIs */
  baseURL?: string;
  /** Organization ID */
  organization?: string;
  /** Project ID */
  project?: string;
  /** Logger instance */
  logger?: Logger;
}

// ============================================================
// OpenAI Adapter Implementation
// ============================================================

/**
 * OpenAI LLM Adapter
 *
 * Implements the LLMAdapter interface using Vercel AI SDK v6's OpenAI provider.
 */
export class OpenAIAdapter implements LLMAdapter {
  readonly name: string;
  readonly provider = 'openai';

  private readonly model: ReturnType<typeof openai>;
  private readonly logger: Logger;

  constructor(modelName: string, options?: OpenAIAdapterOptions) {
    this.name = `openai-${modelName}`;
    this.logger = options?.logger ?? new DefaultLogger('openai');

    // Create OpenAI provider instance with options or use default
    if (options && (options.apiKey || options.baseURL || options.organization || options.project)) {
      // Build settings object with only defined values
      const settings: Record<string, string> = {};
      if (options.apiKey) settings.apiKey = options.apiKey;
      if (options.baseURL) settings.baseURL = options.baseURL;
      if (options.organization) settings.organization = options.organization;
      if (options.project) settings.project = options.project;

      const provider = createOpenAI(settings as Parameters<typeof createOpenAI>[0]);
      this.model = provider(modelName);
    } else {
      this.model = openai(modelName);
    }
  }

  /**
   * Convert AgentForge Message[] to AI SDK v6 message format
   */
  private convertMessages(messages: Message[]): Array<{
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
        // Tool result message — extract text for tool-result output
        const toolCallId = msg.toolCallId ?? '';
        const toolName = msg.name ?? '';
        const output = extractText(msg.content);

        result.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId,
              toolName,
              output,
            },
          ],
        });
      } else {
        // Standard role messages (system, user, assistant)
        // Pass content directly — AI SDK supports both strings and ContentPart[] arrays
        result.push({
          role: msg.role,
          content: msg.content as
            | string
            | Array<
                | { type: 'text'; text: string }
                | {
                    type: 'image_url';
                    image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
                  }
              >,
        });
      }
    }

    return result;
  }

  /**
   * Convert tool choice to AI SDK format
   */
  private convertToolChoice(
    choice: ToolChoice | undefined
  ): 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string } | undefined {
    if (!choice) return undefined;

    if (typeof choice === 'string') {
      if (choice === 'auto' || choice === 'none' || choice === 'required') {
        return choice;
      }
      return 'auto';
    }

    // { name: string } format
    return { type: 'tool', toolName: choice.name };
  }

  /**
   * Non-streaming chat completion
   */
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    try {
      // Build config with only defined options (exactOptionalPropertyTypes)
      const config: Record<string, unknown> = {
        model: this.model,
        messages: this.convertMessages(messages),
      };

      if (options?.temperature !== undefined) {
        config.temperature = options.temperature;
      }
      if (options?.maxTokens !== undefined) {
        config.maxTokens = options.maxTokens;
      }
      if (options?.topP !== undefined) {
        config.topP = options.topP;
      }
      if (options?.stopSequences && options.stopSequences.length > 0) {
        config.stopSequences = options.stopSequences;
      }

      // AI SDK v6: tools as Record<string, Tool> with jsonSchema
      const tools = options?.tools as FunctionDefinition[] | undefined;
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

        const toolChoice = this.convertToolChoice(options?.toolChoice as ToolChoice | undefined);
        if (toolChoice) {
          config.toolChoice = toolChoice;
        }
      }

      const result = await generateText(config as Parameters<typeof generateText>[0]);

      // Convert tool calls to AgentForge format
      // AI SDK v6: toolCalls have toolCallId, toolName, and input (not args)
      const toolCalls: ToolCall[] | undefined =
        result.toolCalls && result.toolCalls.length > 0
          ? result.toolCalls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              // AI SDK v6 uses 'input' instead of 'args'
              args: (tc as { input?: Record<string, unknown> }).input ?? {},
            }))
          : undefined;

      // Build response with only defined fields
      const response: LLMResponse = {
        content: result.text,
        finishReason: result.finishReason as LLMResponse['finishReason'],
      };

      if (toolCalls) {
        response.toolCalls = toolCalls;
      }

      // AI SDK v6: usage uses inputTokens/outputTokens
      if (result.usage) {
        response.usage = {
          promptTokens: result.usage.inputTokens ?? 0,
          completionTokens: result.usage.outputTokens ?? 0,
        };
      }

      return response;
    } catch (error) {
      // Errors-as-events: Return error response instead of throwing
      this.logger.error('Chat error', error instanceof Error ? error : undefined);
      return {
        content: '',
        finishReason: 'error',
      };
    }
  }

  /**
   * Streaming chat completion
   */
  async *stream(messages: Message[], options?: LLMOptions): AsyncGenerator<LLMChunk> {
    const config: Record<string, unknown> = {
      model: this.model,
      messages: this.convertMessages(messages),
    };

    if (options?.temperature !== undefined) config.temperature = options.temperature;
    if (options?.maxTokens !== undefined) config.maxTokens = options.maxTokens;
    if (options?.topP !== undefined) config.topP = options.topP;
    if (options?.stopSequences && options.stopSequences.length > 0) {
      config.stopSequences = options.stopSequences;
    }

    const tools = options?.tools as FunctionDefinition[] | undefined;
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
      const toolChoice = this.convertToolChoice(options?.toolChoice as ToolChoice | undefined);
      if (toolChoice) config.toolChoice = toolChoice;
    }

    const result = streamText(config as Parameters<typeof streamText>[0]);
    for await (const textPart of result.textStream) {
      yield { text: textPart };
    }
  }

  /**
   * Format tools for OpenAI API
   */
  formatTools(tools: FunctionDefinition[]): unknown {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Normalize messages to OpenAI format
   */
  normalizeMessages(messages: Message[]): unknown[] {
    return this.convertMessages(messages);
  }

  /**
   * Format tool choice for OpenAI API
   */
  formatToolChoice(choice: ToolChoice): unknown {
    if (typeof choice === 'string') {
      if (choice === 'required') {
        return { type: 'function' };
      }
      return choice;
    }
    return { type: 'function', function: { name: choice.name } };
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create an OpenAI adapter instance
 *
 * @param model - Model name (e.g., 'gpt-4o', 'gpt-4o-mini', 'o1-preview')
 * @param options - OpenAI-specific options
 * @returns LLMAdapter instance
 */
export function createOpenAIAdapter(model: string, options?: OpenAIAdapterOptions): LLMAdapter {
  return new OpenAIAdapter(model, options);
}

/**
 * Factory function for LLMAdapterFactory registration
 */
export function openaiAdapterFactory(model: string, options: Record<string, unknown>): LLMAdapter {
  return createOpenAIAdapter(model, options as OpenAIAdapterOptions);
}
