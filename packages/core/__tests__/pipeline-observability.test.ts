import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import type { PipelineContext, Processor, Tracer, Span } from '@agentforge/sdk';
import { TestExporter } from '@agentforge/observability';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

describe('PipelineRunner with Tracer', () => {
  it('creates a span for each pipeline stage', async () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({
      stage: 'processInput',
      execute: async (ctx) => ctx,
    });
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => ctx,
    });
    runner.register({
      stage: 'processOutput',
      execute: async (ctx) => ctx,
    });

    await runner.run(makeContext(), ['processInput', 'invokeLLM', 'processOutput']);

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(4); // 1 root + 3 stages
    const rootSpan = spans.find((s) => s.name === 'pipeline');
    expect(rootSpan).toBeDefined();

    const stageSpans = spans.filter((s) => s.name !== 'pipeline');
    expect(stageSpans.map((s) => s.name)).toEqual(['processInput', 'invokeLLM', 'processOutput']);
  });

  it('processors can access the current span and add attributes', async () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({
      stage: 'processInput',
      execute: async (ctx) => {
        const span = ctx.iteration.span as Span;
        span.setAttribute('input.length', ctx.request.input.length);
        return ctx;
      },
    });

    await runner.run(makeContext({ request: { input: 'hello world', sessionId: 's1' } }), ['processInput']);

    const spans = exporter.getSpans();
    const processInputSpan = spans.find((s) => s.name === 'processInput');
    expect(processInputSpan!.attributes['input.length']).toBe(11);
  });

  it('works without a tracer (backwards compatible)', async () => {
    const runner = new PipelineRunner();

    runner.register({
      stage: 'processInput',
      execute: async (ctx) => ({ ...ctx, session: { ...ctx.session, custom: { ...ctx.session.custom, result: 'ok' } } }),
    });

    const result = await runner.run(makeContext(), ['processInput']);
    expect('type' in result ? null : result.session.custom.result).toBe('ok');
  });

  it('ends spans even when a processor throws', async () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({
      stage: 'processInput',
      execute: async () => {
        throw new Error('boom');
      },
    });

    await expect(
      runner.run(makeContext(), ['processInput']),
    ).rejects.toThrow('boom');

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(2); // root + processInput
    const processInputSpan = spans.find((s) => s.name === 'processInput');
    expect(processInputSpan!.ended).toBe(true);
    const rootSpan = spans.find((s) => s.name === 'pipeline');
    expect(rootSpan!.ended).toBe(true);
  });

  it('stage spans are children of the root span', async () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();
    const runner = new PipelineRunner({ tracer });

    await runner.run(makeContext(), ['processInput', 'invokeLLM', 'processOutput']);

    const spans = exporter.getSpans();
    const rootSpan = spans.find((s) => s.name === 'pipeline')!;
    const stageSpans = spans.filter((s) => s.name !== 'pipeline');

    for (const stage of stageSpans) {
      expect(stage.parentSpanId).toBe(rootSpan.spanId);
      expect(stage.traceId).toBe(rootSpan.traceId);
    }
  });
});
