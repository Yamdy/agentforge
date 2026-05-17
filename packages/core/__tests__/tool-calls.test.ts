import { describe, it, expect } from 'vitest';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import type { PipelineContext } from '@primo-ai/sdk';
import type { LanguageModel } from 'ai';
import { PipelineRunner } from '../src/pipeline.js';

function createMockModelWithToolCall(): LanguageModel {
  return {
    modelId: 'mock-tool',
    specificationVersion: 'v2',
    provider: 'mock',
    supportedUrls: {},
    async doGenerate() {
      return { text: '', toolCalls: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', args: { path: '/etc/hosts' } }] } as unknown;
    },
    async doStream() {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'tool-call',
            toolCallType: 'function',
            toolCallId: 'call_1',
            toolName: 'read_file',
            args: '{"path": "/etc/hosts"}',
          });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 10, noCache: 10 },
              outputTokens: { total: 5, text: 5 },
            },
          });
          controller.close();
        },
      });
      return { stream } as unknown;
    },
  } as unknown as LanguageModel;
}

describe('Tool call parsing', () => {
  it('detects tool calls in the LLM response', async () => {
    const model = createMockModelWithToolCall();
    let resultContext: PipelineContext | null = null;

    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => {
        const result = streamText({
          model,
          tools: {
            read_file: tool({
              description: 'Read a file',
              inputSchema: z.object({ path: z.string() }),
              execute: async ({ path: _path }) => 'file content',
            }),
          },
          prompt: ctx.request.input,
        });

        const chunks: string[] = [];
        for await (const c of result.textStream) { chunks.push(c); }

        const toolCalls = await result.toolCalls;
        const usage = await result.usage;

        return {
          ...ctx,
          iteration: {
            ...ctx.iteration,
            response: chunks.join(''),
            tokenUsage: { input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0 },
          },
          session: {
            ...ctx.session,
            custom: {
              ...ctx.session.custom,
              toolCalls: toolCalls ?? [],
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
        request: { input: 'read the hosts file', sessionId: 's1' },
        agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
        iteration: { step: 0 },
        session: { custom: {} },
      },
      ['invokeLLM', 'processOutput'],
    );

    const tc = resultContext!.session.custom.toolCalls as Array<Record<string, unknown>>;
    expect(tc).toHaveLength(1);
    expect(tc[0].toolName).toBe('read_file');
    expect(tc[0].toolCallId).toBe('call_1');
  });
});
