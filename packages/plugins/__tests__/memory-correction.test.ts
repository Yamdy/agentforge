import { describe, it, expect } from 'vitest';
import { createMemoryOutputProcessor } from '../src/memory/memory-processor.js';
import { InMemoryBackend } from '../src/memory/in-memory-backend.js';
import type { PipelineContext } from '@agentforge/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

describe('F-C: Memory correctionEnabled behavior', () => {
  describe('when correctionEnabled is true', () => {
    it('replaces old assistant entry when user sends a correction signal', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true },
      });

      await processor.execute(makeContext({
        request: { input: 'What is the capital of France?', sessionId: 's-corr' },
        iteration: { step: 0, response: 'The capital is Paris.' },
      }));

      await processor.execute(makeContext({
        request: { input: 'Actually no, I meant Germany. What is the capital of Germany?', sessionId: 's-corr' },
        iteration: { step: 0, response: 'The capital of Germany is Berlin.' },
      }));

      const stored = await backend.retrieve('s-corr');
      const assistantEntries = stored.filter(e => e.role === 'assistant');
      expect(assistantEntries.length).toBe(1);
      expect(assistantEntries[0].content).toBe('The capital of Germany is Berlin.');
    });

    it('marks overwritten entries with correction metadata', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true },
      });

      await processor.execute(makeContext({
        request: { input: 'Tell me about X', sessionId: 's-meta' },
        iteration: { step: 0, response: 'X is a thing.' },
      }));

      await processor.execute(makeContext({
        request: { input: 'No wait, I meant Y actually', sessionId: 's-meta' },
        iteration: { step: 0, response: 'Y is different.' },
      }));

      const stored = await backend.retrieve('s-meta');
      const userCorrection = stored.find(
        e => e.role === 'user' && e.content.includes('actually'),
      );
      expect(userCorrection?.metadata?.corrected).toBe(true);
    });
  });

  describe('when correctionEnabled is false or undefined', () => {
    it('keeps all entries without replacement', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
      });

      await processor.execute(makeContext({
        request: { input: 'What is the capital of France?', sessionId: 's-nocorr' },
        iteration: { step: 0, response: 'The capital is Paris.' },
      }));

      await processor.execute(makeContext({
        request: { input: 'Actually, tell me about Germany', sessionId: 's-nocorr' },
        iteration: { step: 0, response: 'The capital of Germany is Berlin.' },
      }));

      const stored = await backend.retrieve('s-nocorr');
      const assistantEntries = stored.filter(e => e.role === 'assistant');
      expect(assistantEntries.length).toBe(2);
    });
  });
});

describe('F-13: Multilingual and cross-session memory correction', () => {
  describe('multilingual correction signals', () => {
    it('detects Chinese correction signal (不对)', async () => {
      const backend = new InMemoryBackend();
      await backend.store('s-zh', { role: 'assistant', content: 'wrong answer', timestamp: '2026-01-01T00:00:00Z' });

      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true },
      });

      await processor.execute(makeContext({
        request: { input: '不对，应该是 bar', sessionId: 's-zh' },
        iteration: { step: 0, response: 'bar is correct' },
      }));

      const remaining = await backend.retrieve('s-zh');
      const assistants = remaining.filter(e => e.role === 'assistant');
      expect(assistants).toHaveLength(1);
      expect(assistants[0].content).toBe('bar is correct');
    });

    it('detects Chinese correction signal (不是)', async () => {
      const backend = new InMemoryBackend();
      await backend.store('s-zh2', { role: 'assistant', content: 'wrong', timestamp: '2026-01-01T00:00:00Z' });

      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true },
      });

      await processor.execute(makeContext({
        request: { input: '不是的，正确答案是 baz', sessionId: 's-zh2' },
        iteration: { step: 0, response: 'baz is right' },
      }));

      const remaining = await backend.retrieve('s-zh2');
      const oldAssistants = remaining.filter(e => e.role === 'assistant' && e.content === 'wrong');
      expect(oldAssistants).toHaveLength(0);
    });

    it('detects Japanese correction signal (違います)', async () => {
      const backend = new InMemoryBackend();
      await backend.store('s-ja', { role: 'assistant', content: 'wrong', timestamp: '2026-01-01T00:00:00Z' });

      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true },
      });

      await processor.execute(makeContext({
        request: { input: '違います、正しくは qux', sessionId: 's-ja' },
        iteration: { step: 0, response: 'qux is right' },
      }));

      const remaining = await backend.retrieve('s-ja');
      const oldAssistants = remaining.filter(e => e.role === 'assistant' && e.content === 'wrong');
      expect(oldAssistants).toHaveLength(0);
    });
  });

  describe('cross-session correction', () => {
    it('cleans assistant entries across all sessions when crossSessionCorrection enabled', async () => {
      const backend = new InMemoryBackend();
      await backend.store('s-other', { role: 'assistant', content: 'stale answer', timestamp: '2026-01-01T00:00:00Z' });
      await backend.store('s-other', { role: 'user', content: 'a question', timestamp: '2026-01-01T00:01:00Z' });

      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true, crossSessionCorrection: true },
      });

      await processor.execute(makeContext({
        request: { input: 'Actually that was wrong', sessionId: 's-curr' },
        iteration: { step: 0, response: 'corrected answer' },
      }));

      const sOther = await backend.retrieve('s-other');
      const sOtherAssistants = sOther.filter(e => e.role === 'assistant');
      expect(sOtherAssistants).toHaveLength(0);
    });

    it('does not clean other sessions when crossSessionCorrection disabled', async () => {
      const backend = new InMemoryBackend();
      await backend.store('s-other2', { role: 'assistant', content: 'keep me', timestamp: '2026-01-01T00:00:00Z' });

      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true },
      });

      await processor.execute(makeContext({
        request: { input: 'Actually that was wrong', sessionId: 's-curr2' },
        iteration: { step: 0, response: 'corrected' },
      }));

      const sOther = await backend.retrieve('s-other2');
      expect(sOther).toHaveLength(1);
      expect(sOther[0].content).toBe('keep me');
    });
  });
});
