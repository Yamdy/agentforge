import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Runtime } from '../src/runtime.js';
import { MockLLMAdapter } from './test-utils.js';
import type { ToolDef } from '../src/types.js';

const echoTool: ToolDef = {
  name: 'echo',
  description: 'Echoes input',
  schema: z.object({ text: z.string() }),
  execute: async (params) => `Echo: ${params.text}`,
};

describe('Runtime', () => {
  it('creates agent and runs hello world', async () => {
    const mock = new MockLLMAdapter([
      { content: 'Hello, world!', toolCalls: [], finishReason: 'stop' },
    ]);
    const runtime = new Runtime({ llm: mock });

    const agent = runtime.agent();
    const result = await agent('Say hello');

    expect(result.text).toBe('Hello, world!');
  });

  it('registers tools globally and makes them available to agents', async () => {
    const mock = new MockLLMAdapter([
      { content: null, toolCalls: [{ id: '1', name: 'echo', arguments: { text: 'hi' } }], finishReason: 'tool_calls' },
      { content: 'Done', toolCalls: [], finishReason: 'stop' },
    ]);
    const runtime = new Runtime({ llm: mock });
    runtime.registerTool('echo', echoTool);

    const agent = runtime.agent({ tools: ['echo'] });
    const result = await agent('Echo hi');

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe('echo');
  });

  it('supports plugins on agent', async () => {
    const mock = new MockLLMAdapter([
      { content: 'hello', toolCalls: [], finishReason: 'stop' },
    ]);
    const runtime = new Runtime({ llm: mock });

    const agent = runtime.agent({
      tools: [],
      plugins: [{
        name: 'prefix',
        transformRequest(req) {
          return { ...req, messages: [{ role: 'system', content: 'PREFIX' }, ...req.messages] };
        },
      }],
    });
    await agent('test');

    const llmRequest = mock.requests[0]!;
    expect(llmRequest.messages[0]!.content).toBe('PREFIX');
  });

  it('throws for unknown tool name', async () => {
    const mock = new MockLLMAdapter([
      { content: 'ok', toolCalls: [], finishReason: 'stop' },
    ]);
    const runtime = new Runtime({ llm: mock });

    expect(() => runtime.agent({ tools: ['nonexistent'] })).toThrow();
  });
});
