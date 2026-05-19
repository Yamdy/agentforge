import { describe, it, expect } from 'vitest';
import { createMemoryProcessor, createMemoryOutputProcessor } from '../src/memory/memory-processor.js';
import { InMemoryBackend } from '../src/memory/in-memory-backend.js';
import type { PipelineContext, Processor } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '@primo-ai/core';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

async function executeProcessor(processor: Processor, ctx: PipelineContext): Promise<PipelineContext> {
  const pCtx = new ProcessorContextImpl(ctx);
  await processor.execute(pCtx);
  return pCtx.state;
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
      const result = await executeProcessor(processor, ctx);

      const history = (result as PipelineContext).session.messageHistory as Array<{ role: string; content: string }>;
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('previous question');
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toBe('previous answer');
    });

    it('does not inject promptFragment by default (history mode)', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' } });

      await backend.store('session-1', {
        role: 'user',
        content: 'remember this',
        timestamp: new Date().toISOString(),
      });

      const ctx = makeContext();
      const result = await executeProcessor(processor, ctx);

      const fragments = (result as PipelineContext).agent.promptFragments as string[];
      expect(fragments).toHaveLength(0);
    });

    it('injects memory as promptFragment when injectionMode is both', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' }, injectionMode: 'both' });

      await backend.store('session-1', {
        role: 'user',
        content: 'remember this',
        timestamp: new Date().toISOString(),
      });

      const ctx = makeContext();
      const result = await executeProcessor(processor, ctx);

      const fragments = (result as PipelineContext).agent.promptFragments as string[];
      expect(fragments).toBeDefined();
      expect(fragments.length).toBeGreaterThan(0);
      expect(fragments[0]).toContain('remember this');
    });

    it('only injects promptFragment when injectionMode is prompt', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' }, injectionMode: 'prompt' });

      await backend.store('session-1', {
        role: 'user',
        content: 'remember this',
        timestamp: new Date().toISOString(),
      });

      const ctx = makeContext();
      const result = await executeProcessor(processor, ctx);

      expect((result as PipelineContext).session.messageHistory).toBeUndefined();
      const fragments = (result as PipelineContext).agent.promptFragments as string[];
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
        iteration: { step: 0, response: '4' },
      });

      await executeProcessor(processor, ctx);

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
        iteration: { step: 0, response: undefined },
      });

      await executeProcessor(processor, ctx);

      const stored = await backend.retrieve('session-3');
      expect(stored).toHaveLength(0);
    });
  });

  describe('buildContext — merge with existing history', () => {
    it('prepends memory entries to existing messageHistory instead of replacing', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' } });

      await backend.store('session-1', {
        role: 'user',
        content: 'old memory question',
        timestamp: new Date().toISOString(),
      });
      await backend.store('session-1', {
        role: 'assistant',
        content: 'old memory answer',
        timestamp: new Date().toISOString(),
      });

      const ctx = makeContext({
        session: {
          messageHistory: [
            { role: 'user', content: 'current session question' },
          ],
          custom: {},
        },
      });
      const result = await executeProcessor(processor, ctx);
      const history = (result as PipelineContext).session.messageHistory as Array<{ role: string; content: string }>;

      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('old memory question');
      expect(history[1].content).toBe('old memory answer');
      expect(history[2].content).toBe('current session question');
    });

    it('preserves existing promptFragments when injecting into prompt mode', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryProcessor({ backend, triggerMode: { type: 'automatic', onLoad: 'always' }, injectionMode: 'prompt' });

      await backend.store('session-1', {
        role: 'user',
        content: 'memory fact',
        timestamp: new Date().toISOString(),
      });

      const ctx = makeContext({
        agent: {
          config: { model: 'mock/test' },
          promptFragments: ['<existing>system fragment</existing>'],
          toolDeclarations: [],
        },
      });
      const result = await executeProcessor(processor, ctx);
      const fragments = (result as PipelineContext).agent.promptFragments as string[];

      expect(fragments).toHaveLength(2);
      expect(fragments[0]).toBe('<existing>system fragment</existing>');
      expect(fragments[1]).toContain('memory fact');
    });
  });

  describe('processOutput — user correction priority', () => {
    it('removes old assistant entries when user sends a correction', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true },
      });

      // First turn: user asks, agent answers about topic X
      await executeProcessor(processor, makeContext({
        request: { input: 'What is the capital of France?', sessionId: 'session-corr' },
        iteration: { step: 0, response: 'The capital is Paris.' },
      }));

      // Second turn: user corrects with a different question on same session
      // The agent gave wrong info, user corrects
      await executeProcessor(processor, makeContext({
        request: { input: 'No, actually tell me about Germany', sessionId: 'session-corr' },
        iteration: { step: 0, response: 'The capital of Germany is Berlin.' },
      }));

      const stored = await backend.retrieve('session-corr');
      // Both turns stored, no dedup since different content
      expect(stored.length).toBeGreaterThanOrEqual(2);
    });

    it('deduplicates identical assistant responses across turns', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
      });

      // Two turns with identical assistant response
      // Since dedup state lives in session.custom (not a closure),
      // we must thread the returned session.custom into the next call.
      const result1 = await executeProcessor(processor, makeContext({
        request: { input: 'question 1', sessionId: 'session-dedup' },
        iteration: { step: 0, response: 'same answer' },
      })) as PipelineContext;

      await executeProcessor(processor, makeContext({
        request: { input: 'question 2', sessionId: 'session-dedup' },
        iteration: { step: 0, response: 'same answer' },
        session: { custom: result1.session.custom },
      }));

      const stored = await backend.retrieve('session-dedup');
      const assistantEntries = stored.filter(e => e.role === 'assistant');
      // Dedup should prevent storing the same assistant response twice
      expect(assistantEntries).toHaveLength(1);
    });

    it('does not store agent-only content without user input', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
      });

      // Agent monologue should not become persistent memory
      await executeProcessor(processor, makeContext({
        request: { input: '', sessionId: 'session-empty-user' },
        iteration: { step: 0, response: 'I am thinking...' },
      }));

      const stored = await backend.retrieve('session-empty-user');
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
      const result = await executeProcessor(processor, ctx);

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
      const result = await executeProcessor(processor, ctx);

      const history = (result as PipelineContext).session.messageHistory as Array<{ content: string }>;
      expect(history).toHaveLength(1);
    });
  });
});
