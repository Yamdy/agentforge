/**
 * Unit tests for Google Gemini Adapter
 *
 * Tests: GoogleAdapter class, factory functions, error handling.
 * All API calls are mocked via vi.fn() — no network access required.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { Message } from '../../src/core/interfaces.js';

// ============================================================
// Mock @ai-sdk/google
// ============================================================

vi.mock('@ai-sdk/google', () => ({
  google: vi.fn().mockReturnValue('mock-google-model'),
  createGoogleGenerativeAI: vi.fn().mockReturnValue(
    vi.fn().mockReturnValue('mock-google-model-custom')
  ),
}));

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({
    text: 'Hello from Gemini',
    finishReason: 'stop',
    usage: { inputTokens: 10, completionTokens: 5 },
  }),
  streamText: vi.fn().mockReturnValue({
    textStream: (async function* () {
      yield 'Hello';
      yield ' from';
      yield ' Gemini';
    })(),
  }),
  jsonSchema: vi.fn().mockReturnValue({ type: 'object' }),
}));

// ============================================================
// Import after mocking
// ============================================================

import { GoogleAdapter, createGoogleAdapter, googleAdapterFactory } from '../../src/adapters/google.js';

// ============================================================
// Test Data
// ============================================================

let mockGenerateText: ReturnType<typeof vi.fn>;
let mockStreamText: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  mockGenerateText = (await import('ai')).generateText as ReturnType<typeof vi.fn>;
  mockStreamText = (await import('ai')).streamText as ReturnType<typeof vi.fn>;
});

const sampleMessages: Message[] = [
  { role: 'user', content: 'Hello' },
];

const messagesWithSystem: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello' },
];

// ============================================================
// GoogleAdapter
// ============================================================

describe('GoogleAdapter', () => {
  let adapter: GoogleAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GoogleAdapter('gemini-2.0-flash', { apiKey: 'test-key' });
  });

  it('should have correct name and provider', () => {
    expect(adapter.name).toBe('google-gemini-2.0-flash');
    expect(adapter.provider).toBe('google');
  });

  describe('chat()', () => {
    it('should return response with content', async () => {
      const result = await adapter.chat(sampleMessages);
      expect(result.content).toBe('Hello from Gemini');
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

    it('should pass temperature and maxTokens options', async () => {
      await adapter.chat(sampleMessages, { temperature: 0.7, maxTokens: 100 });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          maxTokens: 100,
        })
      );
    });

    it('should not catch errors (let agent-loop handle)', async () => {
      vi.mocked(mockGenerateText).mockRejectedValueOnce(new Error('API Error'));
      
      await expect(adapter.chat(sampleMessages)).rejects.toThrow('API Error');
    });
  });

  describe('stream()', () => {
    it('should yield chunks via AsyncGenerator', async () => {
      const chunks: string[] = [];
      for await (const chunk of adapter.stream(sampleMessages)) {
        if (chunk.text) chunks.push(chunk.text);
      }
      expect(chunks).toEqual(['Hello', ' from', ' Gemini']);
    });

    it('should throw errors from stream', async () => {
      vi.mocked(mockStreamText).mockReturnValueOnce({
        textStream: (async function* () {
          throw new Error('Stream Error');
        })(),
      } as any);

      await expect(async () => {
        for await (const _chunk of adapter.stream(sampleMessages)) {
          // should throw before yielding
        }
      }).rejects.toThrow('Stream Error');
    });
  });
});

// ============================================================
// Factory Functions
// ============================================================

describe('Google Adapter Factory', () => {
  it('createGoogleAdapter should return GoogleAdapter', () => {
    const adapter = createGoogleAdapter('gemini-pro');
    expect(adapter).toBeInstanceOf(GoogleAdapter);
    expect(adapter.provider).toBe('google');
  });

  it('googleAdapterFactory should return adapter from options', () => {
    const adapter = googleAdapterFactory('gemini-pro', { apiKey: 'key' });
    expect(adapter.provider).toBe('google');
  });
});
