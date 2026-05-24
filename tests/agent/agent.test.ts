import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../../src/agent';
import { LLMAdapter, StreamEvent, Message } from '../../src/types';
import { InMemoryHistory } from '../../src/history';
import { ToolRegistry } from '../../src/registry';
import { of } from 'rxjs';

function createMockAdapter(events: StreamEvent[][]): LLMAdapter {
  let index = 0;
  return {
    chat: async () => ({ content: 'done' }),
    chatStream: () => {
      if (index < events.length) {
        const currentEvents = events[index];
        index++;
        return of(...currentEvents);
      }
      return of();
    },
  } as LLMAdapter;
}

describe('Agent', () => {
  it('should return text response', async () => {
    const adapter = createMockAdapter([
      [
        { type: 'text', content: 'Hello' },
        { type: 'text', content: '!' },
        { type: 'done', response: { content: 'Hello!', finishReason: 'stop' } },
      ],
    ]);
    const history = new InMemoryHistory();
    const registry = new ToolRegistry();

    const agent = new Agent(adapter, history, registry, { maxSteps: 10 });
    const response = await agent.run('Hi');

    expect(response).toBe('Hello!');
  });

  it('should include system prompt in messages', async () => {
    let capturedMessages: Message[] | undefined;
    const mockAdapter: LLMAdapter = {
      chat: async () => ({ content: 'Response' }),
      chatStream: (messages: Message[]) => {
        capturedMessages = messages;
        return of([
          { type: 'text', content: 'Response' },
          { type: 'done', response: { content: 'Response', finishReason: 'stop' } },
        ]);
      },
    } as LLMAdapter;

    const history = new InMemoryHistory();
    const registry = new ToolRegistry();
    const systemPrompt = 'You are a helpful assistant that always responds in JSON.';

    const agent = new Agent(mockAdapter, history, registry, {
      maxSteps: 10,
      systemPrompt,
    });
    const response = await agent.run('Hi');

    // Check that system prompt is the first message
    expect(capturedMessages).toBeDefined();
    expect(capturedMessages![0]).toEqual({
      role: 'system',
      content: systemPrompt,
    });
    // Check that user prompt follows
    expect(capturedMessages![1]).toEqual({
      role: 'user',
      content: 'Hi',
    });

    // Check getter/setter
    expect(agent.systemPrompt).toBe(systemPrompt);
    agent.systemPrompt = 'New system prompt';
    expect(agent.systemPrompt).toBe('New system prompt');
  });
});
