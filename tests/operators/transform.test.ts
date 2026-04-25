/**
 * Unit tests for src/operators/transform.ts
 *
 * Tests transform operators: transformLLMParams, transformToolArgs,
 * compressMessages, injectSystemPrompt.
 */

import { of, from, firstValueFrom, toArray } from 'rxjs';
import {
  transformLLMParams,
  transformToolArgs,
  compressMessages,
  injectSystemPrompt,
} from '../../src/operators/transform.js';
import type { AgentEvent, Message } from '../../src/core/index.js';

// ============================================================
// Test Helpers
// ============================================================

const baseEvent = { timestamp: Date.now(), sessionId: 'test-session' };

function createEventStream(events: AgentEvent[]) {
  return from(events);
}

// ============================================================
// transformLLMParams Tests
// ============================================================

describe('transformLLMParams', () => {
  it('should pass through non-llm.request events unchanged', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'test', agentName: 'test', model: { provider: 'openai', model: 'gpt-4' } },
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ temperature: 0.5 })),
        toArray()
      )
    );

    expect(result).toEqual(events);
  });

  it('should transform model parameters in llm.request events', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-3.5-turbo' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(params => ({ ...params, model: 'gpt-4-turbo' })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].model.model).toBe('gpt-4-turbo');
      expect(result[0].model.provider).toBe('openai');
    }
  });

  it('should transform provider in llm.request events', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ provider: 'anthropic', model: 'claude-3' })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].model.provider).toBe('anthropic');
      expect(result[0].model.model).toBe('claude-3');
    }
  });

  it('should preserve original values when transform returns undefined', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({})),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].model.model).toBe('gpt-4');
      expect(result[0].model.provider).toBe('openai');
    }
  });

  it('should preserve timestamp and sessionId', async () => {
    const events: AgentEvent[] = [
      {
        type: 'llm.request',
        timestamp: 1234567890,
        sessionId: 'unique-session-123',
        messages: [],
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ model: 'gpt-4-turbo' })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].timestamp).toBe(1234567890);
      expect(result[0].sessionId).toBe('unique-session-123');
    }
  });

  it('should preserve messages array', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ temperature: 0.7 })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toEqual(messages);
    }
  });

  it('should preserve tools array', async () => {
    const tools = ['search', 'calculator', 'weather'];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-4' },
        tools,
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ model: 'gpt-4-turbo' })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].tools).toEqual(tools);
    }
  });

  it('should not mutate original event object', async () => {
    const originalEvent: AgentEvent = {
      ...baseEvent,
      type: 'llm.request',
      messages: [],
      model: { provider: 'openai', model: 'gpt-4' },
    };
    const originalModel = { ...originalEvent.model };

    await firstValueFrom(
      of(originalEvent).pipe(
        transformLLMParams(() => ({ model: 'gpt-4-turbo' })),
        toArray()
      )
    );

    expect(originalEvent.model).toEqual(originalModel);
    expect(originalEvent.model.model).toBe('gpt-4');
  });

  it('should handle empty messages array', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ model: 'gpt-4-turbo' })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toEqual([]);
    }
  });

  it('should handle multiple llm.request events', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-3.5-turbo' },
      },
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-3.5-turbo' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ model: 'gpt-4-turbo' })),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
    for (const event of result) {
      if (event.type === 'llm.request') {
        expect(event.model.model).toBe('gpt-4-turbo');
      }
    }
  });
});

// ============================================================
// transformToolArgs Tests
// ============================================================

describe('transformToolArgs', () => {
  it('should pass through non-tool.call events unchanged', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => ({ ...args, modified: true })),
        toArray()
      )
    );

    expect(result).toEqual(events);
  });

  it('should transform tool arguments in tool.call events', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'search',
        args: { query: 'test' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => ({ ...args, limit: 10 })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'tool.call') {
      expect(result[0].args).toEqual({ query: 'test', limit: 10 });
    }
  });

  it('should pass tool name to transform function', async () => {
    let capturedName: string | undefined;

    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'weather',
        args: { city: 'Beijing' },
      },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => {
          capturedName = name;
          return args;
        }),
        toArray()
      )
    );

    expect(capturedName).toBe('weather');
  });

  it('should pass original args to transform function', async () => {
    let capturedArgs: Record<string, unknown> | undefined;

    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'search',
        args: { query: 'hello', page: 2 },
      },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => {
          capturedArgs = args;
          return args;
        }),
        toArray()
      )
    );

    expect(capturedArgs).toEqual({ query: 'hello', page: 2 });
  });

  it('should preserve timestamp, sessionId, toolCallId, and toolName', async () => {
    const events: AgentEvent[] = [
      {
        type: 'tool.call',
        timestamp: 1234567890,
        sessionId: 'session-xyz',
        toolCallId: 'call-abc-123',
        toolName: 'calculator',
        args: { expression: '1+1' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => ({ ...args, safe: true })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'tool.call') {
      expect(result[0].timestamp).toBe(1234567890);
      expect(result[0].sessionId).toBe('session-xyz');
      expect(result[0].toolCallId).toBe('call-abc-123');
      expect(result[0].toolName).toBe('calculator');
    }
  });

  it('should not mutate original event object', async () => {
    const originalEvent: AgentEvent = {
      ...baseEvent,
      type: 'tool.call',
      toolCallId: 'tc-1',
      toolName: 'search',
      args: { query: 'test' },
    };
    const originalArgs = { ...originalEvent.args };

    await firstValueFrom(
      of(originalEvent).pipe(
        transformToolArgs((name, args) => ({ ...args, limit: 10 })),
        toArray()
      )
    );

    expect(originalEvent.args).toEqual(originalArgs);
  });

  it('should handle empty args object', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'ping',
        args: {},
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => ({ ...args, timestamp: Date.now() })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'tool.call') {
      expect(result[0].args).toHaveProperty('timestamp');
    }
  });

  it('should allow complete replacement of args', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'legacy_tool',
        args: { old_format: true, data: 'value' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs(() => ({ new_format: true, value: 'transformed' })),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'tool.call') {
      expect(result[0].args).toEqual({ new_format: true, value: 'transformed' });
    }
  });

  it('should handle args with null/undefined values', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'filter',
        args: { include: 'test', exclude: null, optional: undefined },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => {
          // Filter out null/undefined values
          return Object.fromEntries(
            Object.entries(args).filter(([, v]) => v != null)
          );
        }),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'tool.call') {
      expect(result[0].args).toEqual({ include: 'test' });
    }
  });

  it('should handle multiple tool.call events', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'search',
        args: { query: 'first' },
      },
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-2',
        toolName: 'search',
        args: { query: 'second' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => ({ ...args, limit: 5 })),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
    for (const event of result) {
      if (event.type === 'tool.call') {
        expect(event.args.limit).toBe(5);
      }
    }
  });

  it('should allow tool-specific transformations', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'search',
        args: { query: 'test' },
      },
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-2',
        toolName: 'weather',
        args: { city: 'Beijing' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformToolArgs((name, args) => {
          if (name === 'search') {
            return { ...args, limit: 10 };
          }
          if (name === 'weather') {
            return { ...args, units: 'metric' };
          }
          return args;
        }),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
    if (result[0]?.type === 'tool.call') {
      expect(result[0].args.limit).toBe(10);
    }
    if (result[1]?.type === 'tool.call') {
      expect(result[1].args.units).toBe('metric');
    }
  });
});

// ============================================================
// compressMessages Tests
// ============================================================

describe('compressMessages', () => {
  it('should pass through non-llm.request events unchanged', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'test', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          () => true,
          () => []
        ),
        toArray()
      )
    );

    expect(result).toEqual(events);
  });

  it('should compress messages when shouldCompress returns true', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'Message 2' },
      { role: 'assistant', content: 'Response 2' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          msgs => msgs.length > 2,
          msgs => msgs.slice(-2)
        ),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].messages[0]?.content).toBe('Message 2');
    }
  });

  it('should not compress when shouldCompress returns false', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Response 1' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          msgs => msgs.length > 5,
          msgs => msgs.slice(-5)
        ),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].messages).toEqual(messages);
    }
  });

  it('should preserve other event properties', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const events: AgentEvent[] = [
      {
        type: 'llm.request',
        timestamp: 1234567890,
        sessionId: 'session-xyz',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
        tools: ['search', 'calculator'],
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          () => true,
          msgs => msgs.slice(-1)
        ),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].timestamp).toBe(1234567890);
      expect(result[0].sessionId).toBe('session-xyz');
      expect(result[0].model).toEqual({ provider: 'openai', model: 'gpt-4' });
      expect(result[0].tools).toEqual(['search', 'calculator']);
    }
  });

  it('should not mutate original event object', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Response 1' },
    ];
    const originalEvent: AgentEvent = {
      ...baseEvent,
      type: 'llm.request',
      messages,
      model: { provider: 'openai', model: 'gpt-4' },
    };

    await firstValueFrom(
      of(originalEvent).pipe(
        compressMessages(
          () => true,
          msgs => msgs.slice(-1)
        ),
        toArray()
      )
    );

    expect(originalEvent.messages).toHaveLength(2);
  });

  it('should handle empty messages array', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          msgs => msgs.length > 0,
          () => [{ role: 'system' as const, content: 'Default' }]
        ),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      // Empty array has length 0, shouldCompress returns false, so no compression
      expect(result[0].messages).toEqual([]);
    }
  });

  it('should allow compression to single message', async () => {
    const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `Message ${i + 1}`,
    }));
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          msgs => msgs.length > 5,
          () => [{ role: 'system' as const, content: 'Conversation summarized' }]
        ),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(1);
      expect(result[0].messages[0]?.role).toBe('system');
    }
  });

  it('should allow summarization compression', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'What is the weather?' },
      { role: 'assistant', content: 'It is sunny.' },
      { role: 'user', content: 'What about tomorrow?' },
      { role: 'assistant', content: 'It will be cloudy.' },
      { role: 'user', content: 'Should I bring an umbrella?' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          msgs => msgs.length > 3,
          msgs => [
            { role: 'system' as const, content: 'Previous conversation about weather summarized.' },
            ...msgs.slice(-2)
          ]
        ),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(3);
      expect(result[0].messages[0]?.role).toBe('system');
    }
  });

  it('should handle compression that returns empty array', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [{ role: 'user', content: 'Test' }],
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          () => true,
          () => []
        ),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toEqual([]);
    }
  });

  it('should pass messages to shouldCompress function', async () => {
    let receivedMessages: Message[] | undefined;

    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          msgs => {
            receivedMessages = msgs;
            return false;
          },
          () => []
        ),
        toArray()
      )
    );

    expect(receivedMessages).toEqual(messages);
  });

  it('should pass messages to compress function', async () => {
    let receivedMessages: Message[] | undefined;

    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          () => true,
          msgs => {
            receivedMessages = msgs;
            return msgs;
          }
        ),
        toArray()
      )
    );

    expect(receivedMessages).toEqual(messages);
  });

  it('should handle multiple llm.request events', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `${i}` })),
        model: { provider: 'openai', model: 'gpt-4' },
      },
      {
        ...baseEvent,
        type: 'llm.request',
        messages: Array.from({ length: 3 }, (_, i) => ({ role: 'user' as const, content: `${i}` })),
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        compressMessages(
          msgs => msgs.length > 5,
          msgs => msgs.slice(-5)
        ),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(5);
    }
    if (result[1]?.type === 'llm.request') {
      expect(result[1].messages).toHaveLength(3);
    }
  });
});

// ============================================================
// injectSystemPrompt Tests
// ============================================================

describe('injectSystemPrompt', () => {
  it('should pass through non-llm.request events unchanged', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'test', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt('System prompt'),
        toArray()
      )
    );

    expect(result).toEqual(events);
  });

  it('should inject system prompt at the beginning of messages', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt('You are a helpful assistant.'),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(3);
      expect(result[0].messages[0]?.role).toBe('system');
      expect(result[0].messages[0]?.content).toBe('You are a helpful assistant.');
    }
  });

  it('should replace existing system message', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'Old system prompt' },
      { role: 'user', content: 'Hello' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt('New system prompt'),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].messages[0]?.role).toBe('system');
      expect(result[0].messages[0]?.content).toBe('New system prompt');
    }
  });

  it('should support dynamic prompt function', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt(msgs => `You have ${msgs.length} messages to process.`),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages[0]?.content).toBe('You have 2 messages to process.');
    }
  });

  it('should pass messages to dynamic prompt function', async () => {
    let receivedMessages: Message[] | undefined;

    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt(msgs => {
          receivedMessages = msgs;
          return 'System prompt';
        }),
        toArray()
      )
    );

    expect(receivedMessages).toEqual(messages);
  });

  it('should preserve other event properties', async () => {
    const messages: Message[] = [{ role: 'user', content: 'Hello' }];
    const events: AgentEvent[] = [
      {
        type: 'llm.request',
        timestamp: 1234567890,
        sessionId: 'session-xyz',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
        tools: ['search'],
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt('System prompt'),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].timestamp).toBe(1234567890);
      expect(result[0].sessionId).toBe('session-xyz');
      expect(result[0].model).toEqual({ provider: 'openai', model: 'gpt-4' });
      expect(result[0].tools).toEqual(['search']);
    }
  });

  it('should not mutate original event object', async () => {
    const messages: Message[] = [{ role: 'user', content: 'Hello' }];
    const originalEvent: AgentEvent = {
      ...baseEvent,
      type: 'llm.request',
      messages,
      model: { provider: 'openai', model: 'gpt-4' },
    };

    await firstValueFrom(
      of(originalEvent).pipe(
        injectSystemPrompt('System prompt'),
        toArray()
      )
    );

    expect(originalEvent.messages).toHaveLength(1);
    expect(originalEvent.messages[0]?.role).toBe('user');
  });

  it('should handle empty messages array', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [],
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt('System prompt'),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(1);
      expect(result[0].messages[0]?.role).toBe('system');
    }
  });

  it('should handle messages with multiple system messages', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'First system' },
      { role: 'system', content: 'Second system' },
      { role: 'user', content: 'Hello' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt('New system'),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      // All system messages should be replaced
      const systemCount = result[0].messages.filter(m => m.role === 'system').length;
      expect(systemCount).toBe(1);
      expect(result[0].messages).toHaveLength(2);
    }
  });

  it('should preserve non-system messages in order', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'Old system' },
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Second' },
      { role: 'user', content: 'Third' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt('New system'),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages).toHaveLength(4);
      expect(result[0].messages[0]?.role).toBe('system');
      expect(result[0].messages[1]?.content).toBe('First');
      expect(result[0].messages[2]?.content).toBe('Second');
      expect(result[0].messages[3]?.content).toBe('Third');
    }
  });

  it('should allow extending existing system message', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hello' },
    ];
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages,
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt(msgs => {
          const existing = msgs.find(m => m.role === 'system');
          return existing ? `${existing.content}\n\nAlso be concise.` : 'Be helpful and concise.';
        }),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].messages[0]?.content).toBe('Be helpful.\n\nAlso be concise.');
    }
  });

  it('should handle multiple llm.request events', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [{ role: 'user', content: 'First' }],
        model: { provider: 'openai', model: 'gpt-4' },
      },
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [{ role: 'user', content: 'Second' }],
        model: { provider: 'openai', model: 'gpt-4' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        injectSystemPrompt('System prompt'),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
    for (const event of result) {
      if (event.type === 'llm.request') {
        expect(event.messages[0]?.role).toBe('system');
      }
    }
  });
});

// ============================================================
// Edge Cases and Integration
// ============================================================

describe('Transform Operators Integration', () => {
  it('should handle empty stream', async () => {
    const result = await firstValueFrom(
      of<AgentEvent>().pipe(
        transformLLMParams(() => ({ temperature: 0.5 })),
        transformToolArgs((name, args) => args),
        compressMessages(() => false, msgs => msgs),
        injectSystemPrompt('System'),
        toArray()
      )
    );

    expect(result).toHaveLength(0);
  });

  it('should chain multiple transform operators', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [
          { role: 'user', content: 'Message 1' },
          { role: 'assistant', content: 'Response 1' },
          { role: 'user', content: 'Message 2' },
        ],
        model: { provider: 'openai', model: 'gpt-3.5-turbo' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ model: 'gpt-4' })),
        compressMessages(
          msgs => msgs.length > 2,
          msgs => msgs.slice(-2)
        ),
        injectSystemPrompt('You are helpful.'),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    if (result[0]?.type === 'llm.request') {
      expect(result[0].model.model).toBe('gpt-4');
      expect(result[0].messages[0]?.role).toBe('system');
      // Messages: system + last 2 original
      expect(result[0].messages).toHaveLength(3);
    }
  });

  it('should preserve event order through transforms', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'tool.call', toolCallId: 'tc-1', toolName: 'test', args: {} },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ temperature: 0.5 })),
        transformToolArgs((name, args) => ({ ...args, modified: true })),
        toArray()
      )
    );

    expect(result).toHaveLength(3);
    expect(result[0]?.type).toBe('llm.request');
    expect(result[1]?.type).toBe('tool.call');
    expect(result[2]?.type).toBe('done');
  });

  it('should handle mixed event types correctly', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [{ role: 'user', content: 'Hello' }],
        model: { provider: 'openai', model: 'gpt-4' },
      },
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'search',
        args: { query: 'test' },
      },
      {
        ...baseEvent,
        type: 'llm.request',
        messages: [{ role: 'user', content: 'World' }],
        model: { provider: 'openai', model: 'gpt-4' },
      },
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-2',
        toolName: 'weather',
        args: { city: 'Beijing' },
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        transformLLMParams(() => ({ temperature: 0.7 })),
        transformToolArgs((name, args) => ({ ...args, timestamp: Date.now() })),
        injectSystemPrompt('Be helpful'),
        toArray()
      )
    );

    expect(result).toHaveLength(4);
    // Check llm.request events have system prompt
    const llmRequests = result.filter(e => e.type === 'llm.request');
    expect(llmRequests).toHaveLength(2);
    for (const event of llmRequests) {
      if (event.type === 'llm.request') {
        expect(event.messages[0]?.role).toBe('system');
      }
    }
    // Check tool.call events have timestamp
    const toolCalls = result.filter(e => e.type === 'tool.call');
    expect(toolCalls).toHaveLength(2);
    for (const event of toolCalls) {
      if (event.type === 'tool.call') {
        expect(event.args).toHaveProperty('timestamp');
      }
    }
  });

  it('should preserve immutability through multiple operators', async () => {
    const originalMessages: Message[] = [{ role: 'user', content: 'Original' }];
    const originalEvent: AgentEvent = {
      ...baseEvent,
      type: 'llm.request',
      messages: originalMessages,
      model: { provider: 'openai', model: 'gpt-4' },
    };

    await firstValueFrom(
      of(originalEvent).pipe(
        transformLLMParams(() => ({ model: 'gpt-4-turbo' })),
        injectSystemPrompt('System'),
        compressMessages(
          () => true,
          msgs => msgs.slice(0, 2)
        ),
        toArray()
      )
    );

    // Original should be unchanged
    expect(originalEvent.messages).toHaveLength(1);
    expect(originalEvent.messages[0]?.content).toBe('Original');
    expect(originalEvent.model.model).toBe('gpt-4');
  });
});
