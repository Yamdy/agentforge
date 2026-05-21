import { describe, it, expect } from 'vitest';
import { TracerImpl, SpanImpl } from '../src/tracer.js';

describe('W3C traceparent propagation', () => {
  describe('format helpers', () => {
    it('valid traceparent: 00-{32hex}-{16hex}-{flags}', () => {
      const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
      expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    });
  });

  describe('TracerImpl with external trace context', () => {
    it('startSpan() with parentContext inherits traceId', () => {
      const tracer = new TracerImpl();
      const parent = tracer.startSpan('incoming', {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
      });

      const ctx = parent.spanContext();
      expect(ctx.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    });

    it('startSpan() without parentContext generates new UUID traceId', () => {
      const tracer = new TracerImpl();
      const span = tracer.startSpan('root');
      expect(span.spanContext().traceId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('startSpan() with hexIds option uses W3C hex format', () => {
      const tracer = new TracerImpl(undefined, { generateHexIds: true });
      const span = tracer.startSpan('root');
      const ctx = span.spanContext();
      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('child span inherits parent traceId', () => {
      const tracer = new TracerImpl();
      const parent = tracer.startSpan('parent');
      const child = parent.startChild('child') as SpanImpl;

      expect(parent.spanContext().traceId).toBe(child.spanContext().traceId);
      expect(child.parentSpanId).toBe(parent.spanContext().spanId);
    });

    it('parentContext with external IDs propagates traceId to children', () => {
      const tracer = new TracerImpl();
      const parent = tracer.startSpan('incoming', {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
      });
      const child = parent.startChild('child') as SpanImpl;

      expect(child.spanContext().traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(child.parentSpanId).toBe(parent.spanContext().spanId);
    });
  });

  describe('inject / extract trace context', () => {
    it('injects traceparent header from span with hex IDs', () => {
      const tracer = new TracerImpl(undefined, { generateHexIds: true });
      const span = tracer.startSpan('test-op');
      const ctx = span.spanContext();
      const headers: Record<string, string> = {};

      tracer.inject(span, headers);

      expect(headers.traceparent).toBe(`00-${ctx.traceId}-${ctx.spanId}-01`);
    });

    it('injects traceparent with 00 flag when unsampled', () => {
      const tracer = new TracerImpl(undefined, { generateHexIds: true, sampled: false });
      const span = tracer.startSpan('unsampled');
      const headers: Record<string, string> = {};

      tracer.inject(span, headers);

      expect(headers.traceparent).toMatch(/-00$/);
    });

    it('extracts SpanContext from valid traceparent', () => {
      const tracer = new TracerImpl();
      const ctx = tracer.extract({
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      });

      expect(ctx).toBeDefined();
      expect(ctx!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(ctx!.spanId).toBe('b7ad6b7169203331');
    });

    it('extract returns undefined for missing header', () => {
      const tracer = new TracerImpl();
      expect(tracer.extract({})).toBeUndefined();
    });

    it('extract returns undefined for invalid format', () => {
      const tracer = new TracerImpl();
      expect(tracer.extract({ traceparent: '' })).toBeUndefined();
      expect(tracer.extract({ traceparent: 'not-valid' })).toBeUndefined();
      expect(tracer.extract({ traceparent: '00-short-short-01' })).toBeUndefined();
    });

    it('inject then extract round-trip', () => {
      const tracer = new TracerImpl(undefined, { generateHexIds: true });
      const span = tracer.startSpan('round-trip');
      const headers: Record<string, string> = {};

      tracer.inject(span, headers);
      const extracted = tracer.extract(headers);

      expect(extracted).toBeDefined();
      expect(extracted!.traceId).toBe(span.spanContext().traceId);
      expect(extracted!.spanId).toBe(span.spanContext().spanId);
    });

    it('extract handles tracestate header', () => {
      const tracer = new TracerImpl();
      const ctx = tracer.extract({
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        tracestate: 'vendor1=opaqueValue',
      });

      expect(ctx).toBeDefined();
      expect(ctx!.tracestate).toBe('vendor1=opaqueValue');
    });
  });
});
