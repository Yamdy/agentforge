/**
 * Ollama LLM Adapter for AgentForge
 *
 * Implements LLMAdapter interface using ai-sdk-ollama package.
 * Supports local models running on Ollama server.
 *
 * @packageDocumentation
 */

import { generateText, streamText, jsonSchema } from 'ai';
import { ollama, createOllama } from 'ai-sdk-ollama';
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

export interface OllamaAdapterOptions {
  /** Base URL for Ollama server (default: http://localhost:11434) */
  baseURL?: string;
}

// ============================================================
// Ollama Adapter Implementation
// ============================================================

export class OllamaAdapter implements LLMAdapter {
  readonly name: string;
  readonly provider = 'ollama';

  private readonly model: ReturnType<typeof ollama>;

  constructor(modelName: string, options?: OllamaAdapterOptions) {
    this.name = `ollama-${modelName}`;
    const baseURL = options?.baseURL ?? 'http://localhost:11434';
    const provider = createOllama({ baseURL });
    this.model = provider(modelName);
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
   * Ollama uses system parameter for system prompts
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

  normalizeMessages(messages: Message[]): unknown[] {
    return this.convertMessages(messages);
  }

  formatToolChoice(choice: ToolChoice): unknown {
    if (typeof choice === 'string') {
      if (choice === 'required') return { type: 'function' };
      return choice;
    }
    return { type: 'function', function: { name: choice.name } };
  }
}

// ============================================================
// Factory Functions
// ============================================================

export function createOllamaAdapter(model: string, options?: OllamaAdapterOptions): LLMAdapter {
  return new OllamaAdapter(model, options);
}

export function ollamaAdapterFactory(model: string, options: Record<string, unknown>): LLMAdapter {
  return createOllamaAdapter(model, options as OllamaAdapterOptions);
}
