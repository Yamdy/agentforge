import { describe, it, expect } from 'vitest';
import { createMemoryOutputProcessor } from '../src/memory/memory-processor.js';
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

/**
 * Simulates suspend/resume by creating a fresh processor and restoring
 * session.custom from the previous run. In a real suspend/resume cycle,
 * the closure variable `lastAssistantContent` would be lost, but the
 * session.custom region is serialized and restored.
 */
describe('createMemoryOutputProcessor — suspend/resume closure state', () => {
  it('preserves dedup state across simulated suspend/resume via session.custom', async () => {
    const backend = new InMemoryBackend();

    // --- First run (before suspend) ---
    const processor1 = createMemoryOutputProcessor({
      backend,
      triggerMode: { type: 'automatic', onLoad: 'always' },
    });

    const ctx1 = makeContext({
      request: { input: 'question 1', sessionId: 'session-sr' },
      iteration: { step: 0, response: 'answer A' },
    });

    const result1 = await executeProcessor(processor1, ctx1);

    // Verify first turn was stored
    const stored1 = await backend.retrieve('session-sr');
    expect(stored1).toHaveLength(2);
    expect(stored1[1].content).toBe('answer A');

    // --- Simulate suspend: serialize session.custom ---
    const savedCustom = { ...result1.session.custom };

    // --- Simulate resume: create a NEW processor instance ---
    // The closure variable `lastAssistantContent` in processor2 is undefined.
    // But session.custom._memoryLastAssistant is restored from the checkpoint.
    const processor2 = createMemoryOutputProcessor({
      backend,
      triggerMode: { type: 'automatic', onLoad: 'always' },
    });

    const ctx2 = makeContext({
      request: { input: 'question 2', sessionId: 'session-sr' },
      iteration: { step: 0, response: 'answer A' }, // same response as before
      session: { custom: savedCustom },
    });

    await executeProcessor(processor2, ctx2);

    const stored2 = await backend.retrieve('session-sr');
    const assistantEntries = stored2.filter(e => e.role === 'assistant');
    // The dedup should still work: same "answer A" should NOT be stored again
    expect(assistantEntries).toHaveLength(1);
  });

  it('stores new assistant content after resume when content changes', async () => {
    const backend = new InMemoryBackend();

    // First run
    const processor1 = createMemoryOutputProcessor({
      backend,
      triggerMode: { type: 'automatic', onLoad: 'always' },
    });

    const result1 = await executeProcessor(processor1, makeContext({
      request: { input: 'q1', sessionId: 'session-sr2' },
      iteration: { step: 0, response: 'answer X' },
    }));

    const savedCustom = { ...result1.session.custom };

    // Resume with new processor instance and different response
    const processor2 = createMemoryOutputProcessor({
      backend,
      triggerMode: { type: 'automatic', onLoad: 'always' },
    });

    await executeProcessor(processor2, makeContext({
      request: { input: 'q2', sessionId: 'session-sr2' },
      iteration: { step: 0, response: 'answer Y' },
      session: { custom: savedCustom },
    }));

    const stored = await backend.retrieve('session-sr2');
    const assistantEntries = stored.filter(e => e.role === 'assistant');
    expect(assistantEntries).toHaveLength(2);
    expect(assistantEntries[0].content).toBe('answer X');
    expect(assistantEntries[1].content).toBe('answer Y');
  });

  it('does not fail when session.custom is empty (fresh start)', async () => {
    const backend = new InMemoryBackend();

    const processor = createMemoryOutputProcessor({
      backend,
      triggerMode: { type: 'automatic', onLoad: 'always' },
    });

    // Fresh context with empty custom
    const ctx = makeContext({
      request: { input: 'hello', sessionId: 'session-fresh' },
      iteration: { step: 0, response: 'hi there' },
      session: { custom: {} },
    });

    const result = await executeProcessor(processor, ctx);
    const stored = await backend.retrieve('session-fresh');
    expect(stored).toHaveLength(2);
  });
});
