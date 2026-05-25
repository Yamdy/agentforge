import { describe, it, expect, vi } from 'vitest';
import { createPlanStepProcessor } from '../src/processors/plan-step.js';
import type { ProcessorContext, PipelineContext } from '@primo-ai/sdk';

function makeContext(input?: string, step?: number): ProcessorContext {
  return {
    state: {
      agent: {
        config: { model: 'test' },
        toolDeclarations: [],
        promptFragments: [],
      },
      iteration: { step: step ?? 0 },
      session: { input: input ?? 'analyze the codebase', sessionId: 'test', custom: {} },
    } as PipelineContext,
    control: {
      abort: () => { throw new Error('abort'); },
      suspend: () => { throw new Error('suspend'); },
      error: () => { throw new Error('error'); },
    },
  };
}

describe('PlanStep processor', () => {
  it('creates a processor with stage "planStep"', () => {
    const processor = createPlanStepProcessor();
    expect(processor.stage).toBe('planStep');
  });

  it('skips planning when step > 0 (not first iteration)', async () => {
    const processor = createPlanStepProcessor();
    const ctx = makeContext('test', 5);
    const result = await processor.execute(ctx);
    // Should return state unchanged when not first iteration
    expect(result).toEqual(ctx.state);
  });

  it('generates a plan on first iteration using LLM', async () => {
    const mockLLM = vi.fn().mockResolvedValue(
      '## Plan\n1. Read files\n2. Analyze patterns\n3. Report findings'
    );
    const processor = createPlanStepProcessor({ getLLM: () => Promise.resolve(mockLLM) });
    const ctx = makeContext('analyze the codebase', 0);
    const result = await processor.execute(ctx);

    expect(mockLLM).toHaveBeenCalled();
    // Plan should be stored in session.custom
    const custom = (result as PipelineContext).session.custom as Record<string, unknown>;
    expect(custom.plan).toBeDefined();
    expect(typeof custom.plan).toBe('string');
    expect(custom.plan as string).toContain('Plan');
  });

  it('stores plan in session.custom.plan', async () => {
    const mockLLM = vi.fn().mockResolvedValue('1. Step one\n2. Step two');
    const processor = createPlanStepProcessor({ getLLM: () => Promise.resolve(mockLLM) });
    const ctx = makeContext('do something complex', 0);
    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.session.custom.plan).toBe('1. Step one\n2. Step two');
  });

  it('gracefully handles LLM failure', async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const processor = createPlanStepProcessor({ getLLM: () => Promise.resolve(mockLLM) });
    const ctx = makeContext('test', 0);
    // Should not throw, just skip planning
    const result = await processor.execute(ctx);
    expect(result).toBeDefined();
    const custom = (result as PipelineContext).session.custom as Record<string, unknown>;
    expect(custom.plan).toBeUndefined();
  });

  it('works without LLM (no-op)', async () => {
    const processor = createPlanStepProcessor();
    const ctx = makeContext('test', 0);
    const result = await processor.execute(ctx);
    expect(result).toBeDefined();
  });

  it('includes plan prompt with user input', async () => {
    let capturedPrompt = '';
    const mockLLM = vi.fn().mockImplementation((prompt: string) => {
      capturedPrompt = prompt;
      return '1. Analyze';
    });
    const processor = createPlanStepProcessor({ getLLM: () => Promise.resolve(mockLLM) });
    const ctx = makeContext('build a REST API', 0);
    await processor.execute(ctx);
    expect(capturedPrompt).toContain('build a REST API');
  });
});
