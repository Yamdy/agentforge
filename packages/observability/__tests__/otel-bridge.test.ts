import { describe, it, expect } from 'vitest';
import { OTelBridge } from '../src/otel-bridge.js';
import { NoOpSpan } from '../src/noop.js';

describe('OTelBridge (no provider)', () => {
  it('returns no-op spans when no provider configured', () => {
    const bridge = new OTelBridge();
    const span = bridge.startSpan('test');

    expect(span.name).toBe('test');
    expect(span).toBeInstanceOf(NoOpSpan);
  });

  it('getCurrentSpan returns undefined', () => {
    const bridge = new OTelBridge();
    expect(bridge.getCurrentSpan()).toBeUndefined();
  });
});

describe('OTelBridge (with provider)', () => {
  it('creates real OTel spans', async () => {
    const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = await import(
      '@opentelemetry/sdk-trace-base'
    );

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const bridge = new OTelBridge({ tracerProvider: provider });
    const span = bridge.startSpan('agent_run');
    span.end();

    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('agent_run');
  });

  it('startChild creates nested spans with same traceId', async () => {
    const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = await import(
      '@opentelemetry/sdk-trace-base'
    );

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const bridge = new OTelBridge({ tracerProvider: provider });
    const parent = bridge.startSpan('agent_run');
    const child = parent.startChild('invoke_llm');
    const grandchild = child.startChild('execute_tools');
    grandchild.end();
    child.end();
    parent.end();

    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const agentRun = spans.find((s) => s.name === 'agent_run')!;
    const invokeLlm = spans.find((s) => s.name === 'invoke_llm')!;
    const executeTools = spans.find((s) => s.name === 'execute_tools')!;

    // Same trace
    expect(invokeLlm.spanContext().traceId).toBe(agentRun.spanContext().traceId);
    expect(executeTools.spanContext().traceId).toBe(agentRun.spanContext().traceId);

    // Parent-child hierarchy via parentSpanId
    expect(invokeLlm.parentSpanId).toBe(agentRun.spanContext().spanId);
    expect(executeTools.parentSpanId).toBe(invokeLlm.spanContext().spanId);
  });

  it('propagates attributes and events to OTel spans', async () => {
    const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = await import(
      '@opentelemetry/sdk-trace-base'
    );

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const bridge = new OTelBridge({ tracerProvider: provider });
    const span = bridge.startSpan('model_step');
    span.setAttribute('model', 'claude-3.5-sonnet');
    span.setAttribute('tokens.input', 1200);
    span.addEvent('stream_started', { chunk_size: 64 });
    span.end();

    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);

    const s = spans[0];
    expect(s.attributes['model']).toBe('claude-3.5-sonnet');
    expect(s.attributes['tokens.input']).toBe(1200);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].name).toBe('stream_started');
    expect(s.events[0].attributes?.['chunk_size']).toBe(64);
  });

  it('emits EventBus events with span context on span end', async () => {
    const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = await import(
      '@opentelemetry/sdk-trace-base'
    );

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const received: Array<{ spanContext: { traceId: string; spanId: string }; name: string }> = [];
    const eventBus = {
      emit(_eventType: string, data?: unknown) {
        received.push(data as typeof received[number]);
      },
    };

    const bridge = new OTelBridge({ tracerProvider: provider, eventBus });
    const span = bridge.startSpan('process_input');
    span.end();

    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('process_input');
    expect(received[0].spanContext.traceId).toBeTruthy();
    expect(received[0].spanContext.spanId).toBeTruthy();
  });
});
