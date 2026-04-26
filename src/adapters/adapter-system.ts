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

import type { LLMAdapter, LLMResponse, LLMOptions, Message } from '../core/interfaces.js';
import type { Observable } from 'rxjs';
import { EMPTY } from 'rxjs';

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
// HTTP Adapter (v1 compatible - for MiMo, DeepSeek, etc.)
// ============================================================

export interface HttpAdapterOptions {
  apiKey: string;
  baseURL: string;
  retryConfig?: RetryConfig;
}

export function createHttpAdapter(
  provider: string,
  model: string,
  options: HttpAdapterOptions
): LLMAdapter {
  const retryConfig = options.retryConfig ?? DEFAULT_RETRY_CONFIG;

  return {
    name: `${provider}-${model}`,
    provider,

    async chat(messages: Message[], llmOptions?: LLMOptions): Promise<LLMResponse> {
      let lastError: ClassifiedError | null = null;

      for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
        try {
          const response = await callHTTPAPI(
            options.baseURL,
            options.apiKey,
            model,
            messages,
            llmOptions
          );
          return response;
        } catch (error: unknown) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          lastError = classifyError(errorObj);

          // Don't retry non-retryable errors
          if (!lastError.retryable) {
            console.error(`[${provider}] Non-retryable error:`, lastError.message);
            return { content: '', finishReason: 'error' };
          }

          // Wait before retry
          if (attempt < retryConfig.maxRetries) {
            const delay = calculateRetryDelay(attempt, lastError, retryConfig);
            console.warn(
              `[${provider}] Retry ${attempt}/${retryConfig.maxRetries} after ${delay}ms`
            );
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      console.error(`[${provider}] All retries exhausted:`, lastError?.message);
      return { content: '', finishReason: 'error' };
    },

    stream(): Observable<never> {
      return EMPTY;
    },
  };
}

async function callHTTPAPI(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: Message[],
  options?: LLMOptions
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };

  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const errorMsg =
      (errorData as { error?: { message?: string } }).error?.message ?? response.statusText;
    const error = new Error(`API error ${response.status}: ${errorMsg}`);
    (error as unknown as Record<string, unknown>).statusCode = response.status;
    throw error;
  }

  const data = (await response.json()) as {
    choices: Array<{
      message: {
        content: string;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const choice = data.choices[0];
  if (!choice) throw new Error('No choices in response');

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
