import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import { LoopOrchestrator } from '../src/loop-orchestrator.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import type { PipelineContext, Processor, ErrorResult, StreamEvent } from '@primo-ai/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PipelineRunner ErrorResult tests
// ---------------------------------------------------------------------------

describe('PipelineRunner - ErrorResult', () => {
  it('returns ErrorResult from run() instead of throwing', async () => {
    const runner = new PipelineRunner();
    const testError = new Error('processor failure');

    runner.register({
      stage: 'invokeLLM',
      execute: async () => ({
        type: 'error' as const,
        error: testError,
        stage: 'invokeLLM' as const,
        recoverable: false,
      }),
    });

    const result = await runner.run(makeContext(), ['invokeLLM']);

    expect(result).toEqual({
      type: 'error',
      error: testError,
      stage: 'invokeLLM',
      recoverable: false,
    });
  });

  it('yields error StreamEvent from stream() instead of throwing', async () => {
    const runner = new PipelineRunner();
    const testError = new Error('stream failure');

    runner.register({
      stage: 'invokeLLM',
      execute: async () => ({
        type: 'error' as const,
        error: testError,
        stage: 'invokeLLM' as const,
        recoverable: true,
      }),
    });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'stage_start', stage: 'invokeLLM' });
    expect(events[1]).toEqual({
      type: 'error',
      error: testError,
      stage: 'invokeLLM',
      recoverable: true,
    });
    // No 'complete' event should be yielded since stream stopped early
    expect(events.find((e) => e.type === 'complete')).toBeUndefined();
  });

  it('stops pipeline when ErrorResult is returned (no further stages run)', async () => {
    const runner = new PipelineRunner();
    const order: string[] = [];
    const testError = new Error('stop here');

    runner.register({
      stage: 'processInput',
      execute: async (ctx) => {
        order.push('processInput');
        return ctx;
      },
    });
    runner.register({
      stage: 'invokeLLM',
      execute: async () => ({
        type: 'error' as const,
        error: testError,
        stage: 'invokeLLM' as const,
      }),
    });
    runner.register({
      stage: 'processOutput',
      execute: async (ctx) => {
        order.push('processOutput');
        return ctx;
      },
    });

    const result = await runner.run(makeContext(), ['processInput', 'invokeLLM', 'processOutput']);

    expect(result).toEqual({
      type: 'error',
      error: testError,
      stage: 'invokeLLM',
    });
    expect(order).toEqual(['processInput']);
  });

  it('invokes error hook when ErrorResult is returned from run()', async () => {
    const eventBus = new EventBus();
    const hookManager = new HookManager(eventBus);
    const hookErrors: unknown[] = [];
    eventBus.subscribe('hook:error', (data: unknown) => hookErrors.push(data));

    const runner = new PipelineRunner({ hookManager });
    const testError = new Error('hook test error');

    runner.register({
      stage: 'processInput',
      execute: async () => ({
        type: 'error' as const,
        error: testError,
        stage: 'processInput' as const,
      }),
    });

    await runner.run(makeContext(), ['processInput']);

    // Hook manager should have been invoked with the error
    expect(hookErrors.length).toBeGreaterThanOrEqual(1);
    const errorData = hookErrors[0] as { error: Error; stage: string };
    expect(errorData.error).toBe(testError);
    expect(errorData.stage).toBe('processInput');
  });
});

// ---------------------------------------------------------------------------
// LoopOrchestrator ErrorResult tests
// ---------------------------------------------------------------------------

describe('LoopOrchestrator - ErrorResult', () => {
  it('throws on ErrorResult in pre-loop stages (always fatal)', async () => {
    const eventBus = new EventBus();
    const hookManager = new HookManager(eventBus);
    const runner = new PipelineRunner({ hookManager });
    const testError = new Error('pre-loop fatal error');

    runner.register({
      stage: 'processInput',
      execute: async () => ({
        type: 'error' as const,
        error: testError,
        stage: 'processInput' as const,
      }),
    });

    const lo = new LoopOrchestrator(
      runner,
      hookManager,
      undefined,
      eventBus,
    );

    await expect(
      lo.runLoop(makeContext(), {
        maxIterations: 3,
        modelString: 'mock/test',
        sessionId: 's1',
      }),
    ).rejects.toThrow('pre-loop fatal error');
  });

  it('throws on non-recoverable ErrorResult in agentic loop', async () => {
    const eventBus = new EventBus();
    const hookManager = new HookManager(eventBus);
    const runner = new PipelineRunner({ hookManager });
    const testError = new Error('non-recoverable loop error');

    runner.register({
      stage: 'invokeLLM',
      execute: async () => ({
        type: 'error' as const,
        error: testError,
        stage: 'invokeLLM' as const,
        recoverable: false,
      }),
    });

    const lo = new LoopOrchestrator(
      runner,
      hookManager,
      undefined,
      eventBus,
    );

    await expect(
      lo.runLoop(makeContext(), {
        maxIterations: 3,
        modelString: 'mock/test',
        sessionId: 's1',
      }),
    ).rejects.toThrow('non-recoverable loop error');
  });

  it('emits pipeline:stage_error event and continues loop on recoverable ErrorResult', async () => {
    const eventBus = new EventBus();
    const hookManager = new HookManager(eventBus);
    const runner = new PipelineRunner({ hookManager });
    const testError = new Error('recoverable error');
    const emittedEvents: { eventType: string; data?: unknown }[] = [];

    eventBus.subscribe('pipeline:stage_error', (data?: unknown) => {
      emittedEvents.push({ eventType: 'pipeline:stage_error', data });
    });

    let invokeCount = 0;
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => {
        invokeCount++;
        if (invokeCount === 1) {
          return {
            type: 'error' as const,
            error: testError,
            stage: 'invokeLLM' as const,
            recoverable: true,
          };
        }
        return ctx;
      },
    });
    runner.register({
      stage: 'evaluateIteration',
      execute: async (ctx) => ({
        ...ctx,
        iteration: { ...ctx.iteration, loopDirective: { action: 'stop' as const } },
      }),
    });

    const lo = new LoopOrchestrator(
      runner,
      hookManager,
      undefined,
      eventBus,
    );

    const result = await lo.runLoop(makeContext(), {
      maxIterations: 3,
      modelString: 'mock/test',
      sessionId: 's1',
    });

    // Should complete without throwing
    expect(result.context).toBeDefined();

    // Should have emitted pipeline:stage_error event
    expect(emittedEvents.length).toBeGreaterThanOrEqual(1);
    expect(emittedEvents[0].eventType).toBe('pipeline:stage_error');

    // invokeLLM should have been called twice:
    // 1st: returns ErrorResult (recoverable) → iteration continues
    // 2nd: returns ctx → iteration completes
    expect(invokeCount).toBe(2);
  });

  it('does not emit pipeline:stage_error for non-recoverable ErrorResult', async () => {
    const eventBus = new EventBus();
    const hookManager = new HookManager(eventBus);
    const runner = new PipelineRunner({ hookManager });
    const testError = new Error('non-recoverable');
    const emittedEventTypes: string[] = [];

    eventBus.subscribe('pipeline:stage_error', () => {
      emittedEventTypes.push('pipeline:stage_error');
    });

    runner.register({
      stage: 'invokeLLM',
      execute: async () => ({
        type: 'error' as const,
        error: testError,
        stage: 'invokeLLM' as const,
        recoverable: false,
      }),
    });

    const lo = new LoopOrchestrator(
      runner,
      hookManager,
      undefined,
      eventBus,
    );

    await expect(
      lo.runLoop(makeContext(), {
        maxIterations: 3,
        modelString: 'mock/test',
        sessionId: 's1',
      }),
    ).rejects.toThrow('non-recoverable');

    expect(emittedEventTypes).toEqual([]);
  });

  it('invokes error hook for recoverable ErrorResult before continuing loop', async () => {
    const eventBus = new EventBus();
    const hookManager = new HookManager(eventBus);
    const hookErrors: unknown[] = [];
    eventBus.subscribe('hook:error', (data: unknown) => hookErrors.push(data));

    const runner = new PipelineRunner({ hookManager });
    const testError = new Error('recoverable hook');

    let callCount = 0;
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => {
        callCount++;
        if (callCount === 1) {
          return {
            type: 'error' as const,
            error: testError,
            stage: 'invokeLLM' as const,
            recoverable: true,
          };
        }
        return ctx;
      },
    });
    runner.register({
      stage: 'evaluateIteration',
      execute: async (ctx) => ({
        ...ctx,
        iteration: { ...ctx.iteration, loopDirective: { action: 'stop' as const } },
      }),
    });

    const lo = new LoopOrchestrator(
      runner,
      hookManager,
      undefined,
      eventBus,
    );

    await lo.runLoop(makeContext(), {
      maxIterations: 3,
      modelString: 'mock/test',
      sessionId: 's1',
    });

    // Error hook should have been invoked (via Runner error hook mechanism)
    expect(hookErrors.length).toBeGreaterThanOrEqual(1);
  });
});
