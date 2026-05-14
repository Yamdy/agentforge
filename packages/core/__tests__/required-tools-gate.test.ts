import { describe, it, expect } from 'vitest';
import { createEvaluateIterationProcessor } from '../src/processors/evaluate-iteration.js';
import { EventBus } from '../src/event-bus.js';
import type { PipelineContext, Message, AgentConfig } from '@agentforge/sdk';

function makeContext(overrides?: {
  config?: Partial<AgentConfig>;
  history?: Message[];
  toolResults?: unknown[];
  pendingToolCalls?: unknown[];
  tokenUsage?: { input: number; output: number };
  toolDeclarations?: Array<{ name: string; description: string }>;
}): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: {
      config: { model: 'test', ...overrides?.config },
      promptFragments: [],
      toolDeclarations: overrides?.toolDeclarations ?? [],
    },
    iteration: {
      step: 1,
      tokenUsage: overrides?.tokenUsage ?? { input: 100, output: 50 },
      toolResults: overrides?.toolResults as any,
      pendingToolCalls: overrides?.pendingToolCalls as any,
    },
    session: {
      custom: {},
      messageHistory: overrides?.history,
      totalTokenUsage: { input: 0, output: 0 },
    },
  };
}

const assistantWithToolCalls = (names: string[]): Message =>
  ({
    role: 'assistant',
    content: 'calling tools',
    toolCalls: names.map((name, i) => ({
      id: `tc-${i}`,
      name,
      args: {},
    })),
  }) as Message;

describe('requiredTools gate', () => {
  it('continues loop when required tools have not all been called', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search', 'calculate'] },
      history: [assistantWithToolCalls(['search'])],
    });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('continue');
  });

  it('stops loop when all required tools have been called', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search', 'calculate'] },
      history: [
        assistantWithToolCalls(['search']),
        { role: 'tool', content: 'result', toolCallId: 'tc-0', toolName: 'search' },
        assistantWithToolCalls(['calculate']),
      ],
    });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('stop');
  });

  it('counts pendingToolCalls from current iteration', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search'] },
      history: [],
      pendingToolCalls: [{ id: 'tc-0', name: 'search', args: {} }],
    });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('stop');
  });

  it('no-ops when requiredTools is undefined', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({ config: {} });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('stop');
  });

  it('no-ops when requiredTools is empty array', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({ config: { requiredTools: [] } });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('stop');
  });

  it('token overflow still stops even when requiredTools incomplete', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['never_called'] },
      tokenUsage: { input: 90_000, output: 20_000 },
    });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('stop');
  });

  it('emits required_tools:incomplete event via EventBus', async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.subscribe('required_tools:incomplete', (data) => emitted.push(data));

    const processor = createEvaluateIterationProcessor({ eventBus });
    const ctx = makeContext({
      config: { requiredTools: ['search', 'calculate'] },
      history: [assistantWithToolCalls(['search'])],
    });

    await processor.execute(ctx);
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as any).uncalled).toEqual(['calculate']);
    expect((emitted[0] as any).sessionId).toBe('s1');
  });

  it('does not emit event when all required tools are satisfied', async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.subscribe('required_tools:incomplete', (data) => emitted.push(data));

    const processor = createEvaluateIterationProcessor({ eventBus });
    const ctx = makeContext({
      config: { requiredTools: ['search'] },
      history: [assistantWithToolCalls(['search'])],
    });

    await processor.execute(ctx);
    expect(emitted).toHaveLength(0);
  });

  it('sets span attributes for incomplete required tools', async () => {
    const attributes: Record<string, unknown> = {};
    const mockSpan = {
      setAttribute: (key: string, value: unknown) => { attributes[key] = value; return mockSpan; },
      addEvent: () => mockSpan,
      end: () => {},
      name: 'evaluateIteration',
      startChild: () => mockSpan,
      spanContext: () => ({ spanId: 's', traceId: 't' }),
    };

    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search', 'calculate', 'fetch'] },
      history: [assistantWithToolCalls(['search'])],
    });
    ctx.iteration.span = mockSpan as any;

    await processor.execute(ctx);
    expect(attributes['required_tools.incomplete']).toBe(true);
    expect(attributes['required_tools.uncalled']).toContain('calculate');
    expect(attributes['required_tools.uncalled']).toContain('fetch');
  });

  it('does not set required_tools span attributes when all satisfied', async () => {
    const attributes: Record<string, unknown> = {};
    const mockSpan = {
      setAttribute: (key: string, value: unknown) => { attributes[key] = value; return mockSpan; },
      addEvent: () => mockSpan,
      end: () => {},
      name: 'evaluateIteration',
      startChild: () => mockSpan,
      spanContext: () => ({ spanId: 's', traceId: 't' }),
    };

    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search'] },
      history: [assistantWithToolCalls(['search'])],
    });
    ctx.iteration.span = mockSpan as any;

    await processor.execute(ctx);
    expect(attributes['required_tools.incomplete']).toBeUndefined();
  });

  it('injects promptFragments with guidance when tools are incomplete', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search', 'calculate'] },
      history: [assistantWithToolCalls(['search'])],
    });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.agent.promptFragments).toHaveLength(1);
    expect(result.agent.promptFragments[0]).toContain('calculate');
    expect(result.agent.promptFragments[0]).toContain('Required tools not yet called');
  });

  it('does not inject promptFragments when all required tools satisfied', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search'] },
      history: [assistantWithToolCalls(['search'])],
    });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.agent.promptFragments).toHaveLength(0);
  });

  it('continues when requiredTools satisfied and toolResults present', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search'] },
      history: [assistantWithToolCalls(['search'])],
      toolResults: [{ toolCallId: 'tc-0', result: 'found' }],
    });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('continue');
  });

  it('stops when requiredTools satisfied and no toolResults', async () => {
    const processor = createEvaluateIterationProcessor();
    const ctx = makeContext({
      config: { requiredTools: ['search'] },
      history: [assistantWithToolCalls(['search'])],
    });

    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('stop');
  });

  it('emits required_tools:unknown for unregistered tool names', async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.subscribe('required_tools:unknown', (data) => emitted.push(data));

    const processor = createEvaluateIterationProcessor({ eventBus });
    const ctx = makeContext({
      config: { requiredTools: ['search', 'nonExistent'] },
      history: [],
      toolDeclarations: [{ name: 'search', description: 'Search tool' }],
    });

    await processor.execute(ctx);
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as any).unknown).toEqual(['nonExistent']);
  });

  it('warns about unknown tools only once across evaluations', async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.subscribe('required_tools:unknown', (data) => emitted.push(data));

    const processor = createEvaluateIterationProcessor({ eventBus });
    const ctx = makeContext({
      config: { requiredTools: ['nonExistent'] },
      history: [],
      toolDeclarations: [{ name: 'search', description: 'Search tool' }],
    });

    await processor.execute(ctx);
    await processor.execute(ctx);
    expect(emitted).toHaveLength(1);
  });
});
