/**
 * Unit tests for LLM Adapter System
 *
 * Tests: ProviderRegistry, createLLMAdapterFromSpec, parseModelSpec,
 *        classifyError, createHttpAdapter, OpenAI HTTP adapter, adapter factory.
 *
 * All HTTP calls are mocked via vi.fn() �?no network access required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mock @ai-sdk/openai-compatible
// ============================================================

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn().mockReturnValue(
    vi.fn().mockReturnValue('mock-compatible-model')
  ),
}));

// ============================================================
// Mock ai SDK (hoisted for ESM import ordering)
// ============================================================

const { mockGenerateText, mockStreamText, mockJsonSchema } = vi.hoisted(() => {
  function makeTextStream(): AsyncGenerator<string> {
    return (async function* () {
      yield 'Hello';
      yield ' from';
      yield ' test';
    })();
  }

  return {
    mockGenerateText: vi.fn().mockResolvedValue({
      text: 'Hello from test adapter',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 3 },
    }),
    mockStreamText: vi.fn().mockImplementation(() => ({
      textStream: makeTextStream(),
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'Hello', id: '1' };
        yield { type: 'text-delta', text: ' from', id: '1' };
        yield { type: 'text-delta', text: ' test', id: '1' };
      })(),
    })),
    mockJsonSchema: vi.fn().mockReturnValue({ type: 'object' }),
  };
});

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
  jsonSchema: mockJsonSchema,
}));

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
    registry = new ProviderRegistry();
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

    // attempt=10: 1000 * 2^9 = 512000 �?capped to 5000
    expect(calculateRetryDelay(10, error, config)).toBe(5000);
  });

  it('should use default config when not provided', () => {
    const error: ClassifiedError = {
      category: 'network',
      message: 'ECONNRESET',
      retryable: true,
    };
    // Default: baseDelayMs=2000, attempt=1 �?2000 * 2^0 = 2000
    expect(calculateRetryDelay(1, error)).toBe(2000);
  });
});

// ============================================================
// 6. createHttpAdapter (adapter-system.ts)
// ============================================================

describe('createHttpAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: 'Hello from test adapter',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 3 },
    });
  });

  it('should create an adapter with correct name and provider', () => {
    const adapter = createHttpAdapter('deepseek', 'deepseek-chat', {
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/v1',
    });

    expect(adapter.name).toBe('deepseek-deepseek-chat');
    expect(adapter.provider).toBe('deepseek');
  });

  it('should return a stream generator', () => {
    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const gen = adapter.stream([]);
    expect(gen).toBeDefined();
    expect(gen[Symbol.asyncIterator]).toBeDefined();
  });

  it('should call generateText via AI SDK', async () => {
    const adapter = createHttpAdapter('test', 'test-model', {
      apiKey: 'sk-test',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat([{ role: 'user', content: 'Hello' }]);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('Hello from test adapter');
    expect(result.finishReason).toBe('stop');
  });

  it('should pass temperature and maxTokens to generateText', async () => {
    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    await adapter.chat(sampleMessages, { temperature: 0.7, maxTokens: 100 });

    expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({
      temperature: 0.7,
      maxTokens: 100,
    }));
  });

  it('should return a successful response with usage', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Hello world',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
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

  it('should handle tool_calls via AI SDK', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          toolCallId: 'call_1',
          toolName: 'read_file',
          input: { path: '/tmp' },
        },
      ],
      usage: { inputTokens: 5, outputTokens: 3 },
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

  it('should propagate errors to caller (R1: errors-as-events)', async () => {
    mockGenerateText.mockRejectedValue(new Error('API rate limit exceeded'));

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    await expect(adapter.chat(sampleMessages)).rejects.toThrow('API rate limit exceeded');
    // Adapter makes exactly one attempt — retry is handled by agent-loop
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it('should yield text chunks from stream', async () => {
    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream(sampleMessages)) {
      chunks.push(chunk.text);
    }

    expect(chunks).toEqual(['Hello', ' from', ' test']);
  });
});

// ============================================================
// 7. OpenAI HTTP Adapter (openai-http.ts)
// ============================================================

describe('OpenAI HTTP Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: 'Hello from openai-http',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 3 },
    });
  });

  it('should create adapter with correct name', () => {
    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'test' });
    expect(adapter.name).toBe('openai-http-gpt-4o');
    expect(adapter.provider).toBe('openai');
  });

  it('should make a successful chat request', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Bonjour!',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 3 },
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

  it('should include maxTokens in generateText config (default 1024)', async () => {
    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    await adapter.chat(sampleMessages);

    expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ maxTokens: 1024 }));
  });

  it('should override maxTokens from llmOptions', async () => {
    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    await adapter.chat(sampleMessages, { maxTokens: 2048 });

    expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ maxTokens: 2048 }));
  });

  it('should propagate errors to caller (R1: errors-as-events)', async () => {
    mockGenerateText.mockRejectedValue(new Error('Internal Server Error'));

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    await expect(adapter.chat(sampleMessages)).rejects.toThrow('Internal Server Error');
  });

  it('should handle tool_calls in response', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          toolCallId: 'call_abc',
          toolName: 'search',
          input: { query: 'test' },
        },
      ],
      usage: { inputTokens: 5, outputTokens: 3 },
    });

    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    const result = await adapter.chat(sampleMessages);
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].id).toBe('call_abc');
    expect(result.toolCalls![0].name).toBe('search');
    expect(result.toolCalls![0].args).toEqual({ query: 'test' });
  });

  it('should support streaming via streamText', async () => {
    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream(sampleMessages)) {
      chunks.push(chunk.text);
    }

    expect(chunks).toEqual(['Hello', ' from', ' test']);
  });

  it('should send tools when provided in llmOptions', async () => {
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

    expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({
      tools: expect.objectContaining({ get_weather: expect.anything() }),
    }));
  });

  it('should use AI SDK for chat (no raw fetch)', async () => {
    const adapter = createOpenAIHttpAdapter('gpt-4o', { apiKey: 'key' });
    await adapter.chat(sampleMessages);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
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
    const registry = new ProviderRegistry();
    const mockFactory = vi.fn().mockReturnValue({
      name: 'mock-adapter',
      provider: 'mock',
      chat: vi.fn(),
      stream: vi.fn(),
    });

    registry.register('mock-registered', mockFactory);

    const adapter = createLLMAdapterFromSpec('mock-registered/my-model', undefined, registry);
    expect(mockFactory).toHaveBeenCalledWith('my-model', undefined);
    expect(adapter.name).toBe('mock-adapter');
  });

  it('should pass options to the factory', () => {
    const registry = new ProviderRegistry();
    const mockFactory = vi.fn().mockReturnValue({
      name: 'mock-adapter',
      provider: 'mock',
      chat: vi.fn(),
      stream: vi.fn(),
    });

    registry.register('mock-opts', mockFactory);

    const options = { apiKey: 'test-key', baseURL: 'https://example.com' };
    createLLMAdapterFromSpec('mock-opts/model', options, registry);
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

  it('should support registering custom factories on a shared instance', () => {
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

    // Use the same factory instance to create the adapter
    const adapter = factory.create('custom/my-model');
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

  it('should create independent factory instances (no singleton)', () => {
    const factory1 = getLLMAdapterFactory();
    const factory2 = getLLMAdapterFactory();
    expect(factory1).not.toBe(factory2);
  });
});

// ============================================================
// 10. Edge Cases & Integration
// ============================================================

describe('Adapter Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: 'Hello from test adapter',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 3 },
    });
  });

  it('should handle missing usage in response', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'no usage',
      finishReason: 'stop',
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('no usage');
    expect(result.usage).toBeUndefined();
  });

  it('should handle empty text in response', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      finishReason: 'stop',
    });

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    const result = await adapter.chat(sampleMessages);
    expect(result.content).toBe('');
  });

  it('should propagate generateText errors to caller (R1: errors-as-events)', async () => {
    mockGenerateText.mockRejectedValue(new Error('ECONNRESET'));

    const adapter = createHttpAdapter('test', 'model', {
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
    });

    await expect(adapter.chat(sampleMessages)).rejects.toThrow('ECONNRESET');
  });

  it('should classify context overflow errors via classifyError utility', () => {
    const error = new Error('context_length_exceeded: maximum context length is 4096');
    (error as unknown as Record<string, unknown>).statusCode = 400;

    const classified = classifyError(error);
    expect(classified.category).toBe('context_overflow');
    expect(classified.retryable).toBe(false);
  });
});
