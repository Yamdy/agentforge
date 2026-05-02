/**
 * Unit tests for OTelTracer class
 *
 * Tests: lifecycle, span management, idempotency, no-op behavior,
 * recordException, and shutdown cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OTelTracer } from '../../src/observability/tracers/otel-tracer.js';

// ============================================================
// Shared mutable state (var = hoisted without TDZ)
// ============================================================

var mockSpans: ReturnType<typeof createSpan>[] = [];
var mockProvider: { shutdown: ReturnType<typeof vi.fn>; addSpanProcessor: ReturnType<typeof vi.fn> } | null = null;

function createSpan() {
  return {
    spanContext: vi.fn(() => ({ spanId: `span-${mockSpans.length}-${Date.now()}` })),
    end: vi.fn(),
    setStatus: vi.fn(),
    addEvent: vi.fn(),
    recordException: vi.fn(),
  };
}

// ============================================================
// Mock all OTel packages (intercepted for both static & dynamic imports)
// ============================================================

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: vi.fn(() => ({
      startSpan: vi.fn(() => {
        const span = createSpan();
        mockSpans.push(span);
        return span;
      }),
    })),
    setGlobalTracerProvider: vi.fn(),
  },
}));

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: vi.fn(function (this: any) {
    this.addSpanProcessor = vi.fn();
    this.shutdown = vi.fn().mockResolvedValue(undefined);
    mockProvider = this;
  }),
}));

vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: vi.fn(),
  AlwaysOnSampler: vi.fn(),
  AlwaysOffSampler: vi.fn(),
  TraceIdRatioBasedSampler: vi.fn(),
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn(),
}));

vi.mock('@opentelemetry/resources', () => ({
  Resource: vi.fn(),
}));

vi.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
}));

// ============================================================
// OTelTracer Tests
// ============================================================

describe('OTelTracer', () => {
  let tracer: OTelTracer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpans = [];
    mockProvider = null;
    tracer = new OTelTracer();
  });

  // ----------------------------------------------------------
  // Test 1: No-op when not configured
  // ----------------------------------------------------------

  it('returns empty spanId when not configured', () => {
    const spanId = tracer.startSpan('test');
    expect(spanId).toBe('');
  });

  // ----------------------------------------------------------
  // Test 2: Idempotent configure
  // ----------------------------------------------------------

  it('is idempotent on configure()', async () => {
    await tracer.configure({ endpoint: 'https://collector1.example.com/v1/traces' });
    expect(tracer.isConfigured()).toBe(true);

    // Second call with different endpoint should not throw
    await tracer.configure({ endpoint: 'https://collector2.example.com/v1/traces' });
    expect(tracer.isConfigured()).toBe(true);
  });

  // ----------------------------------------------------------
  // Test 3: Span lifecycle with mock OTel API
  // ----------------------------------------------------------

  it('manages span lifecycle with mock OTel API', async () => {
    await tracer.configure({ endpoint: 'https://collector.example.com/v1/traces' });

    // Start span
    const spanId = tracer.startSpan('test-operation', { attributes: { key: 'value' } });
    expect(spanId).toBeTruthy();
    expect(spanId).not.toBe('');
    expect(mockSpans).toHaveLength(1);

    const span = mockSpans[0]!;

    // Add event
    tracer.addEvent(spanId, 'test-event', { detail: 42 });
    expect(span.addEvent).toHaveBeenCalledWith('test-event', { detail: 42 });

    // End span
    tracer.endSpan(spanId);
    expect(span.end).toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Test 4: recordException
  // ----------------------------------------------------------

  it('handles recordException', async () => {
    await tracer.configure({ endpoint: 'https://collector.example.com/v1/traces' });

    const spanId = tracer.startSpan('error-prone-op');
    expect(mockSpans).toHaveLength(1);

    const error = new Error('test failure');
    tracer.recordException(spanId, error);

    const span = mockSpans[0]!;
    expect(span.recordException).toHaveBeenCalledWith(error);
  });

  // ----------------------------------------------------------
  // Test 5: No-ops for unknown spanId
  // ----------------------------------------------------------

  it('no-ops for unknown spanId', async () => {
    await tracer.configure({ endpoint: 'https://collector.example.com/v1/traces' });

    const error = new Error('orphan error');

    expect(() => {
      tracer.endSpan('nonexistent');
      tracer.addEvent('nonexistent', 'test-event');
      tracer.recordException('nonexistent', error);
    }).not.toThrow();
  });

  // ----------------------------------------------------------
  // Test 6: Shutdown cleans up active spans
  // ----------------------------------------------------------

  it('shutdown cleans up active spans', async () => {
    await tracer.configure({ endpoint: 'https://collector.example.com/v1/traces' });

    // Create 2 spans
    tracer.startSpan('op-1');
    tracer.startSpan('op-2');
    expect(mockSpans).toHaveLength(2);

    // Shutdown
    await tracer.shutdown();

    // Verify all spans were ended
    for (const span of mockSpans) {
      expect(span.end).toHaveBeenCalled();
    }

    // Verify provider was shut down
    expect(mockProvider?.shutdown).toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Test 7: configure() rejects empty endpoint
  // ----------------------------------------------------------

  it('throws when endpoint is empty string', async () => {
    await expect(tracer.configure({ endpoint: '' })).rejects.toThrow(
      'endpoint is required',
    );
    expect(tracer.isConfigured()).toBe(false);
  });

  // ----------------------------------------------------------
  // Test 8: endSpan sets error status code
  // ----------------------------------------------------------

  it('sets error status when endSpan called with code=error', async () => {
    await tracer.configure({ endpoint: 'https://collector.example.com/v1/traces' });

    const spanId = tracer.startSpan('failing-op');
    expect(mockSpans).toHaveLength(1);

    tracer.endSpan(spanId, { code: 'error' });

    const span = mockSpans[0]!;
    // expect setStatus was called with code=2 (SpanStatusCode.ERROR)
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.end).toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Test 9: shutdown is no-op when not configured
  // ----------------------------------------------------------

  it('shutdown no-ops gracefully when not configured', async () => {
    expect(tracer.isConfigured()).toBe(false);

    // Should not throw
    await tracer.shutdown();
    expect(tracer.isConfigured()).toBe(false);
  });

  // ----------------------------------------------------------
  // Test 10: addEvent propagates attributes to span
  // ----------------------------------------------------------

  it('addEvent delivers attributes to span', async () => {
    await tracer.configure({ endpoint: 'https://collector.example.com/v1/traces' });

    const spanId = tracer.startSpan('eventful-op');
    const attrs = { retryCount: 3, source: 'retry-handler' };

    tracer.addEvent(spanId, 'retry-attempt', attrs);

    const span = mockSpans[0]!;
    expect(span.addEvent).toHaveBeenCalledWith('retry-attempt', attrs);
  });
});
