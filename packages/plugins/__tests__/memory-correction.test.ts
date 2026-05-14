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

/**
 * F-C RED tests: correctionEnabled is dead code.
 * When enabled, user correction signals should overwrite old entries on the same topic.
 */

describe('F-C: Memory correctionEnabled behavior', () => {
  describe('when correctionEnabled is true', () => {
    it('replaces old assistant entry when user sends a correction signal', async () => {
      const backend = new InMemoryBackend();
      const processor = createMemoryOutputProcessor({
        backend,
        triggerMode: { type: 'automatic', onLoad: 'always' },
        admissionPolicy: { correctionEnabled: true },
      });

      // Turn 1: agent gives an answer
      await processor.execute(makeContext({
        request: { input: 'What is the capital of France?', sessionId: 's-corr' },
        iteration: { step: 0, response: 'The capital is Paris.' },
      }));

      // Turn 2: user corrects — "actually" is a correction signal
      await processor.execute(makeContext({
        request: { input: 'Actually no, I meant Germany. What is the capital of Germany?', sessionId: 's-corr' },
        iteration: { step: 0, response: 'The capital of Germany is Berlin.' },
      }));

      const stored = await backend.retrieve('s-corr');

      // With correction enabled, the OLD assistant entry about France should be
      // removed or replaced, not kept alongside the new one.
      // Currently this will FAIL — correctionEnabled is dead code.
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

      // Turn 1
      await processor.execute(makeContext({
        request: { input: 'Tell me about X', sessionId: 's-meta' },
        iteration: { step: 0, response: 'X is a thing.' },
      }));

      // Turn 2: correction
      await processor.execute(makeContext({
        request: { input: 'No wait, I meant Y actually', sessionId: 's-meta' },
        iteration: { step: 0, response: 'Y is different.' },
      }));

      const stored = await backend.retrieve('s-meta');

      // The correction entry should have metadata marking it as a correction
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
        // correctionEnabled NOT set — default behavior keeps everything
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
      // Without correction, both assistant entries are kept
      expect(assistantEntries.length).toBe(2);
    });
  });
});
