import { describe, it, expect } from 'vitest';
import { createFactInjectionProcessor } from '../src/harness/fact-injection-processor.js';
import type { PipelineContext, ProcessorResult } from '@agentforge/sdk';

function makeContext(): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
  } as PipelineContext;
}

function isContext(r: ProcessorResult): r is PipelineContext {
  return 'request' in r && 'agent' in r;
}

describe('FactInjectionProcessor', () => {
  it('injects static facts as promptFragment', async () => {
    const processor = createFactInjectionProcessor({
      facts: ['Always respond in English', 'Never mention pricing'],
    });
    const result = await processor.execute(makeContext());
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.agent.promptFragments).toHaveLength(1);
      expect(result.agent.promptFragments[0]).toContain('Always respond in English');
      expect(result.agent.promptFragments[0]).toContain('Never mention pricing');
      expect(result.agent.promptFragments[0]).toContain('[Constraints & Facts]');
    }
  });

  it('injects dynamic facts from function', async () => {
    const processor = createFactInjectionProcessor({
      facts: (ctx) => [`User input was: ${ctx.request.input}`],
    });
    const result = await processor.execute(makeContext());
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.agent.promptFragments[0]).toContain('User input was: test');
    }
  });

  it('injects async dynamic facts', async () => {
    const processor = createFactInjectionProcessor({
      facts: async (ctx) => [`Async fact for ${ctx.request.sessionId}`],
    });
    const result = await processor.execute(makeContext());
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.agent.promptFragments[0]).toContain('Async fact for s1');
    }
  });

  it('passes through with no injection for empty facts', async () => {
    const processor = createFactInjectionProcessor({ facts: [] });
    const ctx = makeContext();
    const result = await processor.execute(ctx);
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.agent.promptFragments).toHaveLength(0);
    }
  });

  it('appends to existing promptFragments', async () => {
    const processor = createFactInjectionProcessor({ facts: ['fact1'] });
    const ctx = makeContext();
    ctx.agent.promptFragments = ['existing fragment'];
    const result = await processor.execute(ctx);
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.agent.promptFragments).toHaveLength(2);
      expect(result.agent.promptFragments[0]).toBe('existing fragment');
      expect(result.agent.promptFragments[1]).toContain('fact1');
    }
  });
});
