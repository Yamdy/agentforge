/**
 * Unit tests for Anthropic Adapter
 *
 * Tests: AnthropicAdapter class, factory functions, system prompt extraction,
 * message conversion, error propagation (R1 Iron Law).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Message } from '../../src/core/interfaces.js';

// ============================================================
// Mock @ai-sdk/anthropic
// ============================================================

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn().mockReturnValue('mock-anthropic-model'),
  createAnthropic: vi.fn().mockReturnValue(
    vi.fn().mockReturnValue('mock-anthropic-custom-model')
  ),
}));

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'Hello from Claude',
    finishReason: 'stop',
    usage: { inputTokens: 15, outputTokens: 8 },
  }),
  streamText: vi.fn().mockReturnValue({
    textStream: (async function* () {
      yield 'Hello';
      yield ' from';
      yield ' Claude';
    })(),
  }),
  jsonSchema: vi.fn().mockReturnValue({ type: 'object' }),
}));

// ============================================================
// Import after mocking
// ============================================================

import { AnthropicAdapter, createAnthropicAdapter, anthropicAdapterFactory } from '../../src/adapters/anthropic.js';
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

describe('AnthropicAdapter', () => {
  describe('constructor', () => {
    it('should create adapter with model name', () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      expect(adapter.name).toBe('anthropic-claude-3-5-sonnet-20241022');
      expect(adapter.provider).toBe('anthropic');
    });

    it('should create adapter with custom options', () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022', {
        apiKey: 'test-key',
        baseURL: 'https://custom.anthropic.com',
      });
      expect(adapter.name).toBe('anthropic-claude-3-5-sonnet-20241022');
    });

    it('should work with default provider when no options', () => {
      const adapter = new AnthropicAdapter('claude-3-haiku-20240307');
      expect(adapter.provider).toBe('anthropic');
    });
  });

  describe('chat', () => {
    it('should call generateText and return response', async () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      const response = await adapter.chat(sampleMessages);

      expect(response.content).toBe('Hello from Claude');
      expect(response.finishReason).toBe('stop');
      expect(response.usage?.promptTokens).toBe(15);
      expect(response.usage?.completionTokens).toBe(8);
    });

    it('should extract and pass system prompt separately', async () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');

      const messagesWithSystem: Message[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];

      await adapter.chat(messagesWithSystem);

      const callArgs = mockGenerateText.mock.lastCall?.[0] as Record<string, unknown> | undefined;
      expect(callArgs?.system).toBe('You are a helpful assistant.');

      const callMessages = callArgs?.messages as Array<Record<string, unknown>> | undefined;
      expect(callMessages).toHaveLength(1);
      expect(callMessages?.[0]?.role).toBe('user');
    });

    it('should pass temperature when provided', async () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      await adapter.chat(sampleMessages, { temperature: 0.5 });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ temperature: 0.5 }));
    });

    it('should pass maxTokens when provided', async () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      await adapter.chat(sampleMessages, { maxTokens: 4096 });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ maxTokens: 4096 }));
    });

    it('should pass tools when provided', async () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      await adapter.chat(sampleMessages, { tools: sampleTools });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({
        tools: expect.objectContaining({ get_weather: expect.anything() }),
      }));
    });

    it('should convert required toolChoice to any for Anthropic', async () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      await adapter.chat(sampleMessages, { tools: sampleTools, toolChoice: 'required' });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({ toolChoice: 'any' }));
    });

    it('should pass stopSequences when provided', async () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      await adapter.chat(sampleMessages, { stopSequences: ['\n\nHuman:', '\n\nAssistant:'] });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({
        stopSequences: ['\n\nHuman:', '\n\nAssistant:'],
      }));
    });

    it('should propagate generateText errors (R1: errors-as-events)', async () => {
      mockGenerateText.mockRejectedValueOnce(
        new Error('Rate limit exceeded')
      );

      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      await expect(adapter.chat(sampleMessages)).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('stream', () => {
    it('should yield text chunks from stream', async () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      const chunks: string[] = [];

      for await (const chunk of adapter.stream(sampleMessages)) {
        chunks.push(chunk.text);
      }

      expect(chunks).toEqual(['Hello', ' from', ' Claude']);
    });
  });

  describe('formatTools', () => {
    it('should format tools in Anthropic format', () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      const formatted = adapter.formatTools(sampleTools) as Array<Record<string, unknown>>;

      expect(formatted).toHaveLength(1);
      expect(formatted[0]!.name).toBe('get_weather');
      expect(formatted[0]!.description).toBeDefined();
    });
  });

  describe('formatToolChoice', () => {
    it('should convert required to any for Anthropic', () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      const result = adapter.formatToolChoice('required') as Record<string, unknown>;
      expect(result.type).toBe('any');
    });

    it('should pass string choices through', () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      expect(adapter.formatToolChoice('auto')).toEqual({ type: 'auto' });
    });

    it('should format named tool choice', () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      const result = adapter.formatToolChoice({ name: 'get_weather' }) as Record<string, unknown>;
      expect(result.type).toBe('tool');
      expect(result.name).toBe('get_weather');
    });
  });

  describe('normalizeMessages', () => {
    it('should convert messages array', () => {
      const adapter = new AnthropicAdapter('claude-3-5-sonnet-20241022');
      const normalized = adapter.normalizeMessages(sampleMessages) as Array<Record<string, unknown>>;
      expect(normalized).toHaveLength(1);
      expect(normalized[0]!.role).toBe('user');
    });
  });
});

describe('Factory Functions', () => {
  describe('createAnthropicAdapter', () => {
    it('should create adapter instance', () => {
      const adapter = createAnthropicAdapter('claude-3-5-sonnet-20241022');
      expect(adapter.name).toBe('anthropic-claude-3-5-sonnet-20241022');
    });
  });

  describe('anthropicAdapterFactory', () => {
    it('should create adapter from factory signature', () => {
      const adapter = anthropicAdapterFactory('claude-3-5-sonnet-20241022', {});
      expect(adapter.name).toBe('anthropic-claude-3-5-sonnet-20241022');
    });
  });
});
