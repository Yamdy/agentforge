/**
 * Tests for Default DI Implementations
 *
 * NoopTracer, ConsoleTracer, NoopMetrics, ConsoleMetrics, BridgeMetrics
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  NoopTracer,
  ConsoleTracer,
  NoopMetrics,
  ConsoleMetrics,
  BridgeMetrics,
} from '../../src/core/defaults.js';
import type { MetricsCollector } from '../../src/contracts/mpu-interfaces.js';

let MetricsCollectorImpl: typeof import('../../src/observability/metrics-collector.js').MetricsCollectorImpl;
let createDefaultAppServices: typeof import('../../src/core/context.js').createDefaultAppServices;

beforeAll(async () => {
  const metricsMod = await import('../../src/observability/metrics-collector.js');
  MetricsCollectorImpl = metricsMod.MetricsCollectorImpl;
  const ctxMod = await import('../../src/core/context.js');
  createDefaultAppServices = ctxMod.createDefaultAppServices;
});

// ============================================================
// NoopTracer
// ============================================================

describe('NoopTracer', () => {
  it('should return empty string from startSpan', () => {
    const tracer = new NoopTracer();
    const spanId = tracer.startSpan('test-span');
    expect(spanId).toBe('');
  });

  it('should not throw on any method call', () => {
    const tracer = new NoopTracer();
    expect(() => {
      tracer.startSpan('span1', { attributes: { key: 'value' }, parent: 'parent-1' });
      tracer.endSpan('span1', { code: 'ok' });
      tracer.addEvent('span1', 'event1', { detail: 'test' });
      tracer.recordException('span1', new Error('test'));
    }).not.toThrow();
  });
});

// ============================================================
// ConsoleTracer
// ============================================================

describe('ConsoleTracer', () => {
  it('should return a unique span ID from startSpan', () => {
    const tracer = new ConsoleTracer();
    const spanId = tracer.startSpan('test-span');
    expect(spanId).toBeTruthy();
    expect(spanId).toMatch(/^span-/);
  });

  it('should return different span IDs for different calls', () => {
    const tracer = new ConsoleTracer();
    const id1 = tracer.startSpan('span1');
    const id2 = tracer.startSpan('span2');
    expect(id1).not.toBe(id2);
  });

  it('should accept options parameter without error', () => {
    const tracer = new ConsoleTracer();
    const spanId = tracer.startSpan('test', {
      attributes: { model: 'gpt-4o' },
      parent: 'parent-1',
    });
    expect(spanId).toBeTruthy();
  });

  it('should log to console.info on startSpan and endSpan', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tracer = new ConsoleTracer('myapp');
    const spanId = tracer.startSpan('llm.request');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[myapp] START "llm.request"'),
    );

    tracer.endSpan(spanId, { code: 'ok' });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[myapp] END'),
    );

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should default prefix to "trace"', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const tracer = new ConsoleTracer();
    tracer.startSpan('test');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[trace]'),
    );
    infoSpy.mockRestore();
  });

  it('should log events with console.info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const tracer = new ConsoleTracer();
    const spanId = tracer.startSpan('test');
    tracer.addEvent(spanId, 'tool.call', { tool: 'read' });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('EVENT "tool.call"'),
    );
    infoSpy.mockRestore();
  });

  it('should log exceptions with console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracer = new ConsoleTracer();
    const spanId = tracer.startSpan('test');
    const err = new Error('test error');
    tracer.recordException(spanId, err);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('EXCEPTION'),
      err,
    );
    errorSpy.mockRestore();
  });

  it('should default code to "ok" in endSpan', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const tracer = new ConsoleTracer();
    const spanId = tracer.startSpan('test');
    tracer.endSpan(spanId);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('code=ok'),
    );
    infoSpy.mockRestore();
  });
});

// ============================================================
// NoopMetrics
// ============================================================

describe('NoopMetrics', () => {
  it('should not throw on any method call', () => {
    const metrics = new NoopMetrics();
    expect(() => {
      metrics.increment('test.counter', 1, { env: 'test' });
      metrics.histogram('test.latency', 42, { model: 'gpt-4o' });
      metrics.gauge('test.memory', 1024);
    }).not.toThrow();
  });
});

// ============================================================
// ConsoleMetrics
// ============================================================

describe('ConsoleMetrics', () => {
  it('should log increment to console.info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const metrics = new ConsoleMetrics('myapp');
    metrics.increment('steps', 1, { session: 'abc' });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[myapp] counter "steps" +1'),
    );
    infoSpy.mockRestore();
  });

  it('should default value to 1 for increment', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const metrics = new ConsoleMetrics();
    metrics.increment('steps');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('+1'),
    );
    infoSpy.mockRestore();
  });

  it('should default prefix to "metrics"', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const metrics = new ConsoleMetrics();
    metrics.increment('test');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metrics]'),
    );
    infoSpy.mockRestore();
  });

  it('should log histogram to console.info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const metrics = new ConsoleMetrics();
    metrics.histogram('latency_ms', 142, { model: 'gpt-4o' });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metrics] histogram "latency_ms" 142'),
    );
    infoSpy.mockRestore();
  });

  it('should log gauge to console.info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const metrics = new ConsoleMetrics();
    metrics.gauge('memory_mb', 23.5);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metrics] gauge "memory_mb" 23.5'),
    );
    infoSpy.mockRestore();
  });
});

// ============================================================
// BridgeMetrics
// ============================================================

describe('BridgeMetrics', () => {
  it('should delegate increment to collector.incrementCounter', () => {
    const calls: Array<{ method: string; name: string; labels?: Record<string, string> }> = [];
    const collector: MetricsCollector = {
      incrementCounter: (name, labels) => {
        calls.push({ method: 'incrementCounter', name, labels });
      },
      recordHistogram: () => {},
      recordGauge: () => {},
      getMetrics: async () => '',
      reset: () => {},
    };

    const metrics = new BridgeMetrics(collector);
    metrics.increment('steps', 1, { session: 'abc' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      method: 'incrementCounter',
      name: 'steps',
      labels: { session: 'abc' },
    });
  });

  it('should call incrementCounter once with count when value > 1', () => {
    const counterCalls: Array<{ name: string; count: number }> = [];
    const collector: MetricsCollector = {
      incrementCounter: (name, _labels?, count?) => {
        counterCalls.push({ name, count: count ?? 1 });
      },
      recordHistogram: () => {},
      recordGauge: () => {},
      getMetrics: async () => '',
      reset: () => {},
    };

    const metrics = new BridgeMetrics(collector);
    metrics.increment('retries', 3);

    expect(counterCalls).toHaveLength(1);
    expect(counterCalls[0]).toEqual({ name: 'retries', count: 3 });
  });

  it('should default value to 1 for increment', () => {
    const counterCalls: string[] = [];
    const collector: MetricsCollector = {
      incrementCounter: (name) => {
        counterCalls.push(name);
      },
      recordHistogram: () => {},
      recordGauge: () => {},
      getMetrics: async () => '',
      reset: () => {},
    };

    const metrics = new BridgeMetrics(collector);
    metrics.increment('steps');

    expect(counterCalls).toHaveLength(1);
  });

  it('should delegate histogram to collector.recordHistogram', () => {
    const calls: Array<{ name: string; value: number; labels?: Record<string, string> }> = [];
    const collector: MetricsCollector = {
      incrementCounter: () => {},
      recordHistogram: (name, value, labels) => {
        calls.push({ name, value, labels });
      },
      recordGauge: () => {},
      getMetrics: async () => '',
      reset: () => {},
    };

    const metrics = new BridgeMetrics(collector);
    metrics.histogram('latency_ms', 142, { model: 'gpt-4o' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      name: 'latency_ms',
      value: 142,
      labels: { model: 'gpt-4o' },
    });
  });

  it('should delegate gauge to collector.recordGauge', () => {
    const calls: Array<{ name: string; value: number; labels?: Record<string, string> }> = [];
    const collector: MetricsCollector = {
      incrementCounter: () => {},
      recordHistogram: () => {},
      recordGauge: (name, value, labels) => {
        calls.push({ name, value, labels });
      },
      getMetrics: async () => '',
      reset: () => {},
    };

    const metrics = new BridgeMetrics(collector);
    metrics.gauge('memory_mb', 512);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      name: 'memory_mb',
      value: 512,
      labels: undefined,
    });
  });

  it('should work with MetricsCollectorImpl', async () => {
    // Integration test: BridgeMetrics → real MetricsCollectorImpl
    const collector = new MetricsCollectorImpl({ prefix: 'test' });
    const metrics = new BridgeMetrics(collector);

    metrics.increment('requests', 2, { method: 'GET' });
    metrics.histogram('latency_ms', 50, { endpoint: '/api' });
    metrics.gauge('connections', 10);

    // Verify via getMetrics() that data was recorded
    const output = await collector.getMetrics();
    expect(output).toContain('test_requests');
    expect(output).toContain('test_latency_ms');
    expect(output).toContain('test_connections');
  });
});

// ============================================================
// Integration: createDefaultAppServices includes defaults
// ============================================================

describe('createDefaultAppServices defaults', () => {
  it('should include NoopTracer and NoopMetrics by default', async () => {
    const services = createDefaultAppServices();

    expect(services.tracer).toBeDefined();
    expect(services.metrics).toBeDefined();

    // Verify they're no-ops (don't throw)
    expect(() => {
      services.tracer!.startSpan('test');
      services.tracer!.endSpan('test');
      services.metrics!.increment('test');
      services.metrics!.histogram('test', 1);
      services.metrics!.gauge('test', 1);
    }).not.toThrow();
  });
});