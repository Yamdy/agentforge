/**
 * Unit tests for LLM Adapter System
 *
 * Tests: ProviderRegistry, createLLMAdapterFromSpec, parseModelSpec,
 *        classifyError, createHttpAdapter, OpenAI HTTP adapter, adapter factory.
 *
 * All HTTP calls are mocked via vi.fn() â€?no network access required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProviderRegistry,
  classifyError,
  calculateRetryDelay,
  createHttpAdapter,
  createLLMAdapterFromSpec,
  type ClassifiedError,
  type RetryConfig,
} from '../../src/adapters/adapter-system.js';
import {
  parseModelSpec,
  detectProviderFromModel,
  createLLMAdapter,
  getLLMAdapterFactory,
  resetLLMAdapterFactory,
} from '../../src/adapters/index.js';
import { createOpenAIHttpAdapter } from '../../src/adapters/openai-http.js';
import type { Message, LLMResponse } from '../../src/core/interfaces.js';

// ============================================================
// Helpers
// ============================================================

function mockFetchSuccess(data: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    status: 200,
    statusText: 'OK',
  }) as unknown as typeof fetch;
}

function mockFetchError(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: `Error ${status}`,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

function mockFetchNetworkError(message: string): typeof fetch {
  return vi.fn().mockRejectedValue(new Error(message)) as unknown as typeof fetch;
}

const sampleMessages: Message[] = [{ role: 'user', content: 'Hello' }];

// ============================================================
// 1. ProviderRegistry
// ============================================================

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    // Get fresh instance (singleton, but we can test its methods)
    registry = ProviderRegistry.getInstance();
  });

  it('should return the same singleton instance', () => {
    const a = ProviderRegistry.getInstance();
    const b = ProviderRegistry.getInstance();
    expect(a).toBe(b);
  });

  it('should register and retrieve a provider factory', () => {
    const factory = vi.fn().mockReturnValue({
      name: 'test-adapter',
      provider: 'test',
      chat: vi.fn(),
      stream: vi.fn(),
    });

    registry.register('test-provider', factory);
    expect(registry.has('test-provider')).toBe(true);
    expect(registry.get('test-provider')).toBe(factory);
  });

  it('should return undefined for unregistered provider', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('should list all registered providers', () => {
    const factory = vi.fn();
    registry.register('alpha', factory);
    registry.register('beta', factory);

    const list = registry.list();
    expect(list).toContain('alpha');
    expect(list).toContain('beta');
  });

  it('should overwrite a previously registered factory', () => {
    const factory1 = vi.fn();
    const factory2 = vi.fn();

    registry.register('overwrite-test', factory1);
    registry.register('overwrite-test', factory2);

    expect(registry.get('overwrite-test')).toBe(factory2);
  });
});

// ============================================================
// 2. parseModelSpec
// ============================================================

describe('parseModelSpec', () => {
  it('should parse "provider/model" format', () => {
    const result = parseModelSpec('openai/gpt-4o');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
  });

  it('should parse "provider/model/variant" format (model includes slashes)', () => {
    const result = parseModelSpec('openai/gpt-4o/preview');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o/preview');
  });

  it('should auto-detect OpenAI from gpt- prefix', () => {
    const result = parseModelSpec('gpt-4o');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
  });

  it('should auto-detect OpenAI from o1- prefix', () => {
    const result = parseModelSpec('o1-preview');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('o1-preview');
  });

  it('should auto-detect OpenAI from o3- prefix', () => {
    const result = parseModelSpec('o3-mini');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('o3-mini');
  });

  it('should auto-detect Anthropic from claude- prefix', () => {
    const result = parseModelSpec('claude-3-5-sonnet');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-3-5-sonnet');
  });

  it('should auto-detect Google from gemini- prefix', () => {
    const result = parseModelSpec('gemini-pro');
    expect(result.provider).toBe('google');
    expect(result.model).toBe('gemini-pro');
  });

  it('should auto-detect Mistral from mistral- prefix', () => {
    const result = parseModelSpec('mistral-large');
    expect(result.provider).toBe('mistral');
    expect(result.model).toBe('mistral-large');
  });

  it('should auto-detect DeepSeek from deepseek- prefix', () => {
    const result = parseModelSpec('deepseek-chat');
    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-chat');
  });

  it('should auto-detect Zhipu from glm- prefix', () => {
    const result = parseModelSpec('glm-4');
    expect(result.provider).toBe('zhipu');
    expect(result.model).toBe('glm-4');
  });

  it('should auto-detect Qwen from qwen- prefix', () => {
    const result = parseModelSpec('qwen-turbo');
    expect(result.provider).toBe('qwen');
    expect(result.model).toBe('qwen-turbo');
  });

  it('should fallback to openai-compatible for unknown model names', () => {
    const result = parseModelSpec('custom-model');
    expect(result.provider).toBe('openai-compatible');
    expect(result.model).toBe('custom-model');
  });
});

// ============================================================
// 3. detectProviderFromModel
// ============================================================

describe('detectProviderFromModel', () => {
  it('should detect openai from gpt-4o', () => {
    expect(detectProviderFromModel('gpt-4o')).toBe('openai');
  });

  it('should detect anthropic from claude-3-opus', () => {
    expect(detectProviderFromModel('claude-3-opus')).toBe('anthropic');
  });

  it('should return null for unrecognized models', () => {
    expect(detectProviderFromModel('my-custom-llm')).toBeNull();
  });
});

// ============================================================
// 4. classifyError
// ============================================================

describe('classifyError', () => {
  it('should classify context overflow errors', () => {
    const cases = [
      'context_length_exceeded',
      'Maximum context length is 4096 tokens',
      'too many tokens in the prompt',
      'prompt is too long',
      'context window exceeded',
      'sequence length exceeded',
    ];

    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category).toBe('context_overflow');
      expect(result.retryable).toBe(false);
    }
  });

  it('should classify rate limit errors', () => {
    const cases = [
      'Rate limit exceeded',
      'Too Many Requests',
      '429 Too Many Requests',
      'quota exceeded',
      'API quota exhausted',
    ];

    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category).toBe('rate_limit');
      expect(result.retryable).toBe(true);
    }
  });

  it('should classify rate limit by statusCode 429', () => {
    const error = new Error('some error') as Error & { statusCode?: number };
    error.statusCode = 429;
    const result = classifyError(error);
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('should extract retry-after-ms from error message', () => {
    const result = classifyError(new Error('Rate limit exceeded retry_after_ms=5000'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryAfterMs).toBe(5000);
  });

  it('should extract retry-after-ms with equals sign variant', () => {
    const result = classifyError(new Error('rate limit retry-after-ms: 3000'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryAfterMs).toBe(3000);
  });

  it('should classify auth errors', () => {
    const cases = [
      'Unauthorized access',
      'Invalid API key provided',
      'Authentication failed',
      '401 Unauthorized',
      '403 Forbidden',
    ];

    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category).toBe('auth');
      expect(result.retryable).toBe(false);
    }
  });

  it('should classify auth errors by statusCode 401', () => {
    const error = new Error('bad') as Error & { statusCode?: number };
    error.statusCode = 401;
    const result = classifyError(error);
    expect(result.category).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  it('should classify auth errors by statusCode 403', () => {
    const error = new Error('forbidden') as Error & { statusCode?: number };
    error.statusCode = 403;
    const result = classifyError(error);
    expect(result.category).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  it('should classify server errors (5xx)', () => {
    const error = new Error('Internal Server Error') as Error & { statusCode?: number };
    error.statusCode = 500;
    const result = classifyError(error);
    expect(result.category).toBe('server_error');
    expect(result.retryable).toBe(true);
  });

  it('should classify 502/503/504 as server errors', () => {
    for (const code of [502, 503, 504]) {
      const error = new Error('gateway error') as Error & { statusCode?: number };
      error.statusCode = code;
      const result = classifyError(error);
      expect(result.category).toBe('server_error');
      expect(result.retryable).toBe(true);
    }
  });

  it('should classify network errors', () => {
    const cases = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'socket hang up',
    ];

    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category).toBe('network');
      expect(result.retryable).toBe(true);
    }
  });

  it('should classify unknown errors as non-retryable', () => {
    const result = classifyError(new Error('something went wrong'));
    expect(result.category).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('should handle non-Error values (string)', () => {
    const result = classifyError('raw string error');
    expect(result.category).toBe('unknown');
    expect(result.message).toBe('raw string error');
  });

  it('should preserve statusCode in classified error', () => {
    const error = new Error('server issue') as Error & { statusCode?: number };
    error.statusCode = 503;
    const result = classifyError(error);
    expect(result.statusCode).toBe(503);
  });

  it('should have undefined statusCode when not present', () => {
    const result = classifyError(new Error('plain error'));
    expect(result.statusCode).toBeUndefined();
  });
});

// ============================================================
// 5. calculateRetryDelay
// ============================================================

describe('calculateRetryDelay', () => {
  it('should use retryAfterMs from error when available', () => {
    const error: ClassifiedError = {
      category: 'rate_limit',
      message: 'rate limited',
      retryable: true,
      retryAfterMs: 5000,
    };
    expect(calculateRetryDelay(1, error)).toBe(5000);
  });

  it('should use exponential backoff when no retryAfterMs', () => {
    const error: ClassifiedError = {
      category: 'server_error',
      message: 'server error',
      retryable: true,
    };
    const config: RetryConfig = {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
    };

    // attempt=1: 1000 * 2^0 = 1000
    expect(calculateRetryDelay(1, error, config)).toBe(1000);
    // attempt=2: 1000 * 2^1 = 2000
    expect(calculateRetryDelay(2, error, config)).toBe(2000);
    // attempt=3: 1000 * 2^2 = 4000
    expect(calculateRetryDelay(3, error, config)).toBe(4000);
  });

  it('should cap delay at maxDelayMs', () => {
    const error: ClassifiedError = {
      category: 'server_error',
      message: 'server error',
      retryable: true,
    };
    const config: RetryConfig = {
      maxRetries: 10,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
    };

    // attempt=10: 1000 * 2^9 = 512000 â†?capped to 5000
    expect(calculateRetryDelay(10, error, config)).toBe(5000);
  });

  it('should use default config when not provided', () => {
    const error: ClassifiedError = {
      category: 'network',
      message: 'ECONNRESET',
      retryable: true,
    };
    // Default: baseDelayMs=2000, attempt=1 â†?2000 * 2^0 = 2000
    expect(calculateRetryDelay(1, error)).toBe(2000);
  });
});

// ============================================================
// 6. createHttpAdapter (adapter-system.ts)
// ============================================================

describe('createHttpAdapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should create an adapter with correct name and provider', () => {
    const adapter = createHttpAdapter('deepseek', 'deepseek-chat', {
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/v1',
    });

    expect(adapter.name).toBe('deepseek-deepseek-chat');
    expect(adapter.provider).toBe('deepseek');
  });

  it('should return empty-like result for stream()', () => {
    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const obs = adapter.stream([]);
    expect(obs).toBeDefined();
  });

  it('should call fetch with correct URL, headers, and body', async () => {
    const fetchMock = mockFetchSuccess({
      choices: [{ message: { content: 'Hi there!' }, finish_reason: 'stop' }],
    });
    globalThis.fetch = fetchMock;

    const adapter = createHttpAdapter('test', 'test-model', {
      apiKey: 'sk-test',
      baseURL: 'https://api.test.com/v1',
    });

    await adapter.chat([{ role: 'user', content: 'Hello' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.test.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('should pass temperature and maxTokens to the request body', async () => {
    const fetchMock = mockFetchSuccess({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    globalThis.fetch = fetchMock;

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    await adapter.chat(sampleMessages, { temperature: 0.7, maxTokens: 100 });

    const body = JSON.parse(
      (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string
    ) as Record<string, unknown>;
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(100);
  });

  it('should return a successful response', async () => {
    globalThis.fetch = mockFetchSuccess({
      choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('should handle tool_calls finish reason', async () => {
    globalThis.fetch = mockFetchSuccess({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                function: { name: 'read_file', arguments: '{"path":"/tmp"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('read_file');
    expect(result.toolCalls![0].args).toEqual({ path: '/tmp' });
  });

  it('should return error response on non-retryable error (auth)', async () => {
    globalThis.fetch = mockFetchError(401, {
      error: { message: 'Unauthorized: invalid API key' },
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'bad-key',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });

  it('should retry on retryable errors (server error) up to maxRetries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: { message: 'Server error' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ error: { message: 'Service unavailable' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Use tiny retry config so tests don't wait
    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
      retryConfig: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 },
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('should return error response after all retries exhausted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: { message: 'Server error' } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
      retryConfig: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 },
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// 7. OpenAI HTTP Adapter (openai-http.ts)
// ============================================================

describe('OpenAI HTTP Adapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should create adapter with correct name', () => {
    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'test' });
    expect(adapter.name).toBe('openai-http-gpt-4o');
    expect(adapter.provider).toBe('openai');
  });

  it('should make a successful chat request', async () => {
    globalThis.fetch = mockFetchSuccess({
      choices: [{ message: { content: 'Bonjour!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });

    const adapter = createOpenAIHttpAdapter('gpt-4o-mini', {
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
    });

    const result = await adapter.chat([{ role: 'user', content: 'Hi' }]);
    expect(result.content).toBe('Bonjour!');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
  });

  it('should include max_tokens in request body (default 1024)', async () => {
    const fetchMock = mockFetchSuccess({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    globalThis.fetch = fetchMock;

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    await adapter.chat(sampleMessages);

    const body = JSON.parse(
      (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string
    ) as Record<string, unknown>;
    expect(body.max_tokens).toBe(1024);
  });

  it('should override max_tokens from llmOptions', async () => {
    const fetchMock = mockFetchSuccess({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    globalThis.fetch = fetchMock;

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    await adapter.chat(sampleMessages, { maxTokens: 2048 });

    const body = JSON.parse(
      (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string
    ) as Record<string, unknown>;
    expect(body.max_tokens).toBe(2048);
  });

  it('should return error response on API failure', async () => {
    globalThis.fetch = mockFetchError(500, {
      error: { message: 'Internal Server Error' },
    });

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });

  it('should handle tool_calls in response', async () => {
    globalThis.fetch = mockFetchSuccess({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_abc',
                function: { name: 'search', arguments: '{"query":"test"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    const result = await adapter.chat(sampleMessages);
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].id).toBe('call_abc');
    expect(result.toolCalls![0].name).toBe('search');
    expect(result.toolCalls![0].args).toEqual({ query: 'test' });
  });

  it('should return EMPTY for stream()', () => {
    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    const obs = adapter.stream([]);
    expect(obs).toBeDefined();
  });

  it('should send tools in request body when provided in llmOptions', async () => {
    const fetchMock = mockFetchSuccess({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    globalThis.fetch = fetchMock;

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    await adapter.chat(sampleMessages, {
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
    });

    const body = JSON.parse(
      (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string
    ) as Record<string, unknown>;
    expect(body.tools).toBeDefined();
    expect((body.tools as unknown[]).length).toBe(1);
    expect(body.tool_choice).toBe('auto');
  });

  it('should retry without tools when API returns tool-related error', async () => {
    const fetchMock = vi
      .fn()
      // First call with tools â†?error about tools
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: 'Invalid Param: tool_choice' } }),
      })
      // Second call without tools â†?success
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'fallback ok' }, finish_reason: 'stop' }],
          }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    const result = await adapter.chat(sampleMessages, {
      tools: [
        {
          name: 'test_tool',
          description: 'A tool',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    expect(result.content).toBe('fallback ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second call should NOT have tools
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(secondBody.tools).toBeUndefined();
  });

  it('should use default baseURL when not provided', async () => {
    const fetchMock = mockFetchSuccess({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
    globalThis.fetch = fetchMock;

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    await adapter.chat(sampleMessages);

    const url = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });
});

// ============================================================
// 8. createLLMAdapterFromSpec (adapter-system.ts)
// ============================================================

describe('createLLMAdapterFromSpec', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should throw for invalid spec (no slash)', () => {
    expect(() => createLLMAdapterFromSpec('noslash')).toThrow('Invalid model spec');
  });

  it('should throw for empty model part', () => {
    expect(() => createLLMAdapterFromSpec('provider/')).toThrow('Invalid model spec');
  });

  it('should use registered factory when available', () => {
    const registry = ProviderRegistry.getInstance();
    const mockFactory = vi.fn().mockReturnValue({
      name: 'mock-adapter',
      provider: 'mock',
      chat: vi.fn(),
      stream: vi.fn(),
    });

    registry.register('mock-registered', mockFactory);

    const adapter = createLLMAdapterFromSpec('mock-registered/my-model');
    expect(mockFactory).toHaveBeenCalledWith('my-model', undefined);
    expect(adapter.name).toBe('mock-adapter');

    // Cleanup
    // (Can't unregister, but the test is isolated enough)
  });

  it('should pass options to the factory', () => {
    const registry = ProviderRegistry.getInstance();
    const mockFactory = vi.fn().mockReturnValue({
      name: 'mock-adapter',
      provider: 'mock',
      chat: vi.fn(),
      stream: vi.fn(),
    });

    registry.register('mock-opts', mockFactory);

    const options = { apiKey: 'test-key', baseURL: 'https://example.com' };
    createLLMAdapterFromSpec('mock-opts/model', options);
    expect(mockFactory).toHaveBeenCalledWith('model', options);
  });

  it('should fallback to HTTP adapter with env vars', () => {
    const originalKey = process.env.HTTPTEST_API_KEY;
    const originalUrl = process.env.HTTPTEST_BASE_URL;

    process.env.HTTPTEST_API_KEY = 'env-key';
    process.env.HTTPTEST_BASE_URL = 'https://httptest.example.com/v1';

    try {
      const adapter = createLLMAdapterFromSpec('httptest/some-model');
      expect(adapter.name).toBe('httptest-some-model');
      expect(adapter.provider).toBe('httptest');
    } finally {
      if (originalKey !== undefined) {
        process.env.HTTPTEST_API_KEY = originalKey;
      } else {
        delete process.env.HTTPTEST_API_KEY;
      }
      if (originalUrl !== undefined) {
        process.env.HTTPTEST_BASE_URL = originalUrl;
      } else {
        delete process.env.HTTPTEST_BASE_URL;
      }
    }
  });

  it('should throw when no adapter and no env vars', () => {
    // Ensure no env vars for this provider
    const originalKey = process.env.NOENVTEST_API_KEY;
    const originalUrl = process.env.NOENVTEST_BASE_URL;
    delete process.env.NOENVTEST_API_KEY;
    delete process.env.NOENVTEST_BASE_URL;

    try {
      expect(() => createLLMAdapterFromSpec('noenvtest/model')).toThrow(
        'No adapter for noenvtest'
      );
    } finally {
      if (originalKey !== undefined) process.env.NOENVTEST_API_KEY = originalKey;
      if (originalUrl !== undefined) process.env.NOENVTEST_BASE_URL = originalUrl;
    }
  });

  it('should use options apiKey/baseURL over env vars', () => {
    const adapter = createLLMAdapterFromSpec('customopt/model', {
      apiKey: 'option-key',
      baseURL: 'https://custom-option.com/v1',
    });
    expect(adapter.name).toBe('customopt-model');
    expect(adapter.provider).toBe('customopt');
  });
});

// ============================================================
// 9. LLM Adapter Factory (index.ts)
// ============================================================

describe('LLM Adapter Factory', () => {
  beforeEach(() => {
    resetLLMAdapterFactory();
  });

  it('should create adapter via createLLMAdapter', () => {
    const adapter = createLLMAdapter('openai/gpt-4o');
    expect(adapter).toBeDefined();
    expect(adapter.provider).toBe('openai');
  });

  it('should return a stub adapter for unsupported providers', () => {
    const adapter = createLLMAdapter('unsupported/model');
    expect(adapter.name).toBe('unsupported-stub');
    expect(adapter.provider).toBe('unsupported');
    expect(() => adapter.chat([])).toThrow('LLM adapter not implemented');
  });

  it('should support registering custom factories', () => {
    const factory = getLLMAdapterFactory();
    const customAdapter = {
      name: 'custom-adapter',
      provider: 'custom',
      chat: vi.fn().mockResolvedValue({
        content: 'custom response',
        finishReason: 'stop',
      } as LLMResponse),
      stream: vi.fn(),
    };

    factory.register('custom', () => customAdapter);

    const adapter = createLLMAdapter('custom/my-model');
    expect(adapter.name).toBe('custom-adapter');
  });

  it('should list available providers', () => {
    const factory = getLLMAdapterFactory();
    const providers = factory.listProviders();
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
    expect(providers).toContain('google');
    expect(providers).toContain('deepseek');
  });

  it('should auto-detect provider from model name', () => {
    const adapter = createLLMAdapter('gpt-4o');
    expect(adapter.provider).toBe('openai');
  });

  it('should auto-detect anthropic from claude model', () => {
    const adapter = createLLMAdapter('claude-3-5-sonnet');
    expect(adapter.provider).toBe('anthropic');
  });

  it('should reset factory singleton', () => {
    const factory1 = getLLMAdapterFactory();
    resetLLMAdapterFactory();
    const factory2 = getLLMAdapterFactory();
    expect(factory1).not.toBe(factory2);
  });
});

// ============================================================
// 10. Edge Cases & Integration
// ============================================================

describe('Adapter Edge Cases', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should handle empty choices array in HTTP response', async () => {
    globalThis.fetch = mockFetchSuccess({
      choices: [],
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });

  it('should handle missing usage in HTTP response', async () => {
    globalThis.fetch = mockFetchSuccess({
      choices: [{ message: { content: 'no usage' }, finish_reason: 'stop' }],
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('no usage');
    expect(result.usage).toBeUndefined();
  });

  it('should handle null content in response message', async () => {
    globalThis.fetch = mockFetchSuccess({
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('');
  });

  it('should handle network errors (fetch rejection) gracefully', async () => {
    globalThis.fetch = mockFetchNetworkError('ECONNRESET');

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
      retryConfig: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 10 },
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });

  it('should classify context overflow as non-retryable in HTTP adapter', async () => {
    globalThis.fetch = mockFetchError(400, {
      error: { message: 'context_length_exceeded: maximum context length is 4096' },
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
      retryConfig: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 },
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });
});
