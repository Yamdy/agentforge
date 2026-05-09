import { describe, it, expect } from 'vitest';
import { TracerImpl } from '../src/tracer.js';
import type { Span, SpanContext } from '@agentforge/sdk';

describe('TracerImpl', () => {
  it('startSpan creates a span with unique spanId and traceId', () => {
    const tracer = new TracerImpl();
    const span = tracer.startSpan('root');

    const ctx = span.spanContext();
    expect(ctx.spanId).toBeTruthy();
    expect(ctx.traceId).toBeTruthy();
  });

  it('child spans share the same traceId as parent', () => {
    const tracer = new TracerImpl();
    const parent = tracer.startSpan('parent');
    const child = parent.startChild('child');

    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(child.spanContext().spanId).not.toBe(parent.spanContext().spanId);
  });

  it('grandchild spans preserve the original traceId', () => {
    const tracer = new TracerImpl();
    const root = tracer.startSpan('root');
    const child = root.startChild('child');
    const grandchild = child.startChild('grandchild');

    expect(grandchild.spanContext().traceId).toBe(root.spanContext().traceId);
  });

  it('getCurrentSpan returns the active span', () => {
    const tracer = new TracerImpl();
    const span = tracer.startSpan('active');

    tracer.withSpan(span, () => {
      expect(tracer.getCurrentSpan()).toBe(span);
    });
  });

  it('getCurrentSpan returns undefined outside withSpan', () => {
    const tracer = new TracerImpl();
    expect(tracer.getCurrentSpan()).toBeUndefined();
  });

  it('withSpan restores the previous span after execution', () => {
    const tracer = new TracerImpl();
    const outer = tracer.startSpan('outer');
    const inner = tracer.startSpan('inner');

    tracer.withSpan(outer, () => {
      expect(tracer.getCurrentSpan()).toBe(outer);
      tracer.withSpan(inner, () => {
        expect(tracer.getCurrentSpan()).toBe(inner);
      });
      expect(tracer.getCurrentSpan()).toBe(outer);
    });
    expect(tracer.getCurrentSpan()).toBeUndefined();
  });
});
