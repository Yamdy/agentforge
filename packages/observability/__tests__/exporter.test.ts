import { describe, it, expect } from 'vitest';
import { TestExporter } from '../src/exporter.js';

describe('TestExporter', () => {
  it('collects all created spans', () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();

    const span1 = tracer.startSpan('op1');
    const span2 = tracer.startSpan('op2');

    span1.end();
    span2.end();

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.name)).toEqual(['op1', 'op2']);
  });

  it('captures parent-child hierarchy', () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();

    const parent = tracer.startSpan('parent');
    const child = parent.startChild('child');
    child.end();
    parent.end();

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(2);

    const childSpan = spans.find((s) => s.name === 'child')!;
    const parentSpan = spans.find((s) => s.name === 'parent')!;
    expect(childSpan.parentSpanId).toBe(parentSpan.spanId);
  });

  it('captures span attributes', () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();

    const span = tracer.startSpan('op');
    span.setAttribute('key1', 'value1');
    span.setAttribute('key2', 42);
    span.end();

    const spans = exporter.getSpans();
    expect(spans[0].attributes).toEqual({ key1: 'value1', key2: 42 });
  });

  it('captures span events', () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();

    const span = tracer.startSpan('op');
    span.addEvent('cache_hit', { key: 'abc' });
    span.end();

    const spans = exporter.getSpans();
    expect(spans[0].events).toEqual([{ name: 'cache_hit', attributes: { key: 'abc' } }]);
  });

  it('tracks ended status', () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();

    const span = tracer.startSpan('op');
    expect(exporter.getSpans()[0].ended).toBe(false);

    span.end();
    expect(exporter.getSpans()[0].ended).toBe(true);
  });

  it('clear removes all collected spans', () => {
    const exporter = new TestExporter();
    const tracer = exporter.createTracer();

    tracer.startSpan('op').end();
    expect(exporter.getSpans()).toHaveLength(1);

    exporter.clear();
    expect(exporter.getSpans()).toHaveLength(0);
  });
});
