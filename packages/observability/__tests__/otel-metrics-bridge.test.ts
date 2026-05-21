import { describe, it, expect, beforeEach } from 'vitest';
import type { Metrics } from '@primo-ai/sdk';
import { InMemoryMetrics } from '../src/metrics.js';
import { OtelMetricsBridge } from '../src/otel-metrics-bridge.js';

describe('OtelMetricsBridge', () => {
  describe('Metrics interface contract', () => {
    let bridge: Metrics;

    beforeEach(() => {
      // No MeterProvider provided → graceful degrade to InMemoryMetrics only
      bridge = new OtelMetricsBridge({});
    });

    it('implements the Metrics interface', () => {
      expect(typeof bridge.increment).toBe('function');
      expect(typeof bridge.gauge).toBe('function');
      expect(typeof bridge.histogram).toBe('function');
    });

    it('increment() records counter without OTel', () => {
      bridge.increment('test.counter', 1);
      bridge.increment('test.counter', 2);
      // Should not throw — validates graceful degradation
    });

    it('gauge() records value without OTel', () => {
      bridge.gauge('test.gauge', 42);
      // Should not throw
    });

    it('histogram() records value without OTel', () => {
      bridge.histogram('test.latency', 150);
      bridge.histogram('test.latency', 200);
      // Should not throw
    });
  });

  describe('Graceful degradation (no MeterProvider)', () => {
    let bridge: Metrics & { snapshot: () => ReturnType<InMemoryMetrics['snapshot']>; reset: () => void };

    beforeEach(() => {
      bridge = new OtelMetricsBridge({});
    });

    it('does not throw when MeterProvider is absent', () => {
      expect(() => {
        bridge.increment('foo', 1);
        bridge.gauge('bar', 1);
        bridge.histogram('baz', 1);
      }).not.toThrow();
    });

    it('still records metrics via InMemoryMetrics', () => {
      bridge.increment('req.count', 1);
      bridge.increment('req.count', 1);

      bridge.gauge('mem.bytes', 1024);

      bridge.histogram('req.latency', 100);
      bridge.histogram('req.latency', 200);

      const snap = bridge.snapshot();
      expect(snap.counters['req.count']).toBe(2);
      expect(snap.gauges['mem.bytes']).toBe(1024);
      expect(snap.histograms['req.latency'].count).toBe(2);
      expect(snap.histograms['req.latency'].sum).toBe(300);
      expect(snap.histograms['req.latency'].min).toBe(100);
      expect(snap.histograms['req.latency'].max).toBe(200);
    });

    it('snapshot() returns expected shape', () => {
      bridge.increment('a', 1);
      const snap = bridge.snapshot();
      expect(snap).toHaveProperty('counters');
      expect(snap).toHaveProperty('gauges');
      expect(snap).toHaveProperty('histograms');
      expect(snap).toHaveProperty('labeledCounters');
      expect(snap).toHaveProperty('labeledGauges');
      expect(snap).toHaveProperty('labeledHistograms');
    });

    it('reset() clears all metrics', () => {
      bridge.increment('x', 10);
      bridge.gauge('y', 20);
      bridge.histogram('z', 30);

      bridge.reset();

      const snap = bridge.snapshot();
      expect(snap.counters['x']).toBeUndefined();
      expect(snap.gauges['y']).toBeUndefined();
      expect(snap.histograms['z']).toBeUndefined();
    });
  });

  describe('Labeled metrics', () => {
    let bridge: Metrics & { snapshot: () => ReturnType<InMemoryMetrics['snapshot']>; reset: () => void };

    beforeEach(() => {
      bridge = new OtelMetricsBridge({});
    });

    it('records labeled counters', () => {
      bridge.increment('http.requests', 1, { method: 'GET', status: '200' });
      bridge.increment('http.requests', 1, { method: 'POST', status: '201' });
      bridge.increment('http.requests', 1, { method: 'GET', status: '200' });

      const snap = bridge.snapshot();
      const keys = Object.keys(snap.labeledCounters);
      expect(keys.length).toBe(2);
    });

    it('records labeled gauges', () => {
      bridge.gauge('db.pool', 10, { name: 'primary' });
      bridge.gauge('db.pool', 5, { name: 'replica' });

      const snap = bridge.snapshot();
      const keys = Object.keys(snap.labeledGauges);
      expect(keys.length).toBe(2);
    });

    it('records labeled histograms', () => {
      bridge.histogram('endpoint.latency', 50, { route: '/api/agents' });
      bridge.histogram('endpoint.latency', 75, { route: '/api/agents' });

      const snap = bridge.snapshot();
      const keys = Object.keys(snap.labeledHistograms);
      expect(keys.length).toBe(1);

      const key = Object.keys(snap.labeledHistograms)[0];
      expect(snap.labeledHistograms[key].count).toBe(2);
    });
  });

  describe('getCounter / getGauge / getHistogram', () => {
    let bridge: Metrics & {
      getCounter: (name: string, labels?: Record<string, string>) => number;
      getGauge: (name: string, labels?: Record<string, string>) => number | undefined;
      getHistogram: (name: string, labels?: Record<string, string>) => ReturnType<InMemoryMetrics['getHistogram']>;
    };

    beforeEach(() => {
      bridge = new OtelMetricsBridge({});
    });

    it('getCounter returns current value', () => {
      bridge.increment('items', 1);
      bridge.increment('items', 2);
      expect(bridge.getCounter('items')).toBe(3);
    });

    it('getCounter returns 0 for unknown metric', () => {
      expect(bridge.getCounter('unknown')).toBe(0);
    });

    it('getGauge returns current value', () => {
      bridge.gauge('temperature', 23.5);
      expect(bridge.getGauge('temperature')).toBe(23.5);
    });

    it('getGauge returns undefined for unknown metric', () => {
      expect(bridge.getGauge('unknown')).toBeUndefined();
    });

    it('getHistogram returns stats', () => {
      bridge.histogram('size', 10);
      bridge.histogram('size', 20);
      bridge.histogram('size', 30);

      const stats = bridge.getHistogram('size');
      expect(stats).toBeDefined();
      expect(stats!.count).toBe(3);
      expect(stats!.sum).toBe(60);
      expect(stats!.min).toBe(10);
      expect(stats!.max).toBe(30);
      expect(stats!.avg).toBe(20);
    });
  });
});
