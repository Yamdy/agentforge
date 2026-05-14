import { describe, it, expect } from 'vitest';
import { TraceCollector, formatTraceOtlp } from '../src/trace-collector.js';

function uuidHex(uuid: string): string {
  return uuid.replace(/-/g, '');
}

describe('formatTraceOtlp', () => {
  it('produces valid OTLP JSON with resourceSpans', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('pipeline').end();

    const json = formatTraceOtlp(collector.getTrace());
    const parsed = JSON.parse(json);

    expect(parsed.resourceSpans).toBeDefined();
    expect(Array.isArray(parsed.resourceSpans)).toBe(true);
    expect(parsed.resourceSpans.length).toBeGreaterThan(0);
  });

  it('includes service name in resource attributes', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('pipeline').end();

    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace(), { serviceName: 'my-agent' }));
    const resourceAttrs = parsed.resourceSpans[0].resource.attributes;
    const serviceAttr = resourceAttrs.find((a: any) => a.key === 'service.name');
    expect(serviceAttr).toBeDefined();
    expect(serviceAttr.value.stringValue).toBe('my-agent');
  });

  it('defaults service name to agentforge', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('pipeline').end();

    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace()));
    const resourceAttrs = parsed.resourceSpans[0].resource.attributes;
    const serviceAttr = resourceAttrs.find((a: any) => a.key === 'service.name');
    expect(serviceAttr.value.stringValue).toBe('agentforge');
  });

  it('converts spans with correct OTLP structure', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const root = tracer.startSpan('pipeline');
    root.setAttribute('session.id', 'abc123');
    root.addEvent('iteration.complete', { step: 1 });
    root.end();

    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace()));
    const scopeSpans = parsed.resourceSpans[0].scopeSpans;
    expect(scopeSpans).toBeDefined();
    expect(scopeSpans.length).toBeGreaterThan(0);

    const otlpSpans = scopeSpans[0].spans;
    expect(otlpSpans).toHaveLength(1);

    const span = otlpSpans[0];
    expect(span.name).toBe('pipeline');
    expect(span.kind).toBe(1);
    expect(typeof span.startTimeUnixNano).toBe('string');
    expect(typeof span.endTimeUnixNano).toBe('string');
  });

  it('encodes traceId as 32-char lowercase hex', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('pipeline').end();

    const trace = collector.getTrace();
    const parsed = JSON.parse(formatTraceOtlp(trace));
    const otlpSpan = parsed.resourceSpans[0].scopeSpans[0].spans[0];

    const expectedTraceId = uuidHex(trace.traceId).toLowerCase();
    expect(otlpSpan.traceId).toBe(expectedTraceId);
    expect(otlpSpan.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('encodes spanId as 16-char lowercase hex', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('pipeline').end();

    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace()));
    const otlpSpan = parsed.resourceSpans[0].scopeSpans[0].spans[0];

    expect(otlpSpan.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('encodes parentSpanId in child spans', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const root = tracer.startSpan('pipeline');
    const child = root.startChild('invokeLLM');
    child.end();
    root.end();

    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace()));
    const otlpSpans = parsed.resourceSpans[0].scopeSpans[0].spans;
    const childSpan = otlpSpans.find((s: any) => s.name === 'invokeLLM');

    expect(childSpan.parentSpanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('converts attributes to OTLP keyValue format', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const span = tracer.startSpan('invokeLLM');
    span.setAttribute('model', 'gpt-4');
    span.setAttribute('tokens', 150);
    span.setAttribute('streaming', true);
    span.end();

    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace()));
    const attrs = parsed.resourceSpans[0].scopeSpans[0].spans[0].attributes;

    const modelAttr = attrs.find((a: any) => a.key === 'model');
    expect(modelAttr.value.stringValue).toBe('gpt-4');

    const tokensAttr = attrs.find((a: any) => a.key === 'tokens');
    expect(tokensAttr.value.intValue).toBe('150');

    const streamingAttr = attrs.find((a: any) => a.key === 'streaming');
    expect(streamingAttr.value.boolValue).toBe(true);
  });

  it('converts events to OTLP span events', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const span = tracer.startSpan('pipeline');
    span.addEvent('cache_hit', { key: 'abc' });
    span.end();

    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace()));
    const events = parsed.resourceSpans[0].scopeSpans[0].spans[0].events;

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('cache_hit');
    expect(events[0].attributes).toBeDefined();
    expect(events[0].timeUnixNano).toMatch(/^[0-9]+$/);
  });

  it('converts timestamps to Unix nanoseconds', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('pipeline').end();

    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace()));
    const span = parsed.resourceSpans[0].scopeSpans[0].spans[0];

    const startNano = BigInt(span.startTimeUnixNano);
    const endNano = BigInt(span.endTimeUnixNano);

    expect(startNano).toBeGreaterThan(BigInt('1577836800000000000'));
    expect(endNano).toBeGreaterThanOrEqual(startNano);
  });

  it('returns empty resourceSpans for null trace', () => {
    const collector = new TraceCollector();
    const parsed = JSON.parse(formatTraceOtlp(collector.getTrace()));
    expect(parsed.resourceSpans).toEqual([]);
  });
});
