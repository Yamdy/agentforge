import { describe, it, expect } from 'vitest';
import { SpanType } from '@agentforge/sdk';
import { PipelineRunner } from '../src/pipeline.js';
import { TraceCollector } from '@agentforge/observability';
import type { PipelineContext } from '@agentforge/sdk';
import { createMockLanguageModel } from './helpers.js';

function makeContext(): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
  };
}

// ---------------------------------------------------------------------------
// 1. SpanType enum completeness (23 values)
// ---------------------------------------------------------------------------

describe('SpanType completeness', () => {
  const expectedTypes = [
    // Phase 1 (core)
    'agent_run',
    'model_step',
    'tool_call',
    'processor_run',
    // Phase 2 (harness & detailed)
    'llm.stream',
    'tool.execute',
    'harness.gate',
    'harness.cost-cap',
    'harness.token-budget',
    'harness.goal-echo',
    'harness.fact-injection',
    'harness.compression',
    // Phase 2 (subsystem coverage — 11 new)
    'session.lifecycle',
    'tool.register',
    'tool.lookup',
    'event.dispatch',
    'gateway.resolve',
    'context.build',
    'loop.iteration',
    'subagent.run',
    'checkpoint',
    'mcp.connect',
    'mcp.tool_call',
  ] as const;

  it('defines exactly 23 SpanType values', () => {
    const values = Object.values(SpanType);
    expect(values).toHaveLength(23);
  });

  it('contains all expected span type strings', () => {
    for (const expected of expectedTypes) {
      expect(Object.values(SpanType)).toContain(expected);
    }
  });

  it('has named constants for all new span types', () => {
    expect(SpanType.SESSION_LIFECYCLE).toBe('session.lifecycle');
    expect(SpanType.TOOL_REGISTER).toBe('tool.register');
    expect(SpanType.TOOL_LOOKUP).toBe('tool.lookup');
    expect(SpanType.EVENT_DISPATCH).toBe('event.dispatch');
    expect(SpanType.GATEWAY_RESOLVE).toBe('gateway.resolve');
    expect(SpanType.CONTEXT_BUILD).toBe('context.build');
    expect(SpanType.LOOP_ITERATION).toBe('loop.iteration');
    expect(SpanType.SUB_AGENT_RUN).toBe('subagent.run');
    expect(SpanType.CHECKPOINT).toBe('checkpoint');
    expect(SpanType.MCP_CONNECT).toBe('mcp.connect');
    expect(SpanType.MCP_TOOL_CALL).toBe('mcp.tool_call');
  });
});

// ---------------------------------------------------------------------------
// 2. PipelineRunner uses SpanType constants (not hardcoded strings)
// ---------------------------------------------------------------------------

describe('PipelineRunner span names', () => {
  it('root span uses SpanType.AGENT_RUN constant', async () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const runner = new PipelineRunner({ tracer });

    runner.register({ stage: 'processInput', execute: async (ctx) => ctx });

    await runner.run(makeContext(), ['processInput']);

    const trace = collector.getTrace();
    expect(trace.root).toBeDefined();
    expect(trace.root!.span.name).toBe(SpanType.AGENT_RUN);
  });
});

// ---------------------------------------------------------------------------
// 3. LLMInvoker uses SpanType constants
// ---------------------------------------------------------------------------

describe('LLMInvoker span names', () => {
  it('invoke() creates span with SpanType.MODEL_STEP name', async () => {
    const { LLMInvoker } = await import('../src/llm-invoker.js');
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const model = createMockLanguageModel({ text: 'response' });
    const invoker = new LLMInvoker({ model, tracer });
    await invoker.invoke({ messages: [{ role: 'user', content: 'hi' }] });

    const trace = collector.getTrace();
    const span = trace.spans.find(s => s.name === SpanType.MODEL_STEP);
    expect(span).toBeDefined();
  });

  it('stream() creates span with SpanType.LLM_STREAM name', async () => {
    const { LLMInvoker } = await import('../src/llm-invoker.js');
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const model = createMockLanguageModel({ text: 'response' });
    const invoker = new LLMInvoker({ model, tracer });
    const handle = invoker.stream({ messages: [{ role: 'user', content: 'hi' }] });

    // Consume the stream to trigger span end
    for await (const _evt of handle.fullStream) { void _evt; }
    await handle.usage;

    const trace = collector.getTrace();
    const span = trace.spans.find(s => s.name === SpanType.LLM_STREAM);
    expect(span).toBeDefined();
  });
});

