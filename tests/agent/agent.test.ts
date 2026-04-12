import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../../src/agent';
import { LLMAdapter, StreamEvent } from '../../src/types';
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
});
