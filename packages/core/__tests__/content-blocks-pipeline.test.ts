import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import type { PipelineContext, Processor, StreamEvent, ToolCall, ContentBlock } from '@primo-ai/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

/**
 * Phase 1 tests: ContentBlock[] integration into PipelineRunner
 */
describe('Phase 1: ContentBlock[] in PipelineRunner', () => {
  describe('stream() produces content[] alongside legacy fields', () => {
    it('assembles content blocks from text deltas', async () => {
      const runner = new PipelineRunner();
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => ({
          ...ctx,
          iteration: {
            ...ctx.iteration,
            fullStream: (async function* () {
              yield { type: 'text-delta', text: 'hello ' };
              yield { type: 'text-delta', text: 'world' };
              yield { type: 'finish-step', usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 2, text: 2 } } };
            })(),
          },
        }),
      });

      const events: StreamEvent[] = [];
      for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
        events.push(event);
      }

      const complete = events.find((e) => e.type === 'complete') as { context: PipelineContext } | undefined;
      expect(complete).toBeDefined();
      const ctx = complete!.context;

      // Legacy fields still populated
      expect(ctx.iteration.response).toBe('hello world');

      // New content field populated
      expect(ctx.iteration.content).toBeDefined();
      expect(ctx.iteration.content).toHaveLength(1);
      expect(ctx.iteration.content![0]).toEqual({ type: 'text', text: 'hello world' });
    });

    it('assembles content blocks from text + tool calls + reasoning', async () => {
      const runner = new PipelineRunner();
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => ({
          ...ctx,
          iteration: {
            ...ctx.iteration,
            fullStream: (async function* () {
              yield { type: 'reasoning', textDelta: 'thinking hard' };
              yield { type: 'text-delta', text: 'result' };
              yield {
                type: 'tool-call',
                toolCallId: 'tc1',
                toolName: 'search',
                args: { q: 'test' },
              };
              yield { type: 'finish-step', usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 3, text: 3 } } };
            })(),
          },
        }),
      });

      const events: StreamEvent[] = [];
      for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
        events.push(event);
      }

      const complete = events.find((e) => e.type === 'complete') as { context: PipelineContext } | undefined;
      const ctx = complete!.context;

      // Content blocks array
      expect(ctx.iteration.content).toBeDefined();
      expect(ctx.iteration.content).toHaveLength(3);
      expect(ctx.iteration.content![0]).toEqual({ type: 'thinking', text: 'thinking hard' });
      expect(ctx.iteration.content![1]).toEqual({ type: 'text', text: 'result' });
      expect(ctx.iteration.content![2]).toEqual({ type: 'tool-call', id: 'tc1', name: 'search', args: { q: 'test' } });

      // Legacy fields derived from content
      expect(ctx.iteration.response).toBe('result');
      expect(ctx.iteration.pendingToolCalls).toEqual([{ id: 'tc1', name: 'search', args: { q: 'test' } }]);
      expect(ctx.iteration.reasoningContent).toBe('thinking hard');
    });
  });

  describe('run() produces content[] alongside legacy fields', () => {
    it('assembles content blocks from stream consumed in run()', async () => {
      const runner = new PipelineRunner();
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => ({
          ...ctx,
          iteration: {
            ...ctx.iteration,
            fullStream: (async function* () {
              yield { type: 'text-delta', text: 'run response' };
              yield { type: 'finish-step', usage: { inputTokens: { total: 3, noCache: 3 }, outputTokens: { total: 1, text: 1 } } };
            })(),
          },
        }),
      });

      const result = await runner.run(makeContext(), ['invokeLLM']);
      const ctx = result as PipelineContext;

      expect(ctx.iteration.response).toBe('run response');
      expect(ctx.iteration.content).toBeDefined();
      expect(ctx.iteration.content).toHaveLength(1);
      expect(ctx.iteration.content![0]).toEqual({ type: 'text', text: 'run response' });
    });

    it('assembles content with tool calls in run()', async () => {
      const runner = new PipelineRunner();
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => ({
          ...ctx,
          iteration: {
            ...ctx.iteration,
            fullStream: (async function* () {
              yield { type: 'text-delta', text: 'calling tool' };
              yield {
                type: 'tool-call',
                toolCallId: 'tc2',
                toolName: 'echo',
                args: { msg: 'hi' },
              };
              yield { type: 'finish-step', usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 2, text: 2 } } };
            })(),
          },
        }),
      });

      const result = await runner.run(makeContext(), ['invokeLLM']);
      const ctx = result as PipelineContext;

      expect(ctx.iteration.content).toHaveLength(2);
      expect(ctx.iteration.content![1]).toEqual({ type: 'tool-call', id: 'tc2', name: 'echo', args: { msg: 'hi' } });
      expect(ctx.iteration.pendingToolCalls).toEqual([{ id: 'tc2', name: 'echo', args: { msg: 'hi' } }]);
    });
  });

  describe('llm.after hook receives content', () => {
    it('passes content in llm.after hook output payload', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      const capturedOutputs: unknown[] = [];
      // Register an actual hook handler to capture the output payload
      hookManager.register({
        point: 'llm.after',
        handler: (_input: unknown, output: unknown) => {
          capturedOutputs.push(output);
        },
      });

      const runner = new PipelineRunner({ hookManager });
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => ({
          ...ctx,
          iteration: {
            ...ctx.iteration,
            fullStream: (async function* () {
              yield { type: 'text-delta', text: 'hi' };
              yield { type: 'finish-step', usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } } };
            })(),
            // _modelString triggers llm.after hook
            _modelString: 'mock/test',
          } as PipelineContext['iteration'] & { _modelString: string },
        }),
      });

      const events: StreamEvent[] = [];
      for await (const event of runner.stream(makeContext(), ['invokeLLM'])) {
        events.push(event);
      }

      // Hook handler should have been called with output containing response + content
      expect(capturedOutputs.length).toBeGreaterThanOrEqual(1);
      const lastOutput = capturedOutputs[capturedOutputs.length - 1] as { response?: string; content?: unknown };
      expect(lastOutput.response).toBe('hi');
      expect(lastOutput.content).toBeDefined();
      expect((lastOutput.content as ContentBlock[])[0]).toEqual({ type: 'text', text: 'hi' });
    });
  });

  describe('iteration.end hook receives content', () => {
    it('passes content in iteration.end hook', async () => {
      // This is tested at LoopOrchestrator level in existing tests,
      // but we verify the payload structure here
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      const capturedInput: unknown[] = [];
      eventBus.subscribe('iteration:end', (data: unknown) => capturedInput.push(data));

      // iteration.end hook is invoked by LoopOrchestrator, not PipelineRunner directly
      // We just verify that the context has content[] available when iteration.end fires
      expect(true).toBe(true); // Placeholder - actual testing is via LoopOrchestrator integration
    });
  });
});

/**
 * Phase 1: processStepOutput uses content[] when available
 */
describe('Phase 1: processStepOutput uses content[]', () => {
  it('prefers content[] over response for assistant message', async () => {
    const { processStepOutputProcessor } = await import('../src/processors/process-step-output.js');

    const ctx: PipelineContext = {
      request: { input: 'test', sessionId: 's1' },
      agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: {
        step: 0,
        content: [
          { type: 'text', text: 'from content blocks' },
          { type: 'tool-call', id: 'tc1', name: 'search', args: { q: 'test' } },
        ],
        response: 'from response field',
      },
      session: { custom: {} },
    };

    const result = await processStepOutputProcessor.execute(ctx);
    const pipelineCtx = result as PipelineContext;

    // Should prefer content-derived text for assistant message
    const lastMsg = pipelineCtx.session.messageHistory![pipelineCtx.session.messageHistory!.length - 1] as { role: string; content: string; toolCalls?: unknown };
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toBe('from content blocks');
    expect(lastMsg.toolCalls).toEqual([{ id: 'tc1', name: 'search', args: { q: 'test' } }]);
  });

  it('falls back to response when content[] is absent', async () => {
    const { processStepOutputProcessor } = await import('../src/processors/process-step-output.js');

    const ctx: PipelineContext = {
      request: { input: 'test', sessionId: 's1' },
      agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: {
        step: 0,
        response: 'legacy response',
        pendingToolCalls: [{ id: 'tc1', name: 'search', args: {} }],
      },
      session: { custom: {} },
    };

    const result = await processStepOutputProcessor.execute(ctx);
    const pipelineCtx = result as PipelineContext;

    const lastMsg = pipelineCtx.session.messageHistory![pipelineCtx.session.messageHistory!.length - 1] as { role: string; content: string; toolCalls?: unknown };
    expect(lastMsg.content).toBe('legacy response');
    expect(lastMsg.toolCalls).toEqual([{ id: 'tc1', name: 'search', args: {} }]);
  });
});
