import { describe, it, expect } from 'vitest';
import { streamText } from 'ai';
import type { PipelineContext } from '@primo-ai/sdk';
import { PipelineRunner } from '../src/pipeline.js';
import { createMockLanguageModel } from './helpers.js';
import { registerProvider } from '../src/model-resolver.js';

describe('Token usage extraction', () => {
  it('stores input/output token counts in pipeline context', async () => {
    const model = createMockLanguageModel({ text: 'Hello', inputTokens: 42, outputTokens: 15 });
    registerProvider('usage', () => model);
    let resultContext: PipelineContext | null = null;

    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => {
        const result = streamText({ model, prompt: ctx.request.input });
        const chunks: string[] = [];
        for await (const c of result.textStream) { chunks.push(c); }
        const usage = await result.usage;
        return {
          ...ctx,
          iteration: {
            ...ctx.iteration,
            response: chunks.join(''),
            tokenUsage: {
              input: typeof usage?.inputTokens === 'number' ? usage.inputTokens : (usage?.inputTokens as unknown as { total?: number })?.total ?? 0,
              output: typeof usage?.outputTokens === 'number' ? usage.outputTokens : (usage?.outputTokens as unknown as { total?: number })?.total ?? 0,
            },
          },
        };
      },
    });
    runner.register({
      stage: 'processOutput',
      execute: async (ctx) => { resultContext = ctx; return ctx; },
    });

    await runner.run(
      {
        request: { input: 'test', sessionId: 's1' },
        agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
        iteration: { step: 0 },
        session: { custom: {} },
      },
      ['invokeLLM', 'processOutput'],
    );

    expect(resultContext!.iteration.tokenUsage).toEqual({ input: 42, output: 15 });
  });
});
