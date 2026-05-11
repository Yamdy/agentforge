import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import type { PipelineContext, StreamEvent } from '@agentforge/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

describe('PipelineRunner.stream()', () => {
  it('yields stage_start and stage_complete for each stage', async () => {
    const runner = new PipelineRunner();
    runner.register({ stage: 'processInput', execute: async (ctx) => ctx });
    runner.register({ stage: 'invokeLLM', execute: async (ctx) => ctx });
    runner.register({ stage: 'processOutput', execute: async (ctx) => ctx });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['processInput', 'invokeLLM', 'processOutput'])) {
      events.push(event);
    }

    const stageStarts = events.filter((e) => e.type === 'stage_start');
    const stageCompletes = events.filter((e) => e.type === 'stage_complete');
    expect(stageStarts).toHaveLength(3);
    expect(stageCompletes).toHaveLength(3);
    expect(stageStarts[0]).toEqual({ type: 'stage_start', stage: 'processInput' });
  });

  it('yields text_delta events when processor sets textStream', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => ({
        ...ctx,
        iteration: {
          ...ctx.iteration,
          textStream: (async function* () {
            yield 'hello ';
            yield 'world';
          })(),
          usagePromise: Promise.resolve({ input: 10, output: 2 }),
        },
      }),
    });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
      events.push(event);
    }

    const deltas = events.filter((e) => e.type === 'text_delta') as Array<{ type: 'text_delta'; text: string }>;
    expect(deltas.map((e) => e.text)).toEqual(['hello ', 'world']);

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
  });

  it('yields abort event when processor aborts', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async () => ({ type: 'abort' as const, reason: 'policy violation' }),
    });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'abort', reason: 'policy violation' });
    expect(events.find((e) => e.type === 'complete')).toBeUndefined();
  });

  it('works without a tracer (no-op fallback)', async () => {
    const runner = new PipelineRunner();
    runner.register({ stage: 'processInput', execute: async (ctx) => ctx });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['processInput'])) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'stage_start')).toBe(true);
    expect(events.some((e) => e.type === 'complete')).toBe(true);
  });
});
