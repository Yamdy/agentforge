import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import type { PipelineContext, Span } from '@primo-ai/sdk';
import { TraceCollector, formatTraceJson, formatTraceConsole } from '@primo-ai/observability';
import { SpanType } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '../src/processor-context.js';

function makeContext(): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
  };
}

describe('TraceCollector + PipelineRunner integration', () => {
  it('collects full pipeline trace with per-stage timing', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({ stage: 'processInput', execute: async () => {} });
    runner.register({ stage: 'invokeLLM', execute: async () => {} });
    runner.register({ stage: 'processOutput', execute: async () => {} });

    await runner.run(makeContext(), ['processInput', 'invokeLLM', 'processOutput']);

    const trace = collector.getTrace();

    expect(trace.spans).toHaveLength(4);
    expect(trace.root).toBeDefined();
    expect(trace.root!.span.name).toBe(SpanType.AGENT_RUN);
    expect(trace.root!.children).toHaveLength(3);
    expect(trace.root!.children.map(c => c.span.name)).toEqual(['processInput', 'invokeLLM', 'processOutput']);
  });

  it('every span has timing data', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({ stage: 'processInput', execute: async () => {} });

    await runner.run(makeContext(), ['processInput']);

    const trace = collector.getTrace();
    for (const span of trace.spans) {
      expect(typeof span.startTime).toBe('number');
      expect(typeof span.endTime).toBe('number');
      expect(typeof span.durationMs).toBe('number');
      expect(span.endTime).toBeGreaterThanOrEqual(span.startTime);
    }
  });

  it('root duration >= sum of child durations', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({ stage: 'processInput', execute: async () => {} });
    runner.register({ stage: 'invokeLLM', execute: async () => {} });

    await runner.run(makeContext(), ['processInput', 'invokeLLM']);

    const trace = collector.getTrace();
    const rootDuration = trace.root!.span.durationMs;
    const childrenDuration = trace.root!.children.reduce((sum, c) => sum + c.span.durationMs, 0);
    expect(rootDuration).toBeGreaterThanOrEqual(childrenDuration);
  });

  it('formatTraceConsole renders readable output', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({ stage: 'processInput', execute: async () => {} });
    runner.register({ stage: 'invokeLLM', execute: async () => {} });

    await runner.run(makeContext(), ['processInput', 'invokeLLM']);

    const output = formatTraceConsole(collector.getTrace());

    expect(output).toContain(SpanType.AGENT_RUN);
    expect(output).toContain('processInput');
    expect(output).toContain('invokeLLM');
    expect(output).toContain('ms');
  });

  it('formatTraceJson produces valid JSON with full tree', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({ stage: 'processInput', execute: async () => {} });

    await runner.run(makeContext(), ['processInput']);

    const json = formatTraceJson(collector.getTrace());
    const parsed = JSON.parse(json);

    expect(parsed.traceId).toBeDefined();
    expect(parsed.root.span.name).toBe(SpanType.AGENT_RUN);
    expect(parsed.root.children).toHaveLength(1);
    expect(parsed.root.children[0].span.name).toBe('processInput');
    expect(typeof parsed.root.span.durationMs).toBe('number');
  });

  it('processor can enrich span with attributes', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({
      stage: 'processInput',
      execute: async (pCtx) => {
        const span = pCtx.state.iteration.span as Span;
        span.setAttribute('input.length', pCtx.state.request.input.length);
      },
    });

    await runner.run(makeContext(), ['processInput']);

    const trace = collector.getTrace();
    const processInputSpan = trace.spans.find(s => s.name === 'processInput');
    expect(processInputSpan!.attributes['input.length']).toBe(4);
  });

  it('invokeLLM processor auto-sets model attribute on span', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx) => {
        (pCtx.state.iteration as unknown as Record<string, unknown>)._modelString = 'gpt-4o';
      },
    });

    await runner.run(makeContext(), ['invokeLLM']);

    const trace = collector.getTrace();
    const span = trace.spans.find(s => s.name === 'invokeLLM');
    expect(span).toBeDefined();
  });

  it('PipelineRunner auto-sets token attributes on invokeLLM span after stream', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    const mockStream = (async function* () {
      yield { type: 'text-delta', text: 'hello' };
      yield { type: 'finish-step', usage: { inputTokens: 10, outputTokens: 20 } };
    })();

    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx) => {
        pCtx.state.iteration.fullStream = mockStream;
        (pCtx.state.iteration as unknown as Record<string, unknown>)._modelString = 'gpt-4';
      },
    });

    await runner.run(makeContext(), ['invokeLLM']);

    const trace = collector.getTrace();
    const span = trace.spans.find(s => s.name === 'invokeLLM');
    expect(span!.attributes['tokens.input']).toBe(10);
    expect(span!.attributes['tokens.output']).toBe(20);
  });
});
