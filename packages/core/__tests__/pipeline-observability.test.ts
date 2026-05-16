import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import type { PipelineContext, PipelineStage, Span } from '@agentforge/sdk';
import { SpanType } from '@agentforge/sdk';
import { TestExporter } from '@agentforge/observability';
import { LoopOrchestrator } from '../src/loop-orchestrator.js';
import { EventBus } from '../src/event-bus.js';
import type { HookManager } from '../src/hook-manager.js';

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
    const rootSpan = spans.find((s) => s.name === SpanType.AGENT_RUN);
    expect(rootSpan).toBeDefined();

    const stageSpans = spans.filter((s) => s.name !== SpanType.AGENT_RUN);
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
    const rootSpan = spans.find((s) => s.name === SpanType.AGENT_RUN);
    expect(rootSpan!.ended).toBe(true);
  });

  it('stage spans are children of the root span', async () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();
    const runner = new PipelineRunner({ tracer });

    await runner.run(makeContext(), ['processInput', 'invokeLLM', 'processOutput']);

    const spans = exporter.getSpans();
    const rootSpan = spans.find((s) => s.name === SpanType.AGENT_RUN)!;
    const stageSpans = spans.filter((s) => s.name !== SpanType.AGENT_RUN);

    for (const stage of stageSpans) {
      expect(stage.parentSpanId).toBe(rootSpan.spanId);
      expect(stage.traceId).toBe(rootSpan.traceId);
    }
  });
});

// ---------------------------------------------------------------------------
// A-3: LoopOrchestrator.runLoop returns compatRetries count
// ---------------------------------------------------------------------------

describe('LoopOrchestrator compatRetries exposure', () => {
  it('returns compatRetries = 0 when no compat retry occurs', async () => {
    const mockRunner = {
      run: async () => { throw new Error('should not be called'); },
      async *stream(ctx: PipelineContext, stages: PipelineStage[]): AsyncGenerator<import('@agentforge/sdk').StreamEvent> {
        // Pre-loop stages
        if (stages[0] === 'processInput') {
          yield { type: 'complete', context: { ...ctx, session: { ...ctx.session, messageHistory: [] } } };
          return;
        }
        // Loop stages — stop immediately
        if (stages.includes('evaluateIteration')) {
          yield { type: 'complete', context: { ...ctx, iteration: { ...ctx.iteration, loopDirective: { action: 'stop' } } } };
          return;
        }
        // Post-loop stages
        yield { type: 'complete', context: ctx };
      },
      setHookManager() {},
    };
    const mockHookManager = { invoke: async () => {} };

    const orchestrator = new LoopOrchestrator(
      mockRunner as unknown as PipelineRunner,
      mockHookManager as unknown as HookManager,
      undefined,
    );

    const ctx: PipelineContext = {
      request: { input: 'test', sessionId: 's1' },
      agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { custom: {} },
    };

    const result = await orchestrator.runLoop(ctx, { maxIterations: 5, modelString: 'mock/test', sessionId: 's1' });

    expect(result.compatRetries).toBe(0);
  });

  it('returns compatRetries > 0 when compat retry occurs', async () => {
    const eventBus = new EventBus();

    // History with a bad tool call ID that triggers sanitize-tool-call-ids rule
    const historyWithBadToolCall = [
      { role: 'user' as const, content: 'do something' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'bad!id@chars', name: 'myTool', args: {} }] },
    ];

    let loopCallCount = 0;
    const mockRunner = {
      run: async () => { throw new Error('should not be called'); },
      async *stream(ctx: PipelineContext, stages: PipelineStage[]): AsyncGenerator<import('@agentforge/sdk').StreamEvent> {
        // Pre-loop stages
        if (stages[0] === 'processInput') {
          yield { type: 'complete', context: { ...ctx, session: { ...ctx.session, messageHistory: historyWithBadToolCall } } };
          return;
        }
        // Loop stages
        if (stages.includes('evaluateIteration')) {
          loopCallCount++;
          if (loopCallCount === 1) {
            throw new Error('tool call id invalid format');
          }
          yield { type: 'complete', context: { ...ctx, iteration: { ...ctx.iteration, loopDirective: { action: 'stop' } } } };
          return;
        }
        // Post-loop stages
        yield { type: 'complete', context: ctx };
      },
      setHookManager() {},
    };
    const mockHookManager = { invoke: async () => {} };

    const orchestrator = new LoopOrchestrator(
      mockRunner as unknown as PipelineRunner,
      mockHookManager as unknown as HookManager,
      undefined,
      eventBus,
    );

    const ctx: PipelineContext = {
      request: { input: 'test', sessionId: 's1' },
      agent: { config: { model: 'anthropic/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { custom: {} },
    };

    const result = await orchestrator.runLoop(ctx, { maxIterations: 5, modelString: 'anthropic/test', sessionId: 's1' });

    expect(result.compatRetries).toBe(1);
  });
});
