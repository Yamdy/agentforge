/**
 * Google Gemini LLM Adapter for AgentForge
 *
 * Implements LLMAdapter interface using @ai-sdk/google package.
 * Supports Gemini 2.0/2.5 series models.
 *
 * @packageDocumentation
 */

import { generateText, streamText, jsonSchema } from 'ai';
import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
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

// ============================================================
// Types
// ============================================================

export interface GoogleAdapterOptions {
  /** API key (defaults to GOOGLE_API_KEY env var) */
  apiKey?: string;
  /** Base URL for custom endpoints */
  baseURL?: string;
}

// ============================================================
// Google Adapter Implementation
// ============================================================

export class GoogleAdapter implements LLMAdapter {
  readonly name: string;
  readonly provider = 'google';

  private readonly model: ReturnType<typeof google>;

  constructor(modelName: string, options?: GoogleAdapterOptions) {
    this.name = `google-${modelName}`;

    if (options && (options.apiKey || options.baseURL)) {
      const settings: Record<string, string> = {};
      if (options.apiKey) settings.apiKey = options.apiKey;
      if (options.baseURL) settings.baseURL = options.baseURL;

      const provider = createGoogleGenerativeAI(
        settings as Parameters<typeof createGoogleGenerativeAI>[0]
      );
      this.model = provider(modelName);
    } else {
      this.model = google(modelName);
    }
  }

  /**
   * Convert AgentForge Message[] to AI SDK v6 message format
   */
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

  /**
   * Extract system prompt from messages
   *
   * Gemini uses systemInstruction parameter for system prompts
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
   * Non-streaming chat completion
   */
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);

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
    // 注意：不捕获错误，让 agent-loop.ts 的 catchError 统一处理
  }

  /**
   * Streaming chat completion
   */
  async *stream(messages: Message[], options?: LLMOptions): AsyncGenerator<LLMChunk> {
    const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);
    const config: Record<string, unknown> = { model: this.model, messages: this.convertMessages(filteredMessages) };
    if (systemPrompt) config.system = systemPrompt;
    if (options?.temperature !== undefined) config.temperature = options.temperature;
    if (options?.maxTokens !== undefined) config.maxTokens = options.maxTokens;
    if (options?.topP !== undefined) config.topP = options.topP;
    if (options?.stopSequences && options.stopSequences.length > 0) config.stopSequences = options.stopSequences;

    const tools = options?.tools as FunctionDefinition[] | undefined;
    if (tools && tools.length > 0) {
      const toolsRecord: Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> = {};
      for (const tool of tools) {
        toolsRecord[tool.name] = { description: tool.description, parameters: jsonSchema(tool.parameters as JSONSchema7) };
      }
      config.tools = toolsRecord;
    }

    const result = streamText(config as Parameters<typeof streamText>[0]);
    for await (const textPart of result.textStream) {
      yield { text: textPart };
    }
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

    return { type: 'tool', toolName: choice.name };
  }

  formatTools(tools: FunctionDefinition[]): unknown {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  normalizeMessages(messages: Message[]): unknown[] {
    return this.convertMessages(messages);
  }

  formatToolChoice(choice: ToolChoice): unknown {
    if (typeof choice === 'string') return choice;
    return { type: 'tool', name: choice.name };
  }
}

// ============================================================
// Factory Functions
// ============================================================

export function createGoogleAdapter(model: string, options?: GoogleAdapterOptions): LLMAdapter {
  return new GoogleAdapter(model, options);
}

export function googleAdapterFactory(model: string, options: Record<string, unknown>): LLMAdapter {
  return createGoogleAdapter(model, options as GoogleAdapterOptions);
}
