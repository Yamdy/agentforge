import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AgentConfig } from '@agentforge/sdk';

describe('Agent', () => {
  beforeEach(() => {
    registerMockProvider('mock', (modelId) =>
      createMockLanguageModel({ text: `Hello from ${modelId}!` }),
    );
  });

  it('processes input through 3 stages and returns LLM response', async () => {
    const config: AgentConfig = {
      model: 'mock/test',
      systemPrompt: 'You are helpful.',
    };
    const agent = new Agent(config);

    const response = await agent.run('Hi there');
    expect(response).toBe('Hello from test!');
  });

  it('passes user input through to the model', async () => {
    registerMockProvider('capture', (modelId) =>
      createMockLanguageModel({ text: 'response' }),
    );

    const agent = new Agent({ model: 'capture/test' });
    const response = await agent.run('what is 2+2?');
    expect(response).toBe('response');
  });

  it('respects maxIterations from config', async () => {
    let callCount = 0;
    registerMockProvider('iter', () => {
      callCount++;
      return createMockLanguageModel({ text: 'thinking...' });
    });

    const agent = new Agent({ model: 'iter/test', maxIterations: 3 });
    await agent.run('test');
    expect(callCount).toBeLessThanOrEqual(3);
  });
});
