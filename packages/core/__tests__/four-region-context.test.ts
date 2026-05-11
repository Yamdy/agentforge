import { describe, it, expect } from 'vitest';
import type {
  PipelineContext,
  RequestRegion,
  AgentRegion,
  IterationRegion,
  SessionRegion,
  LoopDirective,
  Message,
} from '@agentforge/sdk';
import type { AgentConfig } from '@agentforge/sdk';

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
