/**
 * Anthropic LLM Adapter for AgentForge
 *
 * Implements LLMAdapter interface using @ai-sdk/anthropic package.
 * Supports Claude 3.5 Sonnet, Claude 3 Opus, and Claude 3 Haiku models.
 *
 * @packageDocumentation
 */

import { Observable } from 'rxjs';
import { generateText, streamText, type CoreMessage, type Tool } from 'ai';
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
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
 * Anthropic adapter options
 */
export interface AnthropicAdapterOptions {
  /** API key (defaults to ANTHROPIC_API_KEY env var) */
  apiKey?: string;
  /** Base URL for Anthropic API */
  baseURL?: string;
}

// ============================================================
// Anthropic Adapter Implementation
// ============================================================

/**
 * Anthropic LLM Adapter
 *
 * Implements the LLMAdapter interface using Vercel AI SDK's Anthropic provider.
 *
 * Key differences from OpenAI:
 * - Anthropic uses separate system prompt parameter
 * - Tool results are in user messages, not tool messages
 * - Different tool schema format
 */
export class AnthropicAdapter implements LLMAdapter {
  readonly name: string;
  readonly provider = 'anthropic';

  private readonly model: ReturnType<typeof anthropic>;

  constructor(modelName: string, options?: AnthropicAdapterOptions) {
    this.name = `anthropic-${modelName}`;

    // Create Anthropic provider instance with options or use default
    if (options && (options.apiKey || options.baseURL)) {
      // Build settings object with only defined values
      const settings: Record<string, string> = {};
      if (options.apiKey) settings.apiKey = options.apiKey;
      if (options.baseURL) settings.baseURL = options.baseURL;

      const provider = createAnthropic(settings as Parameters<typeof createAnthropic>[0]);
      this.model = provider(modelName);
    } else {
      this.model = anthropic(modelName);
    }
  }

  /**
   * Convert AgentForge Message[] to AI SDK CoreMessage[]
   *
   * Anthropic-specific message format:
   * - System messages go to separate 'system' parameter
   * - Tool results use role: 'tool'
   * - Uses content blocks for multi-part messages
   */
  private convertMessages(messages: Message[]): CoreMessage[] {
    const result: CoreMessage[] = [];

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      if (msg.role === 'tool') {
        // Tool result message - AI SDK handles conversion
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
   * Extract system message from messages array
   *
   * Anthropic uses a separate 'system' parameter instead of system messages
   */
  private extractSystemPrompt(messages: Message[]): {
    systemPrompt: string | undefined;
    filteredMessages: Message[];
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const systemPrompt =
      systemMessages.length > 0 ? systemMessages.map(m => m.content).join('\n\n') : undefined;

    return { systemPrompt, filteredMessages: otherMessages };
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
   *
   * Anthropic supports: 'auto', 'any', 'none', or { type: 'tool', name: string }
   */
  private convertToolChoice(
    choice: ToolChoice | undefined
  ): string | { type: string; name: string } | undefined {
    if (!choice) return undefined;

    if (typeof choice === 'string') {
      // Map 'required' to 'any' for Anthropic
      if (choice === 'required') {
        return 'any';
      }
      return choice;
    }

    // { name: string } format
    return { type: 'tool', name: choice.name };
  }

  /**
   * Non-streaming chat completion
   */
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    try {
      const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);
      const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
      const toolChoice = this.convertToolChoice(options?.toolChoice as ToolChoice | undefined);

      // Build config with only defined options
      const config: Record<string, unknown> = {
        model: this.model,
        messages: this.convertMessages(filteredMessages),
      };

      if (systemPrompt) {
        config.system = systemPrompt;
      }
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
          const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);
          const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
          const toolChoice = this.convertToolChoice(options?.toolChoice as ToolChoice | undefined);

          // Build config with only defined options
          const config: Record<string, unknown> = {
            model: this.model,
            messages: this.convertMessages(filteredMessages),
          };

          if (systemPrompt) {
            config.system = systemPrompt;
          }
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
   * Format tools for Anthropic API
   *
   * Anthropic format: { name, description, input_schema }
   */
  formatTools(tools: FunctionDefinition[]): unknown {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  /**
   * Normalize messages to Anthropic format
   */
  normalizeMessages(messages: Message[]): unknown[] {
    return this.convertMessages(messages);
  }

  /**
   * Format tool choice for Anthropic API
   */
  formatToolChoice(choice: ToolChoice): unknown {
    if (typeof choice === 'string') {
      if (choice === 'required') {
        return { type: 'any' };
      }
      return { type: choice };
    }
    return { type: 'tool', name: choice.name };
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create an Anthropic adapter instance
 *
 * @param model - Model name (e.g., 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229')
 * @param options - Anthropic-specific options
 * @returns LLMAdapter instance
 */
export function createAnthropicAdapter(
  model: string,
  options?: AnthropicAdapterOptions
): LLMAdapter {
  return new AnthropicAdapter(model, options);
}

/**
 * Factory function for LLMAdapterFactory registration
 */
export function anthropicAdapterFactory(
  model: string,
  options: Record<string, unknown>
): LLMAdapter {
  return createAnthropicAdapter(model, options as AnthropicAdapterOptions);
}
