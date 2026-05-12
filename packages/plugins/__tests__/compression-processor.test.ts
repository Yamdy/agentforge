import { describe, it, expect } from 'vitest';
import { createCompressionProcessor } from '../src/compression/compression-processor.js';
import { compressionPlugin } from '../src/compression/index.js';
import type { PipelineContext, HarnessAPI, PluginRegistration } from '@agentforge/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

type Message = { role: string; content: string };

describe('CompressionProcessor', () => {
  describe('truncate phase', () => {
    it('truncates tool outputs longer than maxLength', async () => {
      const processor = createCompressionProcessor({
        maxContextTokens: 10,
        phases: [{ type: 'truncate', maxLength: 10 }],
      });

      const longContent = 'a'.repeat(100);
      const ctx = makeContext({
        session: {
          messageHistory: [
            { role: 'user', content: 'short' },
            { role: 'tool', content: longContent },
            { role: 'assistant', content: 'ok' },
          ],
          custom: {},
        },
      });

      const result = await processor.execute(ctx);
      const history = (result as PipelineContext).session.messageHistory as Message[];

      expect(history).toHaveLength(3);
      expect(history[1].role).toBe('tool');
      expect(history[1].content.length).toBeLessThanOrEqual(10);
      // Other messages untouched
      expect(history[0].content).toBe('short');
      expect(history[2].content).toBe('ok');
    });

    it('does not truncate messages shorter than maxLength', async () => {
      const processor = createCompressionProcessor({
        maxContextTokens: 50,
        phases: [{ type: 'truncate', maxLength: 100 }],
      });

      const ctx = makeContext({
        session: {
          messageHistory: [
            { role: 'user', content: 'short message' },
          ],
          custom: {},
        },
      });

      const result = await processor.execute(ctx);
      const history = (result as PipelineContext).session.messageHistory as Message[];

      expect(history[0].content).toBe('short message');
    });
  });

  describe('prune phase', () => {
    it('removes oldest messages keeping only recent N', async () => {
      const processor = createCompressionProcessor({
        maxContextTokens: 5,
        phases: [{ type: 'prune', keepRecent: 2 }],
      });

      const messages: Message[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({ role: 'user', content: `message ${i}` });
      }

      const ctx = makeContext({
        session: { messageHistory: messages, custom: {} },
      });

      const result = await processor.execute(ctx);
      const history = (result as PipelineContext).session.messageHistory as Message[];

      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('message 8');
      expect(history[1].content).toBe('message 9');
    });
  });

  describe('threshold check', () => {
    it('does nothing when token count is under maxContextTokens', async () => {
      const processor = createCompressionProcessor({
        maxContextTokens: 1000,
        phases: [
          { type: 'truncate', maxLength: 5 },
          { type: 'prune', keepRecent: 1 },
        ],
      });

      const messages: Message[] = [
        { role: 'user', content: 'hello world' },
        { role: 'assistant', content: 'hi there' },
      ];

      const ctx = makeContext({
        session: { messageHistory: messages, custom: {} },
      });

      const result = await processor.execute(ctx);
      const history = (result as PipelineContext).session.messageHistory as Message[];

      // Nothing compressed — messages untouched
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('hello world');
      expect(history[1].content).toBe('hi there');
    });

    it('returns original context when no message history exists', async () => {
      const processor = createCompressionProcessor({
        maxContextTokens: 10,
        phases: [{ type: 'prune', keepRecent: 1 }],
      });

      const ctx = makeContext();
      const result = await processor.execute(ctx);

      expect((result as PipelineContext).session.messageHistory).toBeUndefined();
    });
  });

  describe('summarize phase', () => {
    it('replaces old messages with LLM summary when truncate/prune insufficient', async () => {
      const summaryText = 'Summary of earlier conversation';
      const summarizeFn = async (_messages: Message[]): Promise<string> => summaryText;

      const processor = createCompressionProcessor({
        maxContextTokens: 5,
        phases: [
          { type: 'summarize', model: 'test', maxTokens: 100, summarizeFn },
        ],
      });

      const messages: Message[] = [
        { role: 'user', content: 'old question one' },
        { role: 'assistant', content: 'old answer one' },
        { role: 'user', content: 'old question two' },
        { role: 'assistant', content: 'old answer two' },
        { role: 'user', content: 'recent question' },
      ];

      const ctx = makeContext({
        session: { messageHistory: messages, custom: {} },
      });

      const result = await processor.execute(ctx);
      const history = (result as PipelineContext).session.messageHistory as Message[];

      // First message should be the summary
      expect(history[0].role).toBe('assistant');
      expect(history[0].content).toBe(summaryText);
      // Summary replaces all original messages
      expect(history.length).toBeLessThan(messages.length);
    });

    it('does not trigger summarize when under threshold', async () => {
      let called = false;
      const summarizeFn = async (_messages: Message[]): Promise<string> => {
        called = true;
        return 'summary';
      };

      const processor = createCompressionProcessor({
        maxContextTokens: 10000,
        phases: [
          { type: 'summarize', model: 'test', maxTokens: 100, summarizeFn },
        ],
      });

      const ctx = makeContext({
        session: {
          messageHistory: [{ role: 'user', content: 'hello' }],
          custom: {},
        },
      });

      await processor.execute(ctx);
      expect(called).toBe(false);
    });
  });

  describe('compression metrics', () => {
    it('records compression metrics as span attributes', async () => {
      const attributes: Record<string, unknown> = {};
      const mockSpan = {
        name: 'test',
        setAttribute: (key: string, value: unknown) => { attributes[key] = value; return mockSpan; },
        startChild: () => mockSpan,
        end: () => {},
        addEvent: () => mockSpan,
      };

      const processor = createCompressionProcessor({
        maxContextTokens: 5,
        phases: [{ type: 'prune', keepRecent: 1 }],
      });

      const messages: Message[] = [
        { role: 'user', content: 'message one that is long' },
        { role: 'assistant', content: 'response one that is also long' },
        { role: 'user', content: 'message two' },
      ];

      const ctx = makeContext({
        session: { messageHistory: messages, custom: {} },
        iteration: { step: 0, span: mockSpan as any },
      });

      await processor.execute(ctx);

      expect(attributes['compression.triggered']).toBe(true);
      expect(attributes['compression.phases_applied']).toBe(1);
      expect(attributes['compression.tokens_before']).toBeGreaterThan(0);
      expect(attributes['compression.tokens_after']).toBeLessThan(
        attributes['compression.tokens_before'] as number,
      );
    });
  });
});

describe('compressionPlugin', () => {
  function createHarnessAPI(): { api: HarnessAPI; processors: Map<string, unknown> } {
    const processors = new Map<string, unknown>();
    const api: HarnessAPI = {
      registerProcessor: (stage, processor) => { processors.set(stage, processor); },
      registerTool: () => {},
      registerCommand: () => {},
      registerHook: () => {},
      subscribe: () => () => {},
      registerResource: () => {},
      registerProvider: () => {},
    };
    return { api, processors };
  }

  it('registers a processor at prepareStep stage', () => {
    const { api, processors } = createHarnessAPI();
    const registration = compressionPlugin({
      maxContextTokens: 1000,
      phases: [{ type: 'prune', keepRecent: 10 }],
    })(api);

    expect(processors.has('prepareStep')).toBe(true);
    expect(registration.processors).toHaveLength(1);
  });

  it('end-to-end: plugin processor compresses long conversation', async () => {
    const { api, processors } = createHarnessAPI();
    compressionPlugin({
      maxContextTokens: 10,
      phases: [{ type: 'prune', keepRecent: 2 }],
    })(api);

    const processor = processors.get('prepareStep') as { execute: (ctx: PipelineContext) => Promise<PipelineContext> };

    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user', content: `message ${i}` });
    }

    const ctx = makeContext({ session: { messageHistory: messages, custom: {} } });
    const result = await processor.execute(ctx);
    const history = result.session.messageHistory as Message[];

    expect(history).toHaveLength(2);
    expect(history[0].content).toBe('message 18');
    expect(history[1].content).toBe('message 19');
  });
});
