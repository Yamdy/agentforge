/**
 * Anthropic LLM Adapter for AgentForge
 *
 * Implements LLMAdapter interface using @ai-sdk/anthropic package.
 * Compatible with AI SDK v6.
 *
 * @packageDocumentation
 */

import { Observable } from 'rxjs';
import { generateText, streamText, jsonSchema } from 'ai';
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

export interface AnthropicAdapterOptions {
  apiKey?: string;
  baseURL?: string;
}

// ============================================================
// Anthropic Adapter Implementation
// ============================================================

export class AnthropicAdapter implements LLMAdapter {
  readonly name: string;
  readonly provider = 'anthropic';

  private readonly model: ReturnType<typeof anthropic>;

  constructor(modelName: string, options?: AnthropicAdapterOptions) {
    this.name = `anthropic-${modelName}`;

    if (options && (options.apiKey || options.baseURL)) {
      const settings: Record<string, string> = {};
      if (options.apiKey) settings.apiKey = options.apiKey;
      if (options.baseURL) settings.baseURL = options.baseURL;

      const provider = createAnthropic(settings as Parameters<typeof createAnthropic>[0]);
      this.model = provider(modelName);
    } else {
      this.model = anthropic(modelName);
    }
  }

  private convertMessages(messages: Message[]): Array<Record<string, unknown>> {
    return messages.map(msg => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: msg.toolCallId ?? '',
              toolName: msg.name ?? '',
              output: content,
            },
          ],
        };
      }

      return { role: msg.role, content };
    });
  }

  private extractSystemPrompt(messages: Message[]): {
    systemPrompt: string | undefined;
    filteredMessages: Message[];
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const systemPrompt = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : undefined;

    return { systemPrompt, filteredMessages: otherMessages };
  }

  private convertTools(
    tools: FunctionDefinition[] | undefined
  ): Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> | undefined {
    if (!tools || tools.length === 0) return undefined;

    const result: Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> = {};

    for (const tool of tools) {
      result[tool.name] = {
        description: tool.description,
        parameters: jsonSchema(tool.parameters),
      };
    }

    return result;
  }

  private convertToolChoice(
    choice: ToolChoice | undefined
  ): string | { type: string; name: string } | undefined {
    if (!choice) return undefined;

    if (typeof choice === 'string') {
      if (choice === 'required') return 'any';
      return choice;
    }

    return { type: 'tool', name: choice.name };
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    try {
      const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);
      const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
      const toolChoice = this.convertToolChoice(options?.toolChoice as ToolChoice | undefined);

      const config: Record<string, unknown> = {
        model: this.model,
        messages: this.convertMessages(filteredMessages),
      };

      if (systemPrompt) config.system = systemPrompt;
      if (options?.temperature !== undefined) config.temperature = options.temperature;
      if (options?.maxTokens !== undefined) config.maxTokens = options.maxTokens;
      if (options?.topP !== undefined) config.topP = options.topP;
      if (options?.stopSequences && options.stopSequences.length > 0) {
        config.stopSequences = options.stopSequences;
      }
      if (tools) {
        config.tools = tools;
        if (toolChoice) config.toolChoice = toolChoice;
      }

      const result = await generateText(config as Parameters<typeof generateText>[0]);

      const toolCalls: ToolCall[] | undefined =
        result.toolCalls && result.toolCalls.length > 0
          ? result.toolCalls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: (tc as unknown as { input?: Record<string, unknown> }).input ?? {},
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
    } catch {
      return { content: '', finishReason: 'error' };
    }
  }

  stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk> {
    return new Observable<LLMChunk>(subscriber => {
      const run = async (): Promise<void> => {
        try {
          const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);
          const tools = this.convertTools(options?.tools as FunctionDefinition[] | undefined);
          const toolChoice = this.convertToolChoice(options?.toolChoice as ToolChoice | undefined);

          const config: Record<string, unknown> = {
            model: this.model,
            messages: this.convertMessages(filteredMessages),
          };

          if (systemPrompt) config.system = systemPrompt;
          if (options?.temperature !== undefined) config.temperature = options.temperature;
          if (options?.maxTokens !== undefined) config.maxTokens = options.maxTokens;
          if (options?.topP !== undefined) config.topP = options.topP;
          if (options?.stopSequences && options.stopSequences.length > 0) {
            config.stopSequences = options.stopSequences;
          }
          if (tools) {
            config.tools = tools;
            if (toolChoice) config.toolChoice = toolChoice;
          }

          const result = streamText(config as Parameters<typeof streamText>[0]);

          for await (const textPart of result.textStream) {
            subscriber.next({ text: textPart });
          }

          subscriber.complete();
        } catch {
          subscriber.complete();
        }
      };

      run().catch(() => subscriber.complete());
    });
  }

  formatTools(tools: FunctionDefinition[]): unknown {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  normalizeMessages(messages: Message[]): unknown[] {
    return this.convertMessages(messages);
  }

  formatToolChoice(choice: ToolChoice): unknown {
    if (typeof choice === 'string') {
      if (choice === 'required') return { type: 'any' };
      return { type: choice };
    }
    return { type: 'tool', name: choice.name };
  }
}

export function createAnthropicAdapter(model: string, options?: AnthropicAdapterOptions): LLMAdapter {
  return new AnthropicAdapter(model, options);
}

export function anthropicAdapterFactory(model: string, options: Record<string, unknown>): LLMAdapter {
  return createAnthropicAdapter(model, options as AnthropicAdapterOptions);
}