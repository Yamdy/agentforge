import { describe, it, expect, beforeEach } from 'vitest';
import type {
  PipelineContext,
  LoopDirective,
  Message,
} from '@agentforge/sdk';
import type { AgentConfig } from '@agentforge/sdk';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';

describe('Four-Region PipelineContext', () => {
  it('has request, agent, iteration, and session regions', () => {
    const ctx: PipelineContext = {
      request: { input: 'hello', sessionId: 's1' },
      agent: {
        config: { model: 'test' } as AgentConfig,
        promptFragments: [],
        toolDeclarations: [],
      },
      iteration: { step: 0 },
      session: { custom: {} },
    };

    expect(ctx.request.input).toBe('hello');
    expect(ctx.request.sessionId).toBe('s1');
    expect(Array.isArray(ctx.agent.promptFragments)).toBe(true);
    expect(Array.isArray(ctx.agent.toolDeclarations)).toBe(true);
    expect(ctx.iteration.step).toBe(0);
    expect(typeof ctx.session.custom).toBe('object');
  });

  it('supports LoopDirective discriminated union', () => {
    const stop: LoopDirective = { action: 'stop' };
    const cont: LoopDirective = { action: 'continue' };
    const retry: LoopDirective = { action: 'retry', retryFrom: 'invokeLLM' };

    expect(stop.action).toBe('stop');
    expect(cont.action).toBe('continue');
    expect(retry.action).toBe('retry');
    if (retry.action === 'retry') {
      expect(retry.retryFrom).toBe('invokeLLM');
    }
  });

  it('supports typed messageHistory in session', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const ctx: PipelineContext = {
      request: { input: 'hello', sessionId: 's1' },
      agent: { config: {} as AgentConfig, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { messageHistory: messages, custom: {} },
    };

    expect(ctx.session.messageHistory?.length).toBe(2);
    expect(ctx.session.messageHistory?.[0].role).toBe('user');
  });

  it('does NOT have pipeline or untyped config fields', () => {
    const ctx: PipelineContext = {
      request: { input: 'hello', sessionId: 's1' },
      agent: { config: {} as AgentConfig, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { custom: {} },
    };

    // Verify old fields don't exist on the runtime object
    expect('pipeline' in ctx).toBe(false);
    expect('config' in ctx).toBe(false);

    // Verify the four expected regions exist
    expect('request' in ctx).toBe(true);
    expect('agent' in ctx).toBe(true);
    expect('iteration' in ctx).toBe(true);
    expect('session' in ctx).toBe(true);
  });
});

describe('Agent with four-region context', () => {
  beforeEach(() => {
    registerMockProvider('mock', () => createMockLanguageModel({ text: 'Hello world' }));
  });

  it('produces response in iteration region', async () => {
    const agent = new Agent({ model: 'mock/test', maxIterations: 1 });
    const response = await agent.run('Hi');
    expect(response.response).toBe('Hello world');
  });

  it('stops after first iteration when evaluateIteration sets stop (default)', async () => {
    registerMockProvider('mock', () => createMockLanguageModel({ text: 'step done' }));
    const agent = new Agent({ model: 'mock/test', maxIterations: 5 });
    const response = await agent.run('test');
    expect(response.response).toBe('step done');
  });

  it('continues loop when evaluateIteration sets continue', async () => {
    registerMockProvider('mock', () => createMockLanguageModel({ text: 'step done' }));
    const agent = new Agent({ model: 'mock/test', maxIterations: 5 });
    let iterations = 0;

    agent.use({
      stage: 'evaluateIteration',
      execute: async (ctx) => {
        iterations++;
        return {
          ...ctx,
          iteration: {
            ...ctx.iteration,
            loopDirective: iterations < 3 ? { action: 'continue' } : { action: 'stop' },
          },
        };
      },
    });

    await agent.run('test');
    expect(iterations).toBe(3);
  });
});
