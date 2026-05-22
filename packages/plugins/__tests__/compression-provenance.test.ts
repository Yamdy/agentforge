import { describe, it, expect } from 'vitest';
import { createCompressionStrategy, createSummarizeFn } from '../src/compression/compression-processor.js';

describe('Compression provenance', () => {
  it('summarized messages are marked with source: distilled', async () => {
    const summarize = createSummarizeFn(
      (model) => ({
        invoke: async () => ({ response: 'Summary of conversation.', tokenUsage: { inputTokens: 10, outputTokens: 3 } }),
      }),
      'test-model',
    );

    const strategy = createCompressionStrategy({
      maxContextTokens: 1000,
      phases: [{ type: 'summarize', model: 'test-model', maxTokens: 500, summarizeFn: summarize }],
    });

    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
      { role: 'user' as const, content: 'Help me with something long...' },
      { role: 'assistant' as const, content: 'Sure, let me help.' },
    ];

    const counter = { count: (s: string) => s.length, countMessages: (msgs: Array<{content:string}>) => msgs.reduce((a,m)=>a+m.content.length,0) };
    const result = await strategy(messages, counter, 10); // force compression

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('Summary of conversation.');
    expect(result[0].source).toBe('distilled');
  });

  it('truncated messages do not have source field', async () => {
    const strategy = createCompressionStrategy({
      maxContextTokens: 1000,
      phases: [{ type: 'truncate', maxTokens: 50 }],
    });

    const messages = [
      { role: 'user' as const, content: 'A'.repeat(200) },
      { role: 'assistant' as const, content: 'B'.repeat(200) },
    ];

    const counter = { count: (s: string) => s.length, countMessages: (msgs: Array<{content:string}>) => msgs.reduce((a,m)=>a+m.content.length,0) };
    const result = await strategy(messages, counter, 100);
    expect(result.length).toBeGreaterThan(0);
    // Normal truncation should not add source
    for (const msg of result) {
      expect((msg as Record<string,unknown>).source).toBeUndefined();
    }
  });
});
