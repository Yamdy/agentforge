import { describe, it, expect } from 'vitest';
import { createMemoryProcessor, createMemoryOutputProcessor } from '../src/memory/memory-processor.js';
import { InMemoryBackend } from '../src/memory/in-memory-backend.js';
import type { PipelineContext } from '@agentforge/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    iteration: { step: 0 },
    pipeline: {},
    session: {},
    config: {},
    ...overrides,
  };
}

describe('MemoryProcessor', () => {
  describe('buildContext — load history', () => {
    it('loads memory entries into session.messageHistory at buildContext', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' } });

      // Pre-seed memory
      await backend.store('session-1', {
        role: 'user',
        content: 'previous question',
        timestamp: new Date().toISOString(),
      });
      await backend.store('session-1', {
        role: 'assistant',
        content: 'previous answer',
        timestamp: new Date().toISOString(),
      });

      const ctx = makeContext();
      const result = await processor.execute(ctx);

      const history = (result as PipelineContext).session.messageHistory as Array<{ role: string; content: string }>;
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('previous question');
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toBe('previous answer');
    });

    it('injects memory as promptFragment in pipeline', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' } });

      await backend.store('session-1', {
        role: 'user',
        content: 'remember this',
        timestamp: new Date().toISOString(),
      });

      const ctx = makeContext();
      const result = await processor.execute(ctx);

      const fragments = (result as PipelineContext).pipeline.promptFragments as string[];
      expect(fragments).toBeDefined();
      expect(fragments.length).toBeGreaterThan(0);
      expect(fragments[0]).toContain('remember this');
    });
  });

  describe('processOutput — save turn', () => {
    it('records user message and assistant response at processOutput', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' } });

      const ctx = makeContext({
        request: { input: 'What is 2+2?', sessionId: 'session-2' },
        pipeline: { response: '4' },
      });

      await processor.execute(ctx);

      const stored = await backend.retrieve('session-2');
      expect(stored).toHaveLength(2);
      expect(stored[0].role).toBe('user');
      expect(stored[0].content).toBe('What is 2+2?');
      expect(stored[1].role).toBe('assistant');
      expect(stored[1].content).toBe('4');
    });

    it('skips recording when response is empty', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' } });

      const ctx = makeContext({
        request: { input: 'hello', sessionId: 'session-3' },
        pipeline: { response: undefined },
      });

      await processor.execute(ctx);

      const stored = await backend.retrieve('session-3');
      expect(stored).toHaveLength(0);
    });
  });

  describe('window limit', () => {
    it('limits loaded messages to configured windowLimit', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        windowLimit: 2,
      });

      // Store 5 entries
      for (let i = 0; i < 5; i++) {
        await backend.store('session-1', {
          role: 'user',
          content: `msg-${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        });
      }

      const ctx = makeContext();
      const result = await processor.execute(ctx);

      const history = (result as PipelineContext).session.messageHistory as Array<{ content: string }>;
      expect(history).toHaveLength(2);
      // Should get the LATEST 2 entries
      expect(history[0].content).toBe('msg-3');
      expect(history[1].content).toBe('msg-4');
    });

    it('returns all entries when under windowLimit', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        windowLimit: 10,
      });

      await backend.store('session-1', {
        role: 'user',
        content: 'only one',
        timestamp: new Date().toISOString(),
      });

      const ctx = makeContext();
      const result = await processor.execute(ctx);

      const history = (result as PipelineContext).session.messageHistory as Array<{ content: string }>;
      expect(history).toHaveLength(1);
    });
  });
});
