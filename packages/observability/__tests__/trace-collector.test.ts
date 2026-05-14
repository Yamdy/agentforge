import { describe, it, expect } from 'vitest';
import { TraceCollector, formatTraceJson, formatTraceConsole } from '../src/trace-collector.js';

// ---------------------------------------------------------------------------
// TraceCollector — span collection & tree assembly
// ---------------------------------------------------------------------------

describe('TraceCollector', () => {
  it('collects ended spans via created tracer', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const span = tracer.startSpan('pipeline');
    span.end();

    const trace = collector.getTrace();
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0].name).toBe('pipeline');
  });

  it('assembles parent-child hierarchy into a tree', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const root = tracer.startSpan('pipeline');
    const child = root.startChild('invokeLLM');
    const grandchild = child.startChild('executeTools');
    grandchild.end();
    child.end();
    root.end();

    const trace = collector.getTrace();
    expect(trace.spans).toHaveLength(3);

    expect(trace.root).toBeDefined();
    expect(trace.root!.span.name).toBe('pipeline');
    expect(trace.root!.children).toHaveLength(1);
    expect(trace.root!.children[0].span.name).toBe('invokeLLM');
    expect(trace.root!.children[0].children).toHaveLength(1);
    expect(trace.root!.children[0].children[0].span.name).toBe('executeTools');
  });

  it('exposes traceId from root span', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const root = tracer.startSpan('pipeline');
    root.end();

    const trace = collector.getTrace();
    expect(trace.traceId).toBe(root.spanContext().traceId);
  });

  it('computes total trace duration from root span timing', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const root = tracer.startSpan('pipeline');
    root.end();

    const trace = collector.getTrace();
    expect(trace.durationMs).toBeGreaterThanOrEqual(0);
    expect(trace.root!.span.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('clear resets the collector for reuse', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('a').end();

    collector.clear();
    const trace = collector.getTrace();
    expect(trace.spans).toHaveLength(0);
    expect(trace.root).toBeUndefined();
  });

  it('spans not ended are not included in trace', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    tracer.startSpan('ended').end();
    tracer.startSpan('not-ended');

    const trace = collector.getTrace();
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0].name).toBe('ended');
  });

  it('preserves span attributes and events', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const span = tracer.startSpan('invokeLLM');
    span.setAttribute('model', 'gpt-4');
    span.setAttribute('tokens', 150);
    span.addEvent('stream_start', { latency: 42 });
    span.end();

    const trace = collector.getTrace();
    expect(trace.root!.span.attributes).toEqual({ model: 'gpt-4', tokens: 150 });
    expect(trace.root!.span.events).toEqual([{ name: 'stream_start', attributes: { latency: 42 } }]);
  });

  it('flush returns trace and resets for next run', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    tracer.startSpan('run-1').end();
    const trace1 = collector.flush();
    expect(trace1.spans).toHaveLength(1);
    expect(trace1.spans[0].name).toBe('run-1');

    const trace2 = collector.getTrace();
    expect(trace2.spans).toHaveLength(0);
    expect(trace2.traceId).not.toBe(trace1.traceId);
  });

  it('flush with no spans returns empty trace', () => {
    const collector = new TraceCollector();
    const trace = collector.flush();
    expect(trace.spans).toHaveLength(0);
    expect(trace.root).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatTraceJson — structured JSON output
// ---------------------------------------------------------------------------

describe('formatTraceJson', () => {
  it('outputs valid JSON with trace metadata', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('pipeline').end();

    const json = formatTraceJson(collector.getTrace());
    const parsed = JSON.parse(json);

    expect(parsed.traceId).toBeDefined();
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
    expect(parsed.root).toBeDefined();
    expect(parsed.root.span.name).toBe('pipeline');
  });

  it('includes nested children in JSON', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const root = tracer.startSpan('pipeline');
    const child = root.startChild('invokeLLM');
    child.end();
    root.end();

    const parsed = JSON.parse(formatTraceJson(collector.getTrace()));
    expect(parsed.root.children).toHaveLength(1);
    expect(parsed.root.children[0].span.name).toBe('invokeLLM');
  });

  it('returns "null" for empty trace', () => {
    const collector = new TraceCollector();
    expect(formatTraceJson(collector.getTrace())).toBe('null');
  });
});

// ---------------------------------------------------------------------------
// formatTraceConsole — human-readable tree output
// ---------------------------------------------------------------------------

describe('formatTraceConsole', () => {
  it('renders a single root span', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    tracer.startSpan('pipeline').end();

    const output = formatTraceConsole(collector.getTrace());
    expect(output).toContain('pipeline');
    expect(output).toContain('ms');
  });

  it('renders nested children with indentation', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const root = tracer.startSpan('pipeline');
    const child = root.startChild('invokeLLM');
    child.setAttribute('model', 'gpt-4');
    child.end();
    root.end();

    const output = formatTraceConsole(collector.getTrace());
    const lines = output.split('\n');

    const rootIdx = lines.findIndex(l => l.includes('pipeline'));
    const childIdx = lines.findIndex(l => l.includes('invokeLLM'));
    expect(childIdx).toBeGreaterThan(rootIdx);

    const rootIndent = lines[rootIdx].match(/^(\s*)/)?.[1].length ?? 0;
    const childIndent = lines[childIdx].match(/^(\s*)/)?.[1].length ?? 0;
    expect(childIndent).toBeGreaterThan(rootIndent);
  });

  it('shows attributes inline', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const span = tracer.startSpan('invokeLLM');
    span.setAttribute('model', 'gpt-4');
    span.end();

    const output = formatTraceConsole(collector.getTrace());
    expect(output).toContain('model=gpt-4');
  });

  it('returns "(no trace)" for empty trace', () => {
    const collector = new TraceCollector();
    expect(formatTraceConsole(collector.getTrace())).toContain('no trace');
  });
});

// ---------------------------------------------------------------------------
// Span timing (end-to-end via TraceCollector)
// ---------------------------------------------------------------------------

describe('Span timing', () => {
  it('ended spans have startTime, endTime, and durationMs', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const span = tracer.startSpan('timed');
    span.end();

    const data = collector.getTrace().spans[0];
    expect(typeof data.startTime).toBe('number');
    expect(typeof data.endTime).toBe('number');
    expect(typeof data.durationMs).toBe('number');
    expect(data.endTime).toBeGreaterThanOrEqual(data.startTime);
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('parent duration >= child duration in sequential flow', () => {
    const collector = new TraceCollector();
    const tracer = collector.createTracer();

    const parent = tracer.startSpan('parent');
    const child = parent.startChild('child');
    child.end();
    parent.end();

    const trace = collector.getTrace();
    const parentSpan = trace.root!.span;
    const childSpan = trace.root!.children[0].span;

    expect(parentSpan.durationMs).toBeGreaterThanOrEqual(childSpan.durationMs);
  });
});
