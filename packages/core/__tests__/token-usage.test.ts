import { describe, it, expect } from 'vitest';
import { streamText } from 'ai';
import type { PipelineContext } from '@primo-ai/sdk';
import { PipelineRunner } from '../src/pipeline.js';
import { createMockLanguageModel } from './helpers.js';
import { registerProvider } from '../src/model-resolver.js';
import { ProcessorContextImpl } from '../src/processor-context.js';

describe('Token usage extraction', () => {
  it('stores input/output token counts in pipeline context', async () => {
    const model = createMockLanguageModel({ text: 'Hello', inputTokens: 42, outputTokens: 15 });
    registerProvider('usage', () => model);
    let resultContext: PipelineContext | null = null;

    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx) => {
        const result = streamText({ model, prompt: pCtx.state.session.input });
        const chunks: string[] = [];
        for await (const c of result.textStream) { chunks.push(c); }
        const usage = await result.usage;
        pCtx.state.iteration.response = chunks.join('');
        pCtx.state.iteration.tokenUsage = {
          input: typeof usage?.inputTokens === 'number' ? usage.inputTokens : (usage?.inputTokens as unknown as { total?: number })?.total ?? 0,
          output: typeof usage?.outputTokens === 'number' ? usage.outputTokens : (usage?.outputTokens as unknown as { total?: number })?.total ?? 0,
        };
      },
    });
    runner.register({
      stage: 'processOutput',
      execute: async (pCtx) => { resultContext = pCtx.state; },
    });

    await runner.run(
      {
        agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
        iteration: { step: 0 },
        session: { input: 'test', sessionId: 's1', custom: {} },
      },
      ['invokeLLM', 'processOutput'],
    );

    expect(resultContext!.iteration.tokenUsage).toEqual({ input: 42, output: 15 });
  });
});
