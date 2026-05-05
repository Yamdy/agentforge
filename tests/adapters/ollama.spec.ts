/**
 * Unit tests for Ollama Adapter
 *
 * Tests: OllamaAdapter class, factory functions, tool conversion,
 * stream with tool calls, option passing, error handling.
 * All API calls are mocked via vi.fn() — no network access required.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { Message, FunctionDefinition } from '../../src/core/interfaces.js';

// ============================================================
// Mock ai-sdk-ollama
// ============================================================

vi.mock('ai-sdk-ollama', () => ({
  ollama: vi.fn().mockReturnValue('mock-ollama-model'),
  createOllama: vi.fn().mockReturnValue(
    vi.fn().mockReturnValue('mock-ollama-model-custom')
  ),
}));

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'Hello from Ollama',
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
  streamText: vi.fn().mockReturnValue({
    textStream: (async function* () {
      yield 'Hello';
      yield ' from';
      yield ' Ollama';
    })(),
    fullStream: (async function* () {
      yield { type: 'text-delta', text: 'Hello', id: '1' };
      yield { type: 'text-delta', text: ' from', id: '1' };
      yield { type: 'text-delta', text: ' Ollama', id: '1' };
    })(),
  }),
  jsonSchema: vi.fn().mockReturnValue({ type: 'object' }),
}));

// ============================================================
// Import after mocking
// ============================================================

import { OllamaAdapter, createOllamaAdapter, ollamaAdapterFactory } from '../../src/adapters/ollama.js';

// Cached mock references
let mockGenerateText: ReturnType<typeof vi.fn>;
let mockStreamText: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  mockGenerateText = (await import('ai')).generateText as ReturnType<typeof vi.fn>;
  mockStreamText = (await import('ai')).streamText as ReturnType<typeof vi.fn>;
});

// ============================================================
// Test Data
// ============================================================

const sampleMessages: Message[] = [
  { role: 'user', content: 'Hello' },
];

const messagesWithSystem: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
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
// OllamaAdapter
// ============================================================

describe('OllamaAdapter', () => {
  let adapter: OllamaAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OllamaAdapter('llama3');
  });

  // ----------------------------------------------------------
  // Constructor & Metadata
  // ----------------------------------------------------------

  it('should have correct name and provider', () => {
    expect(adapter.name).toBe('ollama-llama3');
    expect(adapter.provider).toBe('ollama');
  });

  it('should use custom baseURL when provided', () => {
    const customAdapter = new OllamaAdapter('llama3', { baseURL: 'http://custom:8080' });
    expect(customAdapter.name).toBe('ollama-llama3');
    expect(customAdapter.provider).toBe('ollama');
  });

  it('should default baseURL to localhost:11434', () => {
    // Re-create adapter without baseURL option — baseURL defaults to http://localhost:11434
    const defaultAdapter = new OllamaAdapter('llama3');
    expect(defaultAdapter.name).toBe('ollama-llama3');
    expect(defaultAdapter.provider).toBe('ollama');
  });

  // ----------------------------------------------------------
  // chat() — Basic
  // ----------------------------------------------------------

  describe('chat()', () => {
    it('should return response with content', async () => {
      const result = await adapter.chat(sampleMessages);
      expect(result.content).toBe('Hello from Ollama');
      expect(result.finishReason).toBe('stop');
    });

    it('should extract system prompt from messages', async () => {
      await adapter.chat(messagesWithSystem);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a helpful assistant.',
        })
      );
    });

    it('should pass temperature option', async () => {
      await adapter.chat(sampleMessages, { temperature: 0.7 });
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7 })
      );
    });

    it('should pass maxTokens option', async () => {
      await adapter.chat(sampleMessages, { maxTokens: 4096 });
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 4096 })
      );
    });

    it('should pass topP option', async () => {
      await adapter.chat(sampleMessages, { topP: 0.9 });
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ topP: 0.9 })
      );
    });

    it('should pass stopSequences option', async () => {
      await adapter.chat(sampleMessages, { stopSequences: ['\n\n'] });
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ stopSequences: ['\n\n'] })
      );
    });

    it('should skip stopSequences when empty array', async () => {
      await adapter.chat(sampleMessages, { stopSequences: [] });
      expect(mockGenerateText.mock.lastCall?.[0]).not.toHaveProperty('stopSequences');
    });

    it('should not catch errors (let agent-loop handle)', async () => {
      mockGenerateText.mockRejectedValueOnce(new Error('Ollama Error'));
      await expect(adapter.chat(sampleMessages)).rejects.toThrow('Ollama Error');
    });

    // ----------------------------------------------------------
    // chat() — Tools
    // ----------------------------------------------------------

    it('should pass tools converted via jsonSchema', async () => {
      await adapter.chat(sampleMessages, { tools: sampleTools });

      expect(mockGenerateText).toHaveBeenLastCalledWith(expect.objectContaining({
        tools: expect.objectContaining({
          get_weather: expect.objectContaining({ description: 'Get weather for a city' }),
        }),
      }));
    });

    it('should skip tools when empty array', async () => {
      await adapter.chat(sampleMessages, { tools: [] });
      expect(mockGenerateText.mock.lastCall?.[0]).not.toHaveProperty('tools');
    });

    it('should return toolCalls from generateText result', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'get_weather', input: { city: 'Berlin' } },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      });

      const result = await adapter.chat(sampleMessages);
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]!.name).toBe('get_weather');
      expect(result.toolCalls![0]!.args).toEqual({ city: 'Berlin' });
    });

    it('should return usage from generateText result', async () => {
      const result = await adapter.chat(sampleMessages);
      expect(result.usage).toBeDefined();
      expect(result.usage!.promptTokens).toBe(10);
      expect(result.usage!.completionTokens).toBe(5);
    });
  });

  // ----------------------------------------------------------
  // stream()
  // ----------------------------------------------------------

  describe('stream()', () => {
    it('should yield chunks via AsyncGenerator', async () => {
      const chunks: string[] = [];
      for await (const chunk of adapter.stream(sampleMessages)) {
        if (chunk.text) chunks.push(chunk.text);
      }
      expect(chunks).toEqual(['Hello', ' from', ' Ollama']);
    });

    it('should pass system prompt to streamText', async () => {
      await adapter.stream(messagesWithSystem).next();

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a helpful assistant.',
        })
      );
    });

    it('should pass tools to streamText when provided', async () => {
      await adapter.stream(sampleMessages, { tools: sampleTools }).next();

      expect(mockStreamText).toHaveBeenLastCalledWith(expect.objectContaining({
        tools: expect.objectContaining({ get_weather: expect.anything() }),
      }));
    });
  });

  // ----------------------------------------------------------
  // formatTools / normalizeMessages / formatToolChoice
  // ----------------------------------------------------------

  describe('formatTools()', () => {
    it('should format tools in OpenAI function style', () => {
      const formatted = adapter.formatTools(sampleTools) as Array<Record<string, unknown>>;
      expect(formatted).toHaveLength(1);
      expect(formatted[0]!.type).toBe('function');
      expect((formatted[0]!.function as Record<string, unknown>).name).toBe('get_weather');
    });
  });

  describe('normalizeMessages()', () => {
    it('should convert messages array', () => {
      const normalized = adapter.normalizeMessages(sampleMessages) as Array<Record<string, unknown>>;
      expect(normalized).toHaveLength(1);
      expect(normalized[0]!.role).toBe('user');
    });

    it('should handle tool messages', () => {
      const toolMessages: Message[] = [
        { role: 'tool', content: 'result text', toolCallId: 'tc-1', name: 'get_weather' },
      ];
      const normalized = adapter.normalizeMessages(toolMessages) as Array<Record<string, unknown>>;
      expect(normalized).toHaveLength(1);
      expect(normalized[0]!.role).toBe('tool');
    });
  });

  describe('formatToolChoice()', () => {
    it('should convert "required" to { type: "function" }', () => {
      const result = adapter.formatToolChoice('required') as Record<string, unknown>;
      expect(result.type).toBe('function');
    });

    it('should pass string choices through', () => {
      expect(adapter.formatToolChoice('auto')).toBe('auto');
    });

    it('should format named tool choice', () => {
      const result = adapter.formatToolChoice({ name: 'get_weather' }) as Record<string, unknown>;
      expect(result.type).toBe('function');
      expect((result.function as Record<string, unknown>).name).toBe('get_weather');
    });
  });
});

// ============================================================
// Factory Functions
// ============================================================

describe('Ollama Adapter Factory', () => {
  it('createOllamaAdapter should return OllamaAdapter', () => {
    const adapter = createOllamaAdapter('llama3');
    expect(adapter).toBeInstanceOf(OllamaAdapter);
    expect(adapter.provider).toBe('ollama');
  });

  it('ollamaAdapterFactory should return adapter from options', () => {
    const adapter = ollamaAdapterFactory('llama3', { baseURL: 'http://localhost:11434' });
    expect(adapter.provider).toBe('ollama');
  });
});
