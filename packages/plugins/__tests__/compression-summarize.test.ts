import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Message } from '@primo-ai/sdk';
import { TiktokenCounter } from '@primo-ai/core';

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `message ${i}`,
  }));
}

const mockLLM = (responseText: string) => () => ({
  invoke: async () => ({ response: responseText, tokenUsage: null }),
});

// ---------------------------------------------------------------------------
// createSummarizeFn
// ---------------------------------------------------------------------------
describe('createSummarizeFn — summarize function behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. structured sections
  describe('structured sections', () => {
    it('includes all required sections in the system prompt', async () => {
      const { createSummarizeFn } = await import(
        '../src/compression/compression-processor.js'
      );
      let systemMessage = '';
      const getLLM = () => ({
        invoke: async (
          input: { messages: { role: string; content: string }[] },
        ) => {
          systemMessage =
            input.messages.find((m) => m.role === 'system')?.content ?? '';
          return { response: 'summary', tokenUsage: null };
        },
      });
      const fn = createSummarizeFn(getLLM);
      await fn([{ role: 'user', content: 'hello' }]);

      expect(systemMessage).toContain('Goal');
      expect(systemMessage).toContain('Constraints');
      expect(systemMessage).toContain('Progress');
      expect(systemMessage).toContain('Key Decisions');
      expect(systemMessage).toContain('Next Steps');
      expect(systemMessage).toContain('Critical Context');
    });
  });

  // 2. long conversation
  describe('long conversation', () => {
    it('passes all messages into the LLM prompt', async () => {
      const { createSummarizeFn } = await import(
        '../src/compression/compression-processor.js'
      );
      let userContent = '';
      const getLLM = () => ({
        invoke: async (
          input: { messages: { role: string; content: string }[] },
        ) => {
          userContent =
            input.messages.find((m) => m.role === 'user')?.content ?? '';
          return { response: 'summary', tokenUsage: null };
        },
      });
      const fn = createSummarizeFn(getLLM);
      const messages = makeMessages(30);
      await fn(messages);

      // Every message appears in the prompt
      for (let i = 0; i < 30; i++) {
        expect(userContent).toContain(`message ${i}`);
      }
    });

    it('returns a single condensed summary rather than the full conversation', async () => {
      const { createSummarizeFn } = await import(
        '../src/compression/compression-processor.js'
      );
      const summaryText =
        'Condensed summary of long conversation covering all key points.';
      const fn = createSummarizeFn(mockLLM(summaryText));
      const messages = makeMessages(100);
      const result = await fn(messages);

      expect(result).toBe(summaryText);
      expect(result.length).toBeLessThan(200);
    });
  });

  // 3. non-English content
  describe('non-English content', () => {
    it('handles Chinese (Simplified) content', async () => {
      const { createSummarizeFn } = await import(
        '../src/compression/compression-processor.js'
      );
      let userContent = '';
      const getLLM = () => ({
        invoke: async (
          input: { messages: { role: string; content: string }[] },
        ) => {
          userContent =
            input.messages.find((m) => m.role === 'user')?.content ?? '';
          return { response: '中文总结', tokenUsage: null };
        },
      });
      const fn = createSummarizeFn(getLLM);
      const messages: Message[] = [
        {
          role: 'user',
          content: '你好，我想了解这个项目的架构设计',
        },
        {
          role: 'assistant',
          content: '这个项目采用模块化架构，核心是处理器管道模型',
        },
      ];
      const result = await fn(messages);

      expect(userContent).toContain('你好');
      expect(userContent).toContain('模块化架构');
      expect(result).toBe('中文总结');
    });

    it('handles Japanese content', async () => {
      const { createSummarizeFn } = await import(
        '../src/compression/compression-processor.js'
      );
      let userContent = '';
      const getLLM = () => ({
        invoke: async (
          input: { messages: { role: string; content: string }[] },
        ) => {
          userContent =
            input.messages.find((m) => m.role === 'user')?.content ?? '';
          return { response: '日本語の要約', tokenUsage: null };
        },
      });
      const fn = createSummarizeFn(getLLM);
      const messages: Message[] = [
        {
          role: 'user',
          content: 'こんにちは、このプロジェクトの設計について教えてください',
        },
        {
          role: 'assistant',
          content: 'このプロジェクトはモジュール式のアーキテクチャを採用しています',
        },
      ];
      const result = await fn(messages);

      expect(userContent).toContain('こんにちは');
      expect(userContent).toContain('モジュール式');
      expect(result).toBe('日本語の要約');
    });
  });

  // 4. undefined model
  describe('model defaults', () => {
    it('gracefully defaults to "default" when model is undefined', async () => {
      const { createSummarizeFn } = await import(
        '../src/compression/compression-processor.js'
      );
      const modelArgs: string[] = [];
      const getLLM = (model: string) => {
        modelArgs.push(model);
        return { invoke: async () => ({ response: 'summary', tokenUsage: null }) };
      };
      const fn = createSummarizeFn(getLLM, undefined);
      await fn([{ role: 'user', content: 'test' }]);
      expect(modelArgs).toContain('default');
    });
  });
});

// ---------------------------------------------------------------------------
// createCompressionStrategy — summarize integration
// ---------------------------------------------------------------------------
describe('createCompressionStrategy — summarize integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 5. end-to-end: prune + summarize chain
  describe('prune + summarize chain', () => {
    it('prunes first then summarizes the remaining messages', async () => {
      const { createCompressionStrategy } = await import(
        '../src/compression/compression-processor.js'
      );

      const capturedInput: Message[][] = [];
      const summarizeFn = async (messages: Message[]): Promise<string> => {
        capturedInput.push(messages);
        return 'Summary after prune';
      };

      const tc = new TiktokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 10000,
        phases: [
          { type: 'prune', keepRecent: 5 },
          { type: 'summarize', model: 'test', maxTokens: 100, summarizeFn },
        ],
      });

      const messages = makeMessages(20);
      const result = await strategy(messages, tc, 1);

      // SummarizeFn receives only the 5 messages that survived pruning
      expect(capturedInput).toHaveLength(1);
      expect(capturedInput[0]).toHaveLength(5);

      // Final output is a single assistant summary message
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Summary after prune');
    });

    it('skips summarize when prune alone fits within budget', async () => {
      const { createCompressionStrategy } = await import(
        '../src/compression/compression-processor.js'
      );

      const summarizeSpy = vi.fn(async (_msgs: Message[]) => 'summary');
      const tc = new TiktokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 10000,
        phases: [
          { type: 'prune', keepRecent: 3 },
          { type: 'summarize', model: 'test', maxTokens: 100, summarizeFn: summarizeSpy },
        ],
      });

      const messages = makeMessages(10);
      // budget = 0 means totalTokens (10 msgs) > 0 → bypass threshold → prune+summarize run
      const result = await strategy(messages, tc, 0);

      // summarize was called with the pruned messages
      expect(summarizeSpy).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });
  });

  // 6. summarizeFn not provided
  describe('missing summarizeFn', () => {
    it('passes messages through unchanged when summarizeFn is absent', async () => {
      const { createCompressionStrategy } = await import(
        '../src/compression/compression-processor.js'
      );
      const tc = new TiktokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 10000,
        phases: [{ type: 'summarize', model: 'test', maxTokens: 100 }],
      });

      const messages = makeMessages(5);
      const result = await strategy(messages, tc, 0);

      // Still the same 5 messages — summarize was a no-op
      expect(result).toEqual(messages);
    });

    it('emits a console.warn when summarize phase is configured without summarizeFn', async () => {
      const { createCompressionStrategy } = await import(
        '../src/compression/compression-processor.js'
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tc = new TiktokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 10000,
        phases: [{ type: 'summarize', model: 'test', maxTokens: 100 }],
      });

      await strategy(makeMessages(5), tc, 0);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('summarizeFn'),
      );
      warnSpy.mockRestore();
    });
  });

  // Edge cases for applySummarize
  describe('applySummarize edge cases', () => {
    it('passes through when there is only one message', async () => {
      const { createCompressionStrategy } = await import(
        '../src/compression/compression-processor.js'
      );

      const summarizeSpy = vi.fn(async (_msgs: Message[]) => 'summary');
      const tc = new TiktokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 10000,
        phases: [
          { type: 'summarize', model: 'test', maxTokens: 100, summarizeFn: summarizeSpy },
        ],
      });

      const messages: Message[] = [{ role: 'user', content: 'single message' }];
      const result = await strategy(messages, tc, 0);

      // Single message passes through without calling summarizeFn
      // (applySummarize returns early when messages.length <= 1)
      expect(result).toEqual(messages);
      expect(summarizeSpy).not.toHaveBeenCalled();
    });

    it('handles empty message array', async () => {
      const { createCompressionStrategy } = await import(
        '../src/compression/compression-processor.js'
      );

      const summarizeSpy = vi.fn(async (_msgs: Message[]) => 'summary');
      const tc = new TiktokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 10000,
        phases: [
          { type: 'summarize', model: 'test', maxTokens: 100, summarizeFn: summarizeSpy },
        ],
      });

      const result = await strategy([], tc, 0);

      expect(result).toEqual([]);
      expect(summarizeSpy).not.toHaveBeenCalled();
    });
  });
});
