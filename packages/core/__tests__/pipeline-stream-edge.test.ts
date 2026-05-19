import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import type { PipelineContext, ProcessorContext, StreamEvent } from '@primo-ai/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

describe('PipelineRunner stream edge cases', () => {
  it('yields tool_call events from fullStream', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx: ProcessorContext) => {
        pCtx.state.iteration.fullStream = (async function* () {
          yield { type: 'tool-call', toolCallId: 'tc-1', toolName: 'echo', args: { input: 'hi' } };
          yield { type: 'finish-step', usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 3, text: 3 } } };
        })();
      },
    });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
      events.push(event);
    }

    const toolCalls = events.filter((e): e is StreamEvent & { type: 'tool_call' } => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('echo');
    expect(toolCalls[0].args).toEqual({ input: 'hi' });

    const complete = events.find(e => e.type === 'complete') as unknown as { type: 'complete'; context: PipelineContext };
    expect(complete).toBeDefined();
    expect(complete.context.iteration.pendingToolCalls!).toHaveLength(1);
    expect(complete.context.iteration.pendingToolCalls![0].name).toBe('echo');
  });

  it('captures reasoning events and sets reasoningContent', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx: ProcessorContext) => {
        pCtx.state.iteration.fullStream = (async function* () {
          yield { type: 'reasoning', textDelta: 'thinking...' };
          yield { type: 'text-delta', text: 'answer' };
          yield { type: 'finish-step', usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 3, text: 3 } } };
        })();
      },
    });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'complete') as unknown as { type: 'complete'; context: PipelineContext };
    expect(complete).toBeDefined();
    expect(complete.context.iteration.reasoningContent).toBe('thinking...');
  });

  it('falls back to reasoningPromise when no reasoning events in stream', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx: ProcessorContext) => {
        pCtx.state.iteration.fullStream = (async function* () {
          yield { type: 'text-delta', text: 'answer' };
          yield { type: 'finish-step', usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 3, text: 3 } } };
        })();
        pCtx.state.iteration.reasoningPromise = Promise.resolve('deferred reasoning');
      },
    });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'complete') as unknown as { type: 'complete'; context: PipelineContext };
    expect(complete.context.iteration.reasoningContent).toBe('deferred reasoning');
  });

  it('falls back to usagePromise when no finish-step in stream', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx: ProcessorContext) => {
        pCtx.state.iteration.fullStream = (async function* () {
          yield { type: 'text-delta', text: 'answer' };
        })();
        pCtx.state.iteration.usagePromise = Promise.resolve({ input: 42, output: 7 });
      },
    });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'complete') as unknown as { type: 'complete'; context: PipelineContext };
    expect(complete.context.iteration.tokenUsage).toEqual({ input: 42, output: 7 });
  });

  it('throws when fullStream yields an error event', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx: ProcessorContext) => {
        pCtx.state.iteration.fullStream = (async function* () {
          yield { type: 'error', error: new Error('stream broke') };
        })();
      },
    });

    const gen = runner.stream(makeContext(), ['invokeLLM']);
    // First yield is stage_start
    const first = await gen.next();
    expect(first.value.type).toBe('stage_start');
    // Second iteration consumes fullStream and throws on error event
    await expect(gen.next()).rejects.toThrow('stream broke');
  });

  it('handles stages with no registered processor (pass-through)', async () => {
    const runner = new PipelineRunner();

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['processInput'])) {
      events.push(event);
    }

    expect(events.some(e => e.type === 'stage_start')).toBe(true);
    expect(events.some(e => e.type === 'complete')).toBe(true);
  });

  it('handles empty stages array', async () => {
    const runner = new PipelineRunner();

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), [])) {
      events.push(event);
    }

    expect(events.filter(e => e.type === 'stage_start')).toHaveLength(0);
    expect(events.some(e => e.type === 'complete')).toBe(true);
  });

  it('yields complete event with final context', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'processOutput',
      execute: async (pCtx: ProcessorContext) => {
        pCtx.state.iteration.response = 'final answer';
      },
    });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(makeContext(), ['processOutput'])) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'complete') as unknown as { type: 'complete'; context: PipelineContext };
    expect(complete.context.iteration.response).toBe('final answer');
  });
});
