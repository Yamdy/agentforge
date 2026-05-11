import { describe, it, expect } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AbortSignal, AgentConfig } from '@agentforge/sdk';

describe('Agent streaming through pipeline', () => {
  it('yields streaming chunks via AsyncGenerator through the pipeline', async () => {
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

  it('stream and run produce the same final text', async () => {
    registerMockProvider('consistency', () =>
      createMockLanguageModel({ text: 'Same response' }),
    );
    const config: AgentConfig = { model: 'consistency/model' };
    const agent = new Agent(config);

    const runResult = await agent.run('test');

    const streamChunks: string[] = [];
    for await (const chunk of agent.stream('test')) {
      streamChunks.push(chunk);
    }
    const streamResult = streamChunks.join('');

    expect(runResult).toBe(streamResult);
  });

  it('throws when a processor returns an AbortSignal', async () => {
    registerMockProvider('stream-abort', () =>
      createMockLanguageModel({ text: 'Should not reach' }),
    );
    const config: AgentConfig = { model: 'stream-abort/model', maxIterations: 1 };
    const agent = new Agent(config);

    agent.use({
      stage: 'processStepOutput',
      execute: async (_ctx): Promise<AbortSignal> => ({
        type: 'abort',
        reason: 'Safety guardrail triggered',
      }),
    });

    const iterate = async () => {
      for await (const _chunk of agent.stream('Do something bad')) {
        // drain the generator
      }
    };

    await expect(iterate()).rejects.toThrow(
      'Agent aborted: Safety guardrail triggered',
    );
  });
});
