import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';

describe('AgentSimpleConfig constructor path', () => {
  beforeEach(() => {
    registerMockProvider('simple-mock', (modelId) =>
      createMockLanguageModel({ text: `Hello from ${modelId}!` }),
    );
  });

  it('works with just a model string', async () => {
    const agent = new Agent({ model: 'simple-mock/test' });
    const result = await agent.run('hi');
    expect(result.response).toBe('Hello from test!');
  });

  it('works with model and systemPrompt', async () => {
    const agent = new Agent({ model: 'simple-mock/test', systemPrompt: 'Be helpful.' });
    const result = await agent.run('hello');
    expect(result.response).toBe('Hello from test!');
  });

  it('works with model and maxIterations', async () => {
    let callCount = 0;
    registerMockProvider('simple-iter', () => {
      callCount++;
      return createMockLanguageModel({ text: 'step' });
    });

    const agent = new Agent({ model: 'simple-iter/test', maxIterations: 2 });
    await agent.run('test');
    expect(callCount).toBeLessThanOrEqual(2);
  });

  it('works with model and tools', async () => {
    const agent = new Agent({
      model: 'simple-mock/test',
      tools: [{
        name: 'echo',
        description: 'Echo input',
        inputSchema: {} as unknown,
        execute: async (input: unknown) => input,
      }],
    });
    const result = await agent.run('tool test');
    expect(result.response).toBe('Hello from test!');
  });

  it('works with all AgentSimpleConfig fields', async () => {
    const agent = new Agent({
      model: 'simple-mock/test',
      systemPrompt: 'You are a test bot.',
      maxIterations: 5,
      tools: [],
    });
    const result = await agent.run('full config');
    expect(result.response).toBe('Hello from test!');
  });

  it('backward compat: full AgentConfig still works', async () => {
    const agent = new Agent({
      model: 'simple-mock/test',
      systemPrompt: 'You are helpful.',
      maxIterations: 10,
    });
    const result = await agent.run('backward compat');
    expect(result.response).toBe('Hello from test!');
  });

  it('backward compat: AgentConfig with Dynamic systemPrompt still works', async () => {
    const agent = new Agent({
      model: 'simple-mock/test',
      systemPrompt: (ctx) => `Context for: ${ctx.input}`,
    });
    const result = await agent.run('dynamic');
    expect(result.response).toBe('Hello from test!');
  });
});
