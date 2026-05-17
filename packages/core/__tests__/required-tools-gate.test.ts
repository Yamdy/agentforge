import { describe, it, expect } from 'vitest';
import { createEvaluateIterationProcessor } from '../src/processors/evaluate-iteration.js';
import { EventBus } from '../src/event-bus.js';
import type { PipelineContext, Message, AgentConfig, ToolCall, ToolResult, Span } from '@primo-ai/sdk';

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
      toolResults: overrides?.toolResults as unknown as ToolResult[] | undefined,
      pendingToolCalls: overrides?.pendingToolCalls as unknown as ToolCall[] | undefined,
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
    expect((emitted[0] as { uncalled: string[] }).uncalled).toEqual(['calculate']);
    expect((emitted[0] as { sessionId: string }).sessionId).toBe('s1');
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
    ctx.iteration.span = mockSpan as unknown as Span;

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
    ctx.iteration.span = mockSpan as unknown as Span;

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
    expect((emitted[0] as { unknown: string[] }).unknown).toEqual(['nonExistent']);
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

  // ---- requiredToolPolicy: 'enforce' ----

  it('with enforce policy, injects synthetic pendingToolCalls for exhausted tools instead of stopping', async () => {
    // Simulate 3 retries exhausted by calling processor 3 times with no tool calls in history
    const processor = createEvaluateIterationProcessor();
    const baseCtx = makeContext({
      config: { requiredTools: ['search', 'calculate'], requiredToolPolicy: 'enforce' },
      history: [],
    });

    // First two calls: advisory continue (not exhausted yet)
    let result = await processor.execute(baseCtx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('continue');

    result = await processor.execute(baseCtx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('continue');

    // Third call: exhausted — enforce mode should inject synthetic calls and continue
    result = await processor.execute(baseCtx) as PipelineContext;
    expect(result.iteration.loopDirective?.action).toBe('continue');
    expect(result.iteration.pendingToolCalls).toBeDefined();
    expect(result.iteration.pendingToolCalls!.length).toBe(2);

    const callNames = result.iteration.pendingToolCalls!.map(tc => tc.name);
    expect(callNames).toContain('search');
    expect(callNames).toContain('calculate');

    for (const tc of result.iteration.pendingToolCalls!) {
      expect(tc.id).toMatch(/^required-/);
      expect(tc.args).toEqual({});
    }
  });

  it('with advise policy (default), stops loop when exhausted (current behavior preserved)', async () => {
    const processor = createEvaluateIterationProcessor();
    const baseCtx = makeContext({
      config: { requiredTools: ['search'], requiredToolPolicy: 'advise' },
      history: [],
    });

    // Exhaust retries
    await processor.execute(baseCtx);
    await processor.execute(baseCtx);
    const result = await processor.execute(baseCtx) as PipelineContext;

    expect(result.iteration.loopDirective?.action).toBe('stop');
    expect(result.iteration.pendingToolCalls).toBeUndefined();
    expect(result.agent.promptFragments.length).toBeGreaterThan(0);
  });

  it('with advise policy (implicit default when undefined), stops loop when exhausted', async () => {
    const processor = createEvaluateIterationProcessor();
    const baseCtx = makeContext({
      config: { requiredTools: ['search'] },  // no requiredToolPolicy → defaults to 'advise'
      history: [],
    });

    // Exhaust retries
    await processor.execute(baseCtx);
    await processor.execute(baseCtx);
    const result = await processor.execute(baseCtx) as PipelineContext;

    expect(result.iteration.loopDirective?.action).toBe('stop');
    expect(result.iteration.pendingToolCalls).toBeUndefined();
  });

  it('with enforce policy, emits required_tools:enforced event when injecting synthetic calls', async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.subscribe('required_tools:enforced', (data) => emitted.push(data));

    const processor = createEvaluateIterationProcessor({ eventBus });
    const baseCtx = makeContext({
      config: { requiredTools: ['search'], requiredToolPolicy: 'enforce' },
      history: [],
    });

    // Exhaust retries
    await processor.execute(baseCtx);
    await processor.execute(baseCtx);
    await processor.execute(baseCtx);

    expect(emitted).toHaveLength(1);
    expect((emitted[0] as { tools: string[] }).tools).toEqual(['search']);
    expect((emitted[0] as { sessionId: string }).sessionId).toBe('s1');
  });

  it('enforce policy only injects uncalled tools, not already-called ones', async () => {
    const processor = createEvaluateIterationProcessor();
    const baseCtx = makeContext({
      config: { requiredTools: ['search', 'calculate'], requiredToolPolicy: 'enforce' },
      history: [assistantWithToolCalls(['search'])],
    });

    // Exhaust retries (calculate never called)
    await processor.execute(baseCtx);
    await processor.execute(baseCtx);
    const result = await processor.execute(baseCtx) as PipelineContext;

    expect(result.iteration.loopDirective?.action).toBe('continue');
    expect(result.iteration.pendingToolCalls).toBeDefined();
    expect(result.iteration.pendingToolCalls!.length).toBe(1);
    expect(result.iteration.pendingToolCalls![0].name).toBe('calculate');
  });

  it('enforce policy sets span attributes for enforced tools', async () => {
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
    const baseCtx = makeContext({
      config: { requiredTools: ['search'], requiredToolPolicy: 'enforce' },
      history: [],
    });
    baseCtx.iteration.span = mockSpan as unknown as Span;

    // Exhaust retries
    await processor.execute(baseCtx);
    await processor.execute(baseCtx);
    await processor.execute(baseCtx);

    expect(attributes['required_tools.enforced']).toBe('search');
  });
});
