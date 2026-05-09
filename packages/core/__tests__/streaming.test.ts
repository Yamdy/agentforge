import { describe, it, expect } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AgentConfig } from '@agentforge/sdk';

describe('Agent with Vercel AI SDK', () => {
  it('calls LLM via streamText and returns the full response', async () => {
    registerMockProvider('mock', (modelId) =>
      createMockLanguageModel({ text: `Hello from ${modelId}!` }),
    );
    const config: AgentConfig = { model: 'mock/test-model' };
    const agent = new Agent(config);

    const response = await agent.run('Hi');
    expect(response).toBe('Hello from test-model!');
  });

  it('yields streaming chunks via AsyncGenerator', async () => {
    registerMockProvider('stream-test', () =>
      createMockLanguageModel({ text: 'Hello world' }),
    );
    const config: AgentConfig = { model: 'stream-test/model' };
    const agent = new Agent(config);

    const chunks: string[] = [];
    for await (const chunk of agent.stream('Hi')) {
      chunks.push(chunk);
    }

    expect(chunks).toContain('Hello world');
  });
});
