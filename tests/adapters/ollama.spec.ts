/**
 * Unit tests for Ollama Adapter
 *
 * Tests: OllamaAdapter class, factory functions, error handling.
 * All API calls are mocked via vi.fn() — no network access required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '../../src/core/interfaces.js';

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
    usage: { inputTokens: 10, completionTokens: 5 },
  }),
  streamText: vi.fn().mockReturnValue({
    textStream: (async function* () {
      yield 'Hello';
      yield ' from';
      yield ' Ollama';
    })(),
  }),
  jsonSchema: vi.fn().mockReturnValue({ type: 'object' }),
}));

// ============================================================
// Import after mocking
// ============================================================

import { OllamaAdapter, createOllamaAdapter, ollamaAdapterFactory } from '../../src/adapters/ollama.js';

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

// ============================================================
// OllamaAdapter
// ============================================================

describe('OllamaAdapter', () => {
  let adapter: OllamaAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OllamaAdapter('llama3');
  });

  it('should have correct name and provider', () => {
    expect(adapter.name).toBe('ollama-llama3');
    expect(adapter.provider).toBe('ollama');
  });

  describe('chat()', () => {
    it('should return response with content', async () => {
      const result = await adapter.chat(sampleMessages);
      expect(result.content).toBe('Hello from Ollama');
      expect(result.finishReason).toBe('stop');
    });

    it('should extract system prompt from messages', async () => {
      const { generateText } = await import('ai');
      await adapter.chat(messagesWithSystem);
      
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a helpful assistant.',
        })
      );
    });

    it('should not catch errors (let agent-loop handle)', async () => {
      const { generateText } = await import('ai');
      vi.mocked(generateText).mockRejectedValueOnce(new Error('Ollama Error'));
      
      await expect(adapter.chat(sampleMessages)).rejects.toThrow('Ollama Error');
    });
  });

  describe('stream()', () => {
    it('should yield chunks via AsyncGenerator', async () => {
      const chunks: string[] = [];
      for await (const chunk of adapter.stream(sampleMessages)) {
        if (chunk.text) chunks.push(chunk.text);
      }
      expect(chunks).toEqual(['Hello', ' from', ' Ollama']);
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
