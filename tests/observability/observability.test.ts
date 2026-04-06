import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  setupObservability,
  tracer,
  getTracer,
  ConsoleExporter,
  createSpan,
  GEN_AI_AGENT_NAME,
  GEN_AI_REQUEST_MODEL,
} from '../../src/observability/index.js';

describe('Observability System', () => {
  describe('Span', () => {
    test('should create a span', () => {
      const span = createSpan('test.span');
      expect(span.name).toBe('test.span');
      expect(span.spanId).toBeDefined();
      expect(span.traceId).toBeDefined();
      expect(span.startTime).toBeInstanceOf(Date);
    });

    test('should end a span', () => {
      const span = createSpan('test.span');
      span.end();
      expect(span.endTime).toBeInstanceOf(Date);
      expect(span.status.code).toBe('UNSET');
    });

    test('should end a span with status', () => {
      const span = createSpan('test.span');
      span.end({ code: 'OK' });
      expect(span.status.code).toBe('OK');
    });

    test('should record an exception', () => {
      const span = createSpan('test.span');
      const error = new Error('Test error');
      span.recordException(error);
      expect(span.status.code).toBe('ERROR');
      expect(span.status.message).toBe('Test error');
    });

    test('should set attributes', () => {
      const span = createSpan('test.span');
      span.setAttribute('key', 'value');
      span.setAttribute('number', 42);
      span.setAttribute('bool', true);
      expect(span.attributes.key).toBe('value');
      expect(span.attributes.number).toBe(42);
      expect(span.attributes.bool).toBe(true);
    });

    test('should add events', () => {
      const span = createSpan('test.span');
      span.addEvent('event1');
      span.addEvent('event2', { attr: 'value' });
      expect(span.events).toHaveLength(2);
      expect(span.events[0].name).toBe('event1');
      expect(span.events[1].attributes?.attr).toBe('value');
    });
  });

  describe('Tracer', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    test('should start and end spans', async () => {
      const exporter = new ConsoleExporter();
      const exportSpy = vi.spyOn(exporter, 'export');

      setupObservability({ exporter });

      const span = tracer.startSpan('agent.run', {
        attributes: {
          [GEN_AI_AGENT_NAME]: 'test-agent',
          [GEN_AI_REQUEST_MODEL]: 'gpt-4',
        },
      });

      span.end({ code: 'OK' });

      getTracer().endSpan(span);
      await getTracer().flush();

      expect(exportSpy).toHaveBeenCalled();
    });

    test('should track current span', () => {
      setupObservability({});

      const span1 = tracer.startSpan('span1');
      expect(tracer.getCurrentSpan()).toBe(span1);

      const span2 = tracer.startSpan('span2');
      expect(tracer.getCurrentSpan()).toBe(span2);
      expect(span2.parentSpanId).toBe(span1.spanId);

      getTracer().endSpan(span2);
      expect(getTracer().getCurrentSpan()).toBe(span1);

      getTracer().endSpan(span1);
      expect(getTracer().getCurrentSpan()).toBeUndefined();
    });

    test('should use GenAI attributes', () => {
      setupObservability({});

      const span = tracer.startSpan('agent.run', {
        attributes: {
          [GEN_AI_AGENT_NAME]: 'my-agent',
          [GEN_AI_REQUEST_MODEL]: 'gpt-4-turbo',
        },
      });

      expect(span.attributes[GEN_AI_AGENT_NAME]).toBe('my-agent');
      expect(span.attributes[GEN_AI_REQUEST_MODEL]).toBe('gpt-4-turbo');
    });
  });

  describe('ConsoleExporter', () => {
    test('should export spans to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const exporter = new ConsoleExporter();
      const span = createSpan('test.span');
      span.end({ code: 'OK' });

      await exporter.export([span]);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
