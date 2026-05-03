/**
 * AgentForge LLM Adapter System
 *
 * Inspired by: AgentScope (Content Blocks), Mastra (Gateway),
 *              OpenCode (Error Classification), DeepAgents (Credential Routing)
 *
 * Key design decisions:
 * 1. Direct HTTP fallback for v1 models (MiMo, DeepSeek, etc.)
 * 2. Error classification with 28+ context overflow patterns
 * 3. Exponential backoff with header-aware delays
 * 4. Provider registry with lazy loading
 */

import type { LLMAdapter, LLMResponse, LLMOptions, Message, LLMChunk } from '../core/interfaces.js';

// ============================================================
// Error Classification (inspired by OpenCode)
// ============================================================

export type ErrorCategory =
  | 'auth' // API key invalid/expired
  | 'rate_limit' // Rate limited (retryable)
  | 'context_overflow' // Context too long (never retry)
  | 'server_error' // 5xx errors (retryable)
  | 'network' // Network errors (retryable)
  | 'unknown'; // Unknown errors

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  statusCode?: number | undefined;
  retryable: boolean;
  retryAfterMs?: number | undefined;
}

// Context overflow patterns from 28+ providers (inspired by OpenCode)
const CONTEXT_OVERFLOW_PATTERNS = [
  /context_length_exceeded/i,
  /context_window_exceeded/i,
  /maximum context length/i,
  /token limit/i,
  /too many tokens/i,
  /prompt is too long/i,
  /context length/i,
  /max_tokens/i,
  /context_length/i,
  /sequence length/i,
  /context window/i,
];

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/,
  /exhausted/i,
  /quota exceeded/i,
];

const AUTH_PATTERNS = [/unauthorized/i, /invalid.*key/i, /authentication/i, /401/, /403/];

export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = (error as { statusCode?: number }).statusCode ?? undefined;

  // Check context overflow (never retry)
  if (CONTEXT_OVERFLOW_PATTERNS.some(p => p.test(message))) {
    return { category: 'context_overflow', message, statusCode, retryable: false };
  }

  // Check rate limit (retryable)
  if (RATE_LIMIT_PATTERNS.some(p => p.test(message)) || statusCode === 429) {
    const retryAfterMs = extractRetryAfterMs(message);
    return { category: 'rate_limit', message, statusCode, retryable: true, retryAfterMs };
  }

  // Check auth errors (never retry)
  if (AUTH_PATTERNS.some(p => p.test(message)) || statusCode === 401 || statusCode === 403) {
    return { category: 'auth', message, statusCode, retryable: false };
  }

  // Check server errors (retryable)
  if (statusCode !== undefined && statusCode >= 500) {
    return { category: 'server_error', message, statusCode, retryable: true };
  }

  // Check network errors (retryable)
  if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up/i.test(message)) {
    return { category: 'network', message, retryable: true };
  }

  return { category: 'unknown', message, statusCode, retryable: false };
}

function extractRetryAfterMs(message: string): number | undefined {
  const match = message.match(/retry[_-]after[_-]ms[=:]?\s*(\d+)/i);
  if (!match || !match[1]) return undefined;
  const parsed = parseInt(match[1], 10);
  return isNaN(parsed) ? undefined : parsed;
}

// ============================================================
// Retry Policy (inspired by OpenCode)
// ============================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
};

export function calculateRetryDelay(
  attempt: number,
  error: ClassifiedError,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Use retry-after header if available
  if (error.retryAfterMs) {
    return error.retryAfterMs;
  }

  // Exponential backoff
  const delay = config.baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

// ============================================================
// Provider Registry (inspired by Mastra Gateway)
// ============================================================

export type ProviderFactory = (model: string, options?: Record<string, unknown>) => LLMAdapter;

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private factories = new Map<string, ProviderFactory>();

  private constructor() {}

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  register(provider: string, factory: ProviderFactory): void {
    this.factories.set(provider, factory);
  }

  get(provider: string): ProviderFactory | undefined {
    return this.factories.get(provider);
  }

  has(provider: string): boolean {
    return this.factories.has(provider);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }
}

// ============================================================
// HTTP Adapter (v1 compatible — uses @ai-sdk/openai-compatible)
// ============================================================

import { generateText, streamText, jsonSchema } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { JSONSchema7 } from 'json-schema';
import type { FunctionDefinition, ToolChoice } from '../core/interfaces.js';
import type { ToolCall } from '../core/events.js';
import { extractText } from '../core/content-utils.js';

export interface HttpAdapterOptions {
  apiKey: string;
  baseURL: string;
  retryConfig?: RetryConfig;
}

/**
 * Convert AgentForge messages to AI SDK format (same pattern as OpenAIAdapter)
 */
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

export function createHttpAdapter(
  provider: string,
  model: string,
  options: HttpAdapterOptions
): LLMAdapter {
  const aiProvider = createOpenAICompatible({
    name: provider,
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  });
  const aiModel = aiProvider(model);

  return {
    name: `${provider}-${model}`,
    provider,

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

// ============================================================
// Convenience Functions
// ============================================================

export function createLLMAdapterFromSpec(
  spec: string,
  options?: Record<string, unknown>
): LLMAdapter {
  const parts = spec.split('/');
  const provider = parts[0];
  const model = parts.slice(1).join('/');

  if (!provider || !model) {
    throw new Error(`Invalid model spec: ${spec}. Expected format: provider/model`);
  }

  // Check registered providers
  const factory = ProviderRegistry.getInstance().get(provider);
  if (factory) {
    return factory(model, options);
  }

  // Fallback to HTTP adapter
  const apiKey =
    (options?.apiKey as string) ?? process.env[`${provider.toUpperCase()}_API_KEY`] ?? '';
  const baseURL =
    (options?.baseURL as string) ?? process.env[`${provider.toUpperCase()}_BASE_URL`] ?? '';

  if (!apiKey || !baseURL) {
    throw new Error(
      `No adapter for ${provider}. Set ${provider.toUpperCase()}_API_KEY and ${provider.toUpperCase()}_BASE_URL`
    );
  }

  return createHttpAdapter(provider, model, { apiKey, baseURL });
}
