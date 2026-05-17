import { describe, it, expect } from 'vitest';
import { SimpleProcessorContext } from '../src/simple-context.js';
import type {
  PipelineContext,
  AgentConfig,
  LoopDirective,
  Message,
  TokenUsage,
} from '../src/index.js';

function createMockContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test input', sessionId: 'session-123' },
    agent: {
      config: { model: 'test-model', systemPrompt: 'You are a test assistant.' } as AgentConfig,
      systemPrompt: 'You are a test assistant.',
      toolDeclarations: [{ name: 'test-tool', description: 'A test tool' }],
      promptFragments: [],
    },
    iteration: {
      step: 5,
      loopDirective: { action: 'continue' } as LoopDirective,
      response: 'interim response',
      pendingToolCalls: [],
    },
    session: {
      messageHistory: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
      totalTokenUsage: { input: 100, output: 50 } as TokenUsage,
      custom: { myPlugin: { config: 'enabled' } },
    },
    ...overrides,
  };
}

describe('SimpleProcessorContext', () => {
  it('wraps a PipelineContext provided to the constructor', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc).toBeInstanceOf(SimpleProcessorContext);
  });

  it('.input returns ctx.request.input', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.input).toBe('test input');
  });

  it('.sessionId returns ctx.request.sessionId', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.sessionId).toBe('session-123');
  });

  it('.model returns ctx.agent.config.model', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.model).toBe('test-model');
  });

  it('.systemPrompt returns ctx.agent.systemPrompt', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.systemPrompt).toBe('You are a test assistant.');
  });

  it('.systemPrompt returns undefined when not set', () => {
    const ctx = createMockContext();
    delete ctx.agent.systemPrompt;
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.systemPrompt).toBeUndefined();
  });

  it('.getConfig() returns the full agent config', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    const config = spc.getConfig<AgentConfig>();
    expect(config.model).toBe('test-model');
    expect(config.systemPrompt).toBe('You are a test assistant.');
  });

  it('.step returns ctx.iteration.step', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.step).toBe(5);
  });

  it('.response returns ctx.iteration.response', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.response).toBe('interim response');
  });

  it('.response returns undefined when not set', () => {
    const ctx = createMockContext();
    delete ctx.iteration.response;
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.response).toBeUndefined();
  });

  it('.loopDirective returns ctx.iteration.loopDirective', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.loopDirective).toEqual({ action: 'continue' });
  });

  it('.loopDirective returns undefined when not set', () => {
    const ctx = createMockContext();
    delete ctx.iteration.loopDirective;
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.loopDirective).toBeUndefined();
  });

  it('.messages returns ctx.session.messageHistory', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.messages).toHaveLength(2);
    expect(spc.messages[0].content).toBe('hello');
    expect(spc.messages[1].content).toBe('hi there');
  });

  it('.messages returns [] when messageHistory is undefined', () => {
    const ctx = createMockContext();
    ctx.session.messageHistory = undefined;
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.messages).toEqual([]);
  });

  it('.totalTokens returns ctx.session.totalTokenUsage', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.totalTokens).toEqual({ input: 100, output: 50 });
  });

  it('.totalTokens returns undefined when not set', () => {
    const ctx = createMockContext();
    ctx.session.totalTokenUsage = undefined;
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.totalTokens).toBeUndefined();
  });

  it('.getState reads from ctx.session.custom by namespace', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    const pluginState = spc.getState<{ config: string }>('myPlugin');
    expect(pluginState).toEqual({ config: 'enabled' });
  });

  it('.getState returns undefined for unknown namespace', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.getState('unknown')).toBeUndefined();
  });

  it('.setState writes to ctx.session.custom by namespace', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    spc.setState('myPlugin', { config: 'disabled', version: 2 });
    expect(ctx.session.custom.myPlugin).toEqual({ config: 'disabled', version: 2 });
  });

  it('.raw returns the original PipelineContext (same reference)', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    expect(spc.raw).toBe(ctx);
  });

  it('modifications through raw are visible through wrapper getters (wraps by reference)', () => {
    const ctx = createMockContext();
    const spc = new SimpleProcessorContext(ctx);
    spc.raw.iteration.response = 'modified via raw';
    expect(spc.response).toBe('modified via raw');
    spc.raw.session.messageHistory!.push({ role: 'user', content: 'new message' });
    expect(spc.messages).toHaveLength(3);
  });
});
