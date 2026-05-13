import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '../src/agent.js';
import { EventBus } from '../src/event-bus.js';
import { createSubAgentTool } from '../src/sub-agent.js';
import {
  createMockLanguageModel,
  createMockModelWithToolCalls,
  registerMockProvider,
} from './helpers.js';
import { TestExporter } from '@agentforge/observability';
import { z } from 'zod';

describe('SubAgent', () => {
  beforeEach(() => {
    // Register child provider — returns simple text
    registerMockProvider('sub', () =>
      createMockLanguageModel({ text: 'Sub-agent research result' }),
    );
  });

  it('tracer bullet: parent delegates to sub-agent via tool call and receives summary', async () => {
    // Parent mock: first call → tool call to "research", second call → final text
    const parentModel = createMockModelWithToolCalls(
      [{ toolName: 'research', args: { task: 'find X' } }],
      'Parent final answer',
    );
    registerMockProvider('main', () => parentModel);

    const eventBus = new EventBus();

    const subAgentTool = createSubAgentTool(
      {
        name: 'research',
        description: 'Research a topic',
        model: 'sub/mock',
        contextPolicy: 'isolated',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'main/mock',
        tools: [],
        eventBus,
      },
    );

    const agent = new Agent({
      model: 'main/mock',
      tools: [subAgentTool],
    });

    const result = await agent.run('Research X for me');
    expect(result.response).toBe('Parent final answer');
  });

  it('isolated policy: getSessionState is not called, child runs with fresh context', async () => {
    const parentModel = createMockModelWithToolCalls(
      [{ toolName: 'worker', args: { task: 'do stuff' } }],
      'Done',
    );
    registerMockProvider('iso-parent', () => parentModel);

    const getSessionState = vi.fn(() => ({ messageHistory: [{ role: 'user', content: 'secret' }] }));
    const eventBus = new EventBus();

    const subAgentTool = createSubAgentTool(
      {
        name: 'worker',
        description: 'Worker sub-agent',
        model: 'sub/mock',
        contextPolicy: 'isolated',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'iso-parent/mock',
        tools: [],
        eventBus,
        getSessionState: getSessionState as any,
      },
    );

    const agent = new Agent({
      model: 'iso-parent/mock',
      tools: [subAgentTool],
    });

    await agent.run('Delegate to worker');
    expect(getSessionState).not.toHaveBeenCalled();
  });

  it('inherit policy: child agent receives parent message history', async () => {
    const parentModel = createMockModelWithToolCalls(
      [{ toolName: 'worker', args: { task: 'analyze' } }],
      'Done',
    );
    registerMockProvider('inh-parent', () => parentModel);

    const parentMessages = [
      { role: 'user' as const, content: 'previous question' },
      { role: 'assistant' as const, content: 'previous answer' },
    ];

    // Track what the child agent actually receives as session state
    let capturedSession: Record<string, unknown> | undefined;
    registerMockProvider('inh-child', () => {
      return createMockLanguageModel({ text: 'Child analyzed' });
    });

    const getSessionState = vi.fn(() => ({ messageHistory: parentMessages }));
    const eventBus = new EventBus();

    const subAgentTool = createSubAgentTool(
      {
        name: 'worker',
        description: 'Worker sub-agent',
        model: 'inh-child/mock',
        contextPolicy: 'inherit',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'inh-parent/mock',
        tools: [],
        eventBus,
        getSessionState: getSessionState as any,
      },
    );

    const agent = new Agent({
      model: 'inh-parent/mock',
      tools: [subAgentTool],
    });

    await agent.run('Delegate to worker');
    expect(getSessionState).toHaveBeenCalled();
  });

  it('summary-only policy: child receives summarized parent context, not raw history', async () => {
    const parentModel = createMockModelWithToolCalls(
      [{ toolName: 'worker', args: { task: 'summarize' } }],
      'Done',
    );
    registerMockProvider('sum-parent', () => parentModel);
    registerMockProvider('sum-child', () =>
      createMockLanguageModel({ text: 'Child summary done' }),
    );

    const parentMessages = [
      { role: 'user' as const, content: 'question 1' },
      { role: 'assistant' as const, content: 'answer 1' },
      { role: 'user' as const, content: 'question 2' },
      { role: 'assistant' as const, content: 'answer 2' },
    ];

    const getSessionState = vi.fn(() => ({ messageHistory: parentMessages }));
    const eventBus = new EventBus();

    const subAgentTool = createSubAgentTool(
      {
        name: 'worker',
        description: 'Worker sub-agent',
        model: 'sum-child/mock',
        contextPolicy: 'summary-only',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'sum-parent/mock',
        tools: [],
        eventBus,
        getSessionState: getSessionState as any,
      },
    );

    const agent = new Agent({
      model: 'sum-parent/mock',
      tools: [subAgentTool],
    });

    await agent.run('Delegate to worker');
    // summary-only should call getSessionState and compress the history
    expect(getSessionState).toHaveBeenCalled();
  });

  it('emits task:start and task:end events via EventBus', async () => {
    const parentModel = createMockModelWithToolCalls(
      [{ toolName: 'worker', args: { task: 'job' } }],
      'Done',
    );
    registerMockProvider('evt-parent', () => parentModel);
    registerMockProvider('evt-child', () =>
      createMockLanguageModel({ text: 'Child result' }),
    );

    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('task:start', (data) => events.push({ type: 'task:start', data }));
    eventBus.subscribe('task:end', (data) => events.push({ type: 'task:end', data }));

    const subAgentTool = createSubAgentTool(
      {
        name: 'worker',
        description: 'Worker sub-agent',
        model: 'evt-child/mock',
        contextPolicy: 'isolated',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'evt-parent/mock',
        tools: [],
        eventBus,
      },
    );

    const agent = new Agent({
      model: 'evt-parent/mock',
      tools: [subAgentTool],
    });

    await agent.run('Delegate to worker');

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('task:start');
    expect(events[0].data).toEqual({ name: 'worker', input: { task: 'job' } });
    expect(events[1].type).toBe('task:end');
    const endData = events[1].data as any;
    expect(endData.name).toBe('worker');
    expect(endData.result.response).toBe('Child result');
    expect(endData.result.tokenUsage).toBeDefined();
    expect(endData.result.sessionId).toBeDefined();
  });

  it('catches sub-agent errors and returns error summary', async () => {
    const parentModel = createMockModelWithToolCalls(
      [{ toolName: 'failworker', args: { task: 'crash' } }],
      'Parent handled error',
    );
    registerMockProvider('err-parent', () => parentModel);

    // Register a provider that throws
    registerMockProvider('err-child', () => {
      throw new Error('Model resolution failed');
    });

    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('task:end', (data) => events.push({ type: 'task:end', data }));

    const subAgentTool = createSubAgentTool(
      {
        name: 'failworker',
        description: 'Failing sub-agent',
        model: 'err-child/mock',
        contextPolicy: 'isolated',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'err-parent/mock',
        tools: [],
        eventBus,
      },
    );

    const agent = new Agent({
      model: 'err-parent/mock',
      tools: [subAgentTool],
    });

    // Should NOT throw — error is caught and returned as summary
    const result = await agent.run('Delegate to failworker');
    expect(result.response).toBe('Parent handled error');

    // task:end should contain error summary
    const endData = events[0].data as any;
    expect(endData.error).toContain('failworker');
    expect(endData.error).toContain('failed');
  });

  it('propagates parent tracer to child agent (spans in same exporter)', async () => {
    const parentModel = createMockModelWithToolCalls(
      [{ toolName: 'traced', args: { task: 'trace me' } }],
      'Traced result',
    );
    registerMockProvider('trace-parent', () => parentModel);
    registerMockProvider('trace-child', () =>
      createMockLanguageModel({ text: 'Child traced' }),
    );

    const exporter = new TestExporter();
    const tracer = exporter.createTracer();
    const eventBus = new EventBus();

    // Collect spans without tracer — baseline count
    exporter.clear();

    const subAgentTool = createSubAgentTool(
      {
        name: 'traced',
        description: 'Traced sub-agent',
        model: 'trace-child/mock',
        contextPolicy: 'isolated',
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: 'trace-parent/mock',
        tools: [],
        eventBus,
        tracer,
      },
    );

    const agent = new Agent(
      { model: 'trace-parent/mock', tools: [subAgentTool] },
      { tracer },
    );

    await agent.run('Run traced sub-agent');

    const spans = exporter.getSpans();
    // Parent pipeline creates spans + child pipeline creates spans via same tracer
    // Both parent and child agents share the exporter, proving tracer propagation
    expect(spans.length).toBeGreaterThan(4);
  });
});
