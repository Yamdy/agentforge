/**
 * Unit tests for OpenAI Adapter
 *
 * Tests: OpenAIAdapter class, factory functions, message conversion,
 * tool formatting, error propagation (R1 Iron Law).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Message } from '../../src/core/interfaces.js';

// ============================================================
// Mock @ai-sdk/openai
// ============================================================

vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn().mockReturnValue('mock-openai-model'),
  createOpenAI: vi.fn().mockReturnValue(
    vi.fn().mockReturnValue('mock-openai-custom-model')
  ),
}));

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'Hello from OpenAI',
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
  streamText: vi.fn().mockReturnValue({
    textStream: (async function* () {
      yield 'Hello';
      yield ' from';
      yield ' OpenAI';
    })(),
  }),
  jsonSchema: vi.fn().mockReturnValue({ type: 'object' }),
}));

// ============================================================
// Import after mocking
// ============================================================

import { OpenAIAdapter, createOpenAIAdapter, openaiAdapterFactory } from '../../src/adapters/openai.js';
import type { FunctionDefinition } from '../../src/core/interfaces.js';

// ============================================================
// Shared dynamic imports (cached once in beforeAll)
// ============================================================

let mockGenerateText: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  mockGenerateText = (await import('ai')).generateText as ReturnType<typeof vi.fn>;
});

// ============================================================
// Test Data
// ============================================================

const sampleMessages: Message[] = [
  { role: 'user', content: 'Hello' },
];

const sampleTools: FunctionDefinition[] = [
  {
    name: 'get_weather',
    description: 'Get weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
];

// ============================================================
// Tests
// ============================================================

describe('OpenAIAdapter', () => {
  describe('constructor', () => {
    it('should create adapter with model name', () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      expect(adapter.name).toBe('openai-gpt-4o');
      expect(adapter.provider).toBe('openai');
    });

    it('should create adapter with custom options', () => {
      const adapter = new OpenAIAdapter('gpt-4o', {
        apiKey: 'test-key',
        baseURL: 'https://custom.openai.com/v1',
      });
      expect(adapter.name).toBe('openai-gpt-4o');
      expect(adapter.provider).toBe('openai');
    });

    it('should create adapter with organization and project', () => {
      const adapter = new OpenAIAdapter('gpt-4o', {
        apiKey: 'test-key',
        organization: 'org-123',
        project: 'proj-456',
      });
      expect(adapter.name).toBe('openai-gpt-4o');
    });
  });

  describe('chat', () => {
    it('should call generateText and return response', async () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      const response = await adapter.chat(sampleMessages);

      expect(response.content).toBe('Hello from OpenAI');
      expect(response.finishReason).toBe('stop');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(5);
    });

    it('should pass temperature when provided', async () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      await adapter.chat(sampleMessages, { temperature: 0.7 });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ temperature: 0.7 }));
    });

    it('should pass maxTokens when provided', async () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      await adapter.chat(sampleMessages, { maxTokens: 2048 });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ maxTokens: 2048 }));
    });

    it('should pass stopSequences when provided', async () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      await adapter.chat(sampleMessages, { stopSequences: ['END', 'STOP'] });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ stopSequences: ['END', 'STOP'] }));
    });

    it('should pass tools as Record when provided', async () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      await adapter.chat(sampleMessages, { tools: sampleTools });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({
        tools: expect.objectContaining({ get_weather: expect.anything() }),
      }));
    });

    it('should pass toolChoice when tools are provided', async () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      await adapter.chat(sampleMessages, { tools: sampleTools, toolChoice: 'required' });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ toolChoice: 'required' }));
    });

    it('should handle toolChoice as object', async () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      await adapter.chat(sampleMessages, { tools: sampleTools, toolChoice: { name: 'get_weather' } });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({
        toolChoice: expect.objectContaining({ type: 'tool', toolName: 'get_weather' }),
      }));
    });

    it('should propagate generateText errors (R1: errors-as-events)', async () => {
      mockGenerateText.mockRejectedValueOnce(
        new Error('API rate limit exceeded')
      );

      const adapter = new OpenAIAdapter('gpt-4o');
      await expect(adapter.chat(sampleMessages)).rejects.toThrow('API rate limit exceeded');
    });

    it('should handle tool_calls in response', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            toolCallId: 'call_123',
            toolName: 'get_weather',
            input: { city: 'Tokyo' },
          },
        ],
        usage: { inputTokens: 5, outputTokens: 10 },
      });

      const adapter = new OpenAIAdapter('gpt-4o');
      const response = await adapter.chat(sampleMessages, { tools: sampleTools });

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]!.name).toBe('get_weather');
      expect(response.toolCalls![0]!.args).toEqual({ city: 'Tokyo' });
    });
  });

  describe('stream', () => {
    it('should yield text chunks from stream', async () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      const chunks: string[] = [];

      for await (const chunk of adapter.stream(sampleMessages)) {
        chunks.push(chunk.text);
      }

      expect(chunks).toEqual(['Hello', ' from', ' OpenAI']);
    });
  });

  describe('formatTools', () => {
    it('should format tools in OpenAI function format', () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      const formatted = adapter.formatTools(sampleTools) as Array<Record<string, unknown>>;

      expect(formatted).toHaveLength(1);
      expect(formatted[0]!.type).toBe('function');
      expect((formatted[0]!.function as Record<string, unknown>).name).toBe('get_weather');
    });
  });

  describe('formatToolChoice', () => {
    it('should format string tool choice', () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      expect(adapter.formatToolChoice('auto')).toBe('auto');
      expect(adapter.formatToolChoice('none')).toBe('none');
    });

    it('should format required as function type object', () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      const result = adapter.formatToolChoice('required') as Record<string, unknown>;
      expect(result.type).toBe('function');
    });

    it('should format named tool choice', () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      const result = adapter.formatToolChoice({ name: 'get_weather' }) as Record<string, unknown>;
      expect(result.type).toBe('function');
      expect((result.function as Record<string, unknown>).name).toBe('get_weather');
    });
  });

  describe('normalizeMessages', () => {
    it('should convert messages array', () => {
      const adapter = new OpenAIAdapter('gpt-4o');
      const normalized = adapter.normalizeMessages(sampleMessages) as Array<Record<string, unknown>>;
      expect(normalized).toHaveLength(1);
      expect(normalized[0]!.role).toBe('user');
    });
  });
});

describe('Factory Functions', () => {
  describe('createOpenAIAdapter', () => {
    it('should create adapter instance', () => {
      const adapter = createOpenAIAdapter('gpt-4o');
      expect(adapter.name).toBe('openai-gpt-4o');
      expect(adapter.provider).toBe('openai');
    });

    it('should pass options', () => {
      const adapter = createOpenAIAdapter('gpt-4o-mini', { apiKey: 'key' });
      expect(adapter.name).toBe('openai-gpt-4o-mini');
    });
  });

  describe('openaiAdapterFactory', () => {
    it('should create adapter from factory signature', () => {
      const adapter = openaiAdapterFactory('gpt-4o', {});
      expect(adapter.name).toBe('openai-gpt-4o');
      expect(adapter.provider).toBe('openai');
    });

    it('should pass options through factory', () => {
      const adapter = openaiAdapterFactory('gpt-4o', { apiKey: 'factory-key' });
      expect(adapter.name).toBe('openai-gpt-4o');
    });
  });
});
