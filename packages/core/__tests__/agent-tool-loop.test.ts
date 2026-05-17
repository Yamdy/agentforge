import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';
import type { LanguageModel } from 'ai';
import { Agent } from '../src/agent.js';
import { registerProvider } from '../src/model-resolver.js';
import { createMockModelWithToolCalls } from './helpers.js';

describe('Agent multi-step tool execution', () => {
  it('executes tool calls via AI SDK loop and returns final text', async () => {
    const model = createMockModelWithToolCalls(
      [{ toolName: 'echo', args: { message: 'hello' } }],
      'Echo says: [echoed: hello]',
    );
    registerProvider('tool-test', () => model);

    const echo: Tool<{ message: string }, string> = {
      name: 'echo',
      description: 'Echoes input',
      inputSchema: z.object({ message: z.string() }),
      execute: async ({ message }) => `[echoed: ${message}]`,
    };

    const agent = new Agent({
      model: 'tool-test/mock',
      tools: [echo],
    });

    const result = await agent.run('test input');
    expect(result.response).toContain('Echo says');
  });

  it('executes multiple tool calls in parallel from a single LLM step', async () => {
    const executionOrder: string[] = [];

    registerProvider('parallel-test', () => {
      let idx = 0;
      const result = {
        modelId: 'mock-parallel',
        specificationVersion: 'v3' as const,
        provider: 'mock',
        supportedUrls: {},
        async doGenerate() {
          const callIdx = idx++;
          if (callIdx === 0) {
            return {
              content: [
                { type: 'tool-call', toolCallId: 'c_a', toolName: 'tool_a', input: '{}' },
                { type: 'tool-call', toolCallId: 'c_b', toolName: 'tool_b', input: '{}' },
              ],
              finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
              usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
            };
          }
          return {
            content: [{ type: 'text', text: 'All done' }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
          };
        },
        async doStream() {
          const callIdx = idx++;
          const stream = new ReadableStream({
            start(controller) {
              if (callIdx === 0) {
                controller.enqueue({ type: 'tool-call', toolCallId: 'c_a', toolName: 'tool_a', input: '{}' });
                controller.enqueue({ type: 'tool-call', toolCallId: 'c_b', toolName: 'tool_b', input: '{}' });
                controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } } });
              } else {
                controller.enqueue({ type: 'text-start', id: 't1' });
                controller.enqueue({ type: 'text-delta', id: 't1', delta: 'All done' });
                controller.enqueue({ type: 'text-end', id: 't1' });
                controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } } });
              }
              controller.close();
            },
          });
          return { stream };
        },
      } as unknown as LanguageModel;
      return result;
    });

    const toolA: Tool = {
      name: 'tool_a',
      description: 'Tool A',
      inputSchema: z.object({}),
      execute: async () => {
        executionOrder.push('a');
        return 'result-a';
      },
    };
    const toolB: Tool = {
      name: 'tool_b',
      description: 'Tool B',
      inputSchema: z.object({}),
      execute: async () => {
        executionOrder.push('b');
        return 'result-b';
      },
    };

    const agent = new Agent({
      model: 'parallel-test/mock',
      tools: [toolA, toolB],
    });

    const result = await agent.run('run both');
    expect(executionOrder).toHaveLength(2);
    expect(executionOrder).toContain('a');
    expect(executionOrder).toContain('b');
    expect(result.response).toContain('All done');
  });

  it('echo tool is available as a built-in without explicit registration', async () => {
    const model = createMockModelWithToolCalls(
      [{ toolName: 'echo', args: { message: 'built-in test' } }],
      'Got: built-in test',
    );
    registerProvider('builtin-echo-test', () => model);

    const agent = new Agent({
      model: 'builtin-echo-test/mock',
      // No tools explicitly provided — echo should be built-in
    });

    const result = await agent.run('test built-in echo');
    expect(result.response).toContain('Got:');
  });

  it('handles tool execution errors gracefully and continues', async () => {
    let callCount = 0;

    registerProvider('error-test', () => {
      const model = {
        modelId: 'mock-error',
        specificationVersion: 'v3' as const,
        provider: 'mock',
        supportedUrls: {},
        async doGenerate() { return { content: [{ type: 'text', text: 'g' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } } }; },
        async doStream() {
          const idx = callCount++;
          const stream = new ReadableStream({
            start(controller) {
              if (idx === 0) {
                controller.enqueue({ type: 'tool-call', toolCallId: 'c1', toolName: 'fail_tool', input: '{"x":"bad"}' });
                controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } } });
              } else {
                controller.enqueue({ type: 'text-start', id: 't1' });
                controller.enqueue({ type: 'text-delta', id: 't1', delta: 'Recovered from error' });
                controller.enqueue({ type: 'text-end', id: 't1' });
                controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } } });
              }
              controller.close();
            },
          });
          return { stream };
        },
      } as unknown as LanguageModel;
      return model;
    });

    const failTool: Tool = {
      name: 'fail_tool',
      description: 'Always fails',
      inputSchema: z.object({ x: z.string() }),
      execute: async () => { throw new Error('Tool crashed!'); },
    };

    const agent = new Agent({
      model: 'error-test/mock',
      tools: [failTool],
    });

    const result = await agent.run('trigger error');
    expect(result.response).toContain('Recovered from error');
  });
});
