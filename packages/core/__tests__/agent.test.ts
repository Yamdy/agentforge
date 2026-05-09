import { describe, it, expect } from 'vitest';
import { Agent } from '../src/agent.js';
import type { AgentConfig } from '@agentforge/sdk';

function mockProvider(response: string) {
  return {
    async generate(_messages: unknown[]): Promise<string> {
      return response;
    },
  };
}

describe('Agent', () => {
  it('processes input through 3 stages and returns LLM response', async () => {
    const config: AgentConfig = {
      model: 'mock/test',
      systemPrompt: 'You are helpful.',
    };
    const agent = new Agent(config, mockProvider('Hello! How can I help?'));

    const response = await agent.run('Hi there');

    expect(response).toBe('Hello! How can I help?');
  });

  it('creates PipelineContext with the user input', async () => {
    let capturedInput = '';
    const agent = new Agent(
      { model: 'mock/test' },
      {
        async generate(_messages: unknown[]) {
          const msgs = _messages as Array<{ role: string; content: string }>;
          capturedInput = msgs.find((m) => m.role === 'user')?.content ?? '';
          return 'response';
        },
      },
    );

    await agent.run('what is 2+2?');
    expect(capturedInput).toBe('what is 2+2?');
  });

  it('respects maxIterations from config', async () => {
    let callCount = 0;
    const agent = new Agent(
      { model: 'mock/test', maxIterations: 3 },
      {
        async generate() {
          callCount++;
          return 'thinking...';
        },
      },
    );

    await agent.run('test');
    expect(callCount).toBeLessThanOrEqual(3);
  });
});
