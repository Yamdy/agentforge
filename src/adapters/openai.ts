/**
 * OpenAI LLM Adapter for AgentForge
 *
 * Implements LLMAdapter interface using @ai-sdk/openai package.
 * Supports GPT-4, GPT-4o, GPT-3.5-turbo, and o1/o3 series models.
 *
 * @packageDocumentation
 */

import { Observable } from 'rxjs';
import { generateText, streamText, type CoreMessage, type Tool } from 'ai';
import { openai, createOpenAI } from '@ai-sdk/openai';
import type {
  LLMAdapter,
  LLMResponse,
  LLMChunk,
  LLMOptions,
  FunctionDefinition,
  ToolChoice,
} from '../core/interfaces.js';
import type { Message, ToolCall } from '../core/events.js';

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
}

// ============================================================
// OpenAI Adapter Implementation
// ============================================================

/**
 * OpenAI LLM Adapter
 *
 * Implements the LLMAdapter interface using Vercel AI SDK's OpenAI provider.
 */
export class OpenAIAdapter implements LLMAdapter {
  readonly name: string;
  readonly provider = 'openai';

  private readonly model: ReturnType<typeof openai>;

  constructor(modelName: string, options?: OpenAIAdapterOptions) {
    this.name = `openai-${modelName}`;

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
   * Convert AgentForge Message[] to AI SDK CoreMessage[]
   */
  private convertMessages(messages: Message[]): CoreMessage[] {
    const result: CoreMessage[] = [];

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      if (msg.role === 'tool') {
        // Tool result message
        const toolCallId = msg.toolCallId ?? '';
        const toolName = msg.name ?? '';

        result.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId,
              toolName,
              result: content,
            },
          ],
        } as CoreMessage);
      } else {
        // Standard role messages (system, user, assistant)
        result.push({
          role: msg.role,
          content,
        } as CoreMessage);
      }
    }

    return result;
  }

  /**
   * Convert AgentForge FunctionDefinition[] to AI SDK tools format
   */
  private convertTools(tools: FunctionDefinition[] | undefined): Record<string, Tool> | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    const result: Record<string, Tool> = {};

    for (const tool of tools) {
      result[tool.name] = {
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      };
    }

    return result;
  }

  /**
   * Convert tool choice to AI SDK format
   */
  private convertToolChoice(
    choice: ToolChoice | undefined
  ): 'auto' | 'none' | 'required' | undefined {
    if (!choice) return undefined;

    if (typeof choice === 'string') {
      if (choice === 'auto' || choice === 'none' || choice === 'required') {
        return choice;
      }
      return 'auto';
    }

    // { name: string } format - AI SDK doesn't directly support this
    // Return 'required' to force tool use
    return 'required';
  }

  /**
   * Non-streaming chat completion
   */
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    try {
      const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
      const toolChoice = this.convertToolChoice(options?.toolChoice as ToolChoice | undefined);

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
      if (tools) {
        config.tools = tools;
        if (toolChoice) {
          config.toolChoice = toolChoice;
        }
      }

      const result = await generateText(config as Parameters<typeof generateText>[0]);

      // Convert tool calls to AgentForge format
      const toolCalls: ToolCall[] | undefined =
        result.toolCalls && result.toolCalls.length > 0
          ? result.toolCalls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: tc.args as Record<string, unknown>,
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
      if (result.usage) {
        response.usage = {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        };
      }

      return response;
    } catch {
      // Errors-as-events: Return error response instead of throwing
      return {
        content: '',
        finishReason: 'error',
      };
    }
  }

  /**
   * Streaming chat completion
   */
  stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk> {
    return new Observable<LLMChunk>(subscriber => {
      const run = async (): Promise<void> => {
        try {
          const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
          const toolChoice = this.convertToolChoice(options?.toolChoice as ToolChoice | undefined);

          // Build config with only defined options
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
          if (tools) {
            config.tools = tools;
            if (toolChoice) {
              config.toolChoice = toolChoice;
            }
          }

          const result = streamText(config as Parameters<typeof streamText>[0]);

          // Iterate over the text stream
          for await (const textPart of result.textStream) {
            subscriber.next({ text: textPart });
          }

          subscriber.complete();
        } catch {
          // Errors-as-events: Complete without emitting
          subscriber.complete();
        }
      };

      run().catch(() => {
        subscriber.complete();
      });
    });
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
