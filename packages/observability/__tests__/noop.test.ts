import { describe, it, expect } from 'vitest';
import { NoOpTracer, NoOpSpan } from '../src/noop.js';
import type { Span, SpanContext } from '@agentforge/sdk';

describe('NoOpTracer', () => {
  it('returns a NoOpSpan from startSpan', () => {
    const tracer = new NoOpTracer();
    const span = tracer.startSpan('test');
    expect(span).toBeInstanceOf(NoOpSpan);
  });

  it('getCurrentSpan returns undefined when no span is active', () => {
    const tracer = new NoOpTracer();
    expect(tracer.getCurrentSpan()).toBeUndefined();
  });

  it('startSpan returns a span with the given name', () => {
    const tracer = new NoOpTracer();
    const span = tracer.startSpan('my-operation');
    expect(span.name).toBe('my-operation');
  });
});

describe('NoOpSpan', () => {
  it('all methods return without throwing', () => {
    const tracer = new NoOpTracer();
    const span = tracer.startSpan('test');

    expect(() => {
      span.end();
      span.setAttribute('key', 'value');
      span.addEvent('event', { detail: 42 });
      span.startChild('child');
      span.spanContext();
    }).not.toThrow();
  });

  it('setAttribute returns the span for chaining', () => {
    const tracer = new NoOpTracer();
    const span = tracer.startSpan('test');
    expect(span.setAttribute('k', 'v')).toBe(span);
  });

  it('addEvent returns the span for chaining', () => {
    const tracer = new NoOpTracer();
    const span = tracer.startSpan('test');
    expect(span.addEvent('evt')).toBe(span);
  });

  it('startChild returns a NoOpSpan', () => {
    const tracer = new NoOpTracer();
    const span = tracer.startSpan('parent');
    const child = span.startChild('child');
    expect(child).toBeInstanceOf(NoOpSpan);
    expect(child.name).toBe('child');
  });

  it('spanContext returns a valid structure', () => {
    const tracer = new NoOpTracer();
    const span = tracer.startSpan('test');
    const ctx = span.spanContext();
    expect(ctx).toEqual({ spanId: '', traceId: '' });
  });
});
