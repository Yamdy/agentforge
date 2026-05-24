import { describe, test, expect } from 'vitest';
import { createStep, createAgentStep } from '../../src/workflow/step.js';
import { Agent } from '../../src/agent/index.js';
import type { LLMAdapter } from '../../src/types.js';
import { InMemoryHistory } from '../../src/history.js';
import { ToolRegistry } from '../../src/registry.js';
import { Observable } from 'rxjs';

describe('Step', () => {
  test('createStep should create a step', async () => {
    const step = createStep('test-step', async (input: number) => input * 2);
    expect(step.id).toBe('test-step');

    const context = {
      getResult: () => undefined,
      setResult: () => {},
      getState: () => ({}),
      setState: () => {},
    };
    const result = await step.execute(5, context);
    expect(result).toBe(10);
  });

  test('createAgentStep should create a step from agent', async () => {
    const adapter: LLMAdapter = {
      chat: async () => ({ content: 'Hello!', toolCalls: undefined, finishReason: 'stop' }),
      chatStream: () =>
        new Observable((observer) => {
          observer.next({ type: 'text', content: 'Hello!' });
          observer.next({
            type: 'done',
            response: {
              content: 'Hello!',
              finishReason: 'stop',
              toolCalls: [],
            },
          });
          observer.complete();
        }),
    };
    const history = new InMemoryHistory();
    const registry = new ToolRegistry();
    const agent = new Agent(adapter, history, registry);

    const step = createAgentStep('agent-step', agent);
    expect(step.id).toBe('agent-step');

    const context = {
      getResult: () => undefined,
      setResult: () => {},
      getState: () => ({}),
      setState: () => {},
    };
    const result = await step.execute('Hi', context);
    expect(result).toBe('Hello!');
  });
});
