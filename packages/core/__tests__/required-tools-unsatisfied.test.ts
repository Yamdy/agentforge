import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/event-bus.js';
import { createEvaluateIterationProcessor } from '../src/processors/evaluate-iteration.js';
import type { PipelineContext, Span } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '../src/processor-context.js';

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: {
      config: {},
      systemPrompt: '',
      promptFragments: [],
      toolDeclarations: [],
      ...overrides.agent,
    },
    iteration: {
      step: 1,
      response: 'done',
      loopDirective: undefined,
      span: { setAttribute: () => {} } as unknown as Span,
      ...overrides.iteration,
    },
    session: {
      messageHistory: [],
      totalTokenUsage: { input: 0, output: 0 },
      custom: {},
      ...overrides.session,
    },
  } as PipelineContext;
}

/**
 * F-I tests: requiredTools must emit required_tools:unsatisfied when the loop
 * is forced to stop (token overflow) without satisfying all required tools.
 */
describe('F-I: requiredTools unsatisfied observability', () => {
  it('emits required_tools:unsatisfied when token overflow stops loop with uncalled tools', async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const bus = new EventBus();
    bus.subscribe('required_tools:unsatisfied', (data) =>
      events.push({ type: 'required_tools:unsatisfied', data }),
    );

    const processor = createEvaluateIterationProcessor({ eventBus: bus });

    const ctx = makeCtx({
      agent: {
        config: { model: 'test-model', requiredTools: ['search', 'calculate'] },
        systemPrompt: '',
        promptFragments: [],
        toolDeclarations: [
          { name: 'search', description: '' },
          { name: 'calculate', description: '' },
        ],
      },
      session: {
        messageHistory: [],
        totalTokenUsage: { input: 50000, output: 60000 },
        custom: {},
      },
      iteration: {
        step: 1,
        response: 'done',
        tokenUsage: { input: 0, output: 0 },
        loopDirective: undefined,
        span: { setAttribute: () => {} } as unknown as Span,
      },
    });

    await processor.execute(new ProcessorContextImpl(ctx));

    expect(events.length).toBeGreaterThanOrEqual(1);
    const data = events[0].data as Record<string, unknown>;
    expect(data.uncalled).toContain('search');
    expect(data.uncalled).toContain('calculate');
    expect(data.reason).toBe('token_overflow');
  });

  it('does not emit unsatisfied when token overflow but all required tools were called', async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const bus = new EventBus();
    bus.subscribe('required_tools:unsatisfied', (data) =>
      events.push({ type: 'required_tools:unsatisfied', data }),
    );

    const processor = createEvaluateIterationProcessor({ eventBus: bus });

    const ctx = makeCtx({
      agent: {
        config: { model: 'test-model', requiredTools: ['search'] },
        systemPrompt: '',
        promptFragments: [],
        toolDeclarations: [{ name: 'search', description: '' }],
      },
      session: {
        messageHistory: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'tc1', name: 'search', args: { q: 'test' } }],
          },
          { role: 'tool', content: 'results', toolCallId: 'tc1', toolName: 'search' },
        ],
        totalTokenUsage: { input: 50000, output: 60000 },
        custom: {},
      },
      iteration: {
        step: 1,
        response: 'done',
        tokenUsage: { input: 0, output: 0 },
        loopDirective: undefined,
        span: { setAttribute: () => {} } as unknown as Span,
      },
    });

    await processor.execute(new ProcessorContextImpl(ctx));

    expect(events).toHaveLength(0);
  });

  it('does not emit unsatisfied when no requiredTools configured', async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const bus = new EventBus();
    bus.subscribe('required_tools:unsatisfied', (data) =>
      events.push({ type: 'required_tools:unsatisfied', data }),
    );

    const processor = createEvaluateIterationProcessor({ eventBus: bus });

    const ctx = makeCtx({
      session: {
        messageHistory: [],
        totalTokenUsage: { input: 50000, output: 60000 },
        custom: {},
      },
      iteration: {
        step: 1,
        response: 'done',
        tokenUsage: { input: 0, output: 0 },
        loopDirective: undefined,
        span: { setAttribute: () => {} } as unknown as Span,
      },
    });

    await processor.execute(new ProcessorContextImpl(ctx));

    expect(events).toHaveLength(0);
  });
});
