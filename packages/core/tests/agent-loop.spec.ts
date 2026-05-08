import { describe, it, expect } from 'vitest';
import { createAgentLoop } from '../src/agent-loop.js';
import { MockLLMAdapter } from './test-utils.js';
import type { AgentEvent, ToolDef, LLMResponse } from '../src/types.js';
import { z } from 'zod';

function textResponse(content: string): LLMResponse {
  return { content, toolCalls: [], finishReason: 'stop' };
}

function toolCallResponse(name: string, args: Record<string, unknown>): LLMResponse {
  return {
    content: null,
    toolCalls: [{ id: 'call-1', name, arguments: args }],
    finishReason: 'tool_calls',
  };
}

const echoTool: ToolDef = {
  name: 'echo',
  description: 'Echoes input',
  schema: z.object({ text: z.string() }),
  execute: async (params) => `Echo: ${params.text}`,
};

describe('createAgentLoop', () => {
  it('returns text when LLM responds with text', async () => {
    const mock = new MockLLMAdapter([textResponse('Hello, world!')]);
    const agent = createAgentLoop(mock, new Map());

    const result = await agent('Say hello');

    expect(result.text).toBe('Hello, world!');
    expect(result.finishReason).toBe('stop');
    expect(result.toolCalls).toEqual([]);
  });

  it('executes tools and continues loop', async () => {
    const mock = new MockLLMAdapter([
      toolCallResponse('echo', { text: 'hi' }),
      textResponse('Done after tool'),
    ]);
    const tools = new Map<string, ToolDef>([['echo', echoTool]]);
    const agent = createAgentLoop(mock, tools);

    const result = await agent('Echo hi');

    expect(result.text).toBe('Done after tool');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe('echo');
    expect(result.toolCalls[0]!.result.output).toBe('Echo: hi');
  });

  it('emits events via onEvent handler', async () => {
    const mock = new MockLLMAdapter([textResponse('ok')]);
    const agent = createAgentLoop(mock, new Map());

    const events: AgentEvent[] = [];
    await agent('test', { onEvent: (e) => events.push(e) });

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('llm_request');
    expect(eventTypes).toContain('llm_response');
    expect(eventTypes).toContain('done');
  });

  it('emits onToken for text content', async () => {
    const mock = new MockLLMAdapter([textResponse('Hello')]);
    const agent = createAgentLoop(mock, new Map());

    const tokens: string[] = [];
    await agent('test', { onToken: (t) => tokens.push(t) });

    expect(tokens).toEqual(['Hello']);
  });

  it('emits tool_call_start and tool_call_end events', async () => {
    const mock = new MockLLMAdapter([
      toolCallResponse('echo', { text: 'x' }),
      textResponse('done'),
    ]);
    const tools = new Map<string, ToolDef>([['echo', echoTool]]);
    const agent = createAgentLoop(mock, tools);

    const events: AgentEvent[] = [];
    await agent('test', { onEvent: (e) => events.push(e) });

    const startEvents = events.filter((e) => e.type === 'tool_call_start');
    const endEvents = events.filter((e) => e.type === 'tool_call_end');

    expect(startEvents).toHaveLength(1);
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]!.result.output).toBe('Echo: x');
  });

  it('returns error result when LLM throws', async () => {
    const mock = new MockLLMAdapter([
      {
        content: null,
        toolCalls: [],
        finishReason: 'error',
      },
    ]);

    // Force error by exhausting responses
    const badMock = {
      chat: async () => {
        throw new Error('API failure');
      },
      maxContextWindow: 128000,
    };

    const agent = createAgentLoop(badMock, new Map());
    const events: AgentEvent[] = [];
    const result = await agent('test', { onEvent: (e) => events.push(e) });

    expect(result.finishReason).toBe('error');
    expect(events.some((e) => e.type === 'agent_error')).toBe(true);
  });

  it('pipes through plugins', async () => {
    const mock = new MockLLMAdapter([textResponse('hello')]);
    const agent = createAgentLoop(mock, new Map(), [
      {
        name: 'prefix-plugin',
        transformRequest(req) {
          return {
            ...req,
            messages: [
              { role: 'system', content: 'PREFIX' },
              ...req.messages,
            ],
          };
        },
      },
    ]);

    await agent('test');
    const llmRequest = mock.requests[0]!;
    expect(llmRequest.messages[0]!.content).toBe('PREFIX');
  });
});
