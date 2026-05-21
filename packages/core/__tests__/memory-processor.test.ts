import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySystem } from '../src/memory/memory-system.js';
import { InMemoryStore } from '../src/memory/storage/in-memory.js';
import { createMemoryRecallProcessor, createMemoryStoreProcessor } from '../src/memory/memory-processor.js';
import { createProcessorContext } from '../src/processor-context.js';
import { WorkingMemoryImpl } from '../src/memory/working-memory.js';
import type { PipelineContext } from '@primo-ai/sdk';

function createEmptyPipelineContext(): PipelineContext {
  return {
    request: { input: 'Build a memory system', sessionId: 'session-1' },
    agent: {
      config: { model: 'test-model' },
      toolDeclarations: [],
      promptFragments: [],
    },
    iteration: { step: 0 },
    session: { messageHistory: [], custom: {} },
  };
}

describe('Memory Processor', () => {
  let system: MemorySystem;
  let wm: WorkingMemoryImpl;

  beforeEach(async () => {
    const storage = new InMemoryStore();
    system = new MemorySystem({ storage });

    wm = new WorkingMemoryImpl();
    wm.setProfileField('name', 'Alice');
    wm.addGoal('build memory system');
    wm.setCurrentGoal('implement phase 1');
    wm.updateProgress(30);

    await storage.setWorkingMemory('session-1', wm.toJSON());

    await system.remember('AgentForge uses pipeline architecture', {
      type: 'fact',
      scope: '/project/agentforge',
      categories: ['architecture'],
      importance: 0.9,
    });
    await system.remember('TDD is a testing methodology', {
      type: 'fact',
      scope: '/project/general',
      categories: ['testing'],
      importance: 0.7,
    });
  });

  describe('createMemoryRecallProcessor', () => {
    it('injects working memory into prompt fragments', async () => {
      const processor = createMemoryRecallProcessor(system);
      expect(processor.stage).toBe('buildContext');

      const ctx = createEmptyPipelineContext();
      const pCtx = createProcessorContext(ctx);

      await processor.execute(pCtx);

      const fragments = pCtx.state.agent.promptFragments;
      expect(fragments.length).toBeGreaterThan(0);
      expect(fragments.some((f) => f.includes('Alice'))).toBe(true);
      expect(fragments.some((f) => f.includes('build memory system'))).toBe(true);
    });

    it('injects recalled memories into prompt fragments', async () => {
      const processor = createMemoryRecallProcessor(system);

      const ctx = createEmptyPipelineContext();
      ctx.request.input = 'pipeline architecture';
      const pCtx = createProcessorContext(ctx);

      await processor.execute(pCtx);

      const fragments = pCtx.state.agent.promptFragments;
      const hasRecallBlock = fragments.some((f) => f.includes('recalled_memories'));
      expect(hasRecallBlock).toBe(true);
      const hasArchitectureMemory = fragments.some((f) => f.includes('pipeline architecture'));
      expect(hasArchitectureMemory).toBe(true);
    });

    it('does not fail when no memories match', async () => {
      const processor = createMemoryRecallProcessor(system);

      const ctx = createEmptyPipelineContext();
      ctx.request.input = 'completely unrelated query xyz';
      const pCtx = createProcessorContext(ctx);

      await expect(processor.execute(pCtx)).resolves.not.toThrow();
    });
  });

  describe('createMemoryStoreProcessor', () => {
    it('stores the user input and assistant response', async () => {
      const processor = createMemoryStoreProcessor(system);
      expect(processor.stage).toBe('processOutput');

      const ctx = createEmptyPipelineContext();
      ctx.request.input = 'What is TDD?';
      ctx.iteration.response = 'TDD stands for Test-Driven Development';
      const pCtx = createProcessorContext(ctx);

      await processor.execute(pCtx);

      // Access internal storage of the system to verify
      const events = await (system as any).storage.getEvents('session-1');
      expect(events.length).toBeGreaterThan(0);
      const userEvent = events.find((e: any) => e.content === 'What is TDD?');
      expect(userEvent).toBeDefined();
    });

    it('skips when no response is available', async () => {
      const processor = createMemoryStoreProcessor(system);

      const ctx = createEmptyPipelineContext();
      const pCtx = createProcessorContext(ctx);

      await expect(processor.execute(pCtx)).resolves.not.toThrow();
    });
  });
});
