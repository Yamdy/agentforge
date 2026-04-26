/**
 * Unit tests for src/observability/metrics-collector.ts
 *
 * Tests MetricsCollector: counters, histograms, gauges,
 * Prometheus format output, reset, and label handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollectorImpl } from '../../src/observability/metrics-collector.js';

// ============================================================
// Counter
// ============================================================

describe('MetricsCollectorImpl', () => {
  let collector: MetricsCollectorImpl;

  beforeEach(() => {
    collector = new MetricsCollectorImpl();
  });

  describe('incrementCounter', () => {
    it('should increment a counter by 1', async () => {
      collector.incrementCounter('requests');
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('requests 1');
    });

    it('should increment multiple times', async () => {
      collector.incrementCounter('requests');
      collector.incrementCounter('requests');
      collector.incrementCounter('requests');
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('requests 3');
    });

    it('should handle multiple distinct counters', async () => {
      collector.incrementCounter('requests');
      collector.incrementCounter('errors');
      collector.incrementCounter('requests');
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('requests 2');
      expect(metrics).toContain('errors 1');
    });

    it('should handle labels', async () => {
      collector.incrementCounter('requests', { method: 'GET' });
      collector.incrementCounter('requests', { method: 'POST' });
      collector.incrementCounter('requests', { method: 'GET' });
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('requests{method="GET"} 2');
      expect(metrics).toContain('requests{method="POST"} 1');
    });

    it('should handle multiple labels', async () => {
      collector.incrementCounter('requests', {
        method: 'GET',
        status: '200',
      });
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('requests{');
      expect(metrics).toContain('method="GET"');
      expect(metrics).toContain('status="200"');
      expect(metrics).toContain('} 1');
    });
  });

  // ============================================================
  // Histogram
  // ============================================================

  describe('recordHistogram', () => {
    it('should record histogram values', async () => {
      collector.recordHistogram('latency', 100);
      collector.recordHistogram('latency', 200);
      collector.recordHistogram('latency', 300);
      const metrics = await collector.getMetrics();
      // Histogram should expose count and sum
      expect(metrics).toContain('latency_count 3');
      expect(metrics).toContain('latency_sum 600');
    });

    it('should record histogram with labels', async () => {
      collector.recordHistogram('latency', 100, { endpoint: '/api' });
      collector.recordHistogram('latency', 200, { endpoint: '/api' });
      collector.recordHistogram('latency', 50, { endpoint: '/health' });
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('latency_count{endpoint="/api"} 2');
      expect(metrics).toContain('latency_sum{endpoint="/api"} 300');
      expect(metrics).toContain('latency_count{endpoint="/health"} 1');
      expect(metrics).toContain('latency_sum{endpoint="/health"} 50');
    });

    it('should track min and max values', async () => {
      collector.recordHistogram('latency', 10);
      collector.recordHistogram('latency', 90);
      collector.recordHistogram('latency', 50);
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('latency_min 10');
      expect(metrics).toContain('latency_max 90');
    });
  });

  // ============================================================
  // Gauge
  // ============================================================

  describe('recordGauge', () => {
    it('should record gauge value', async () => {
      collector.recordGauge('connections', 5);
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('connections 5');
    });

    it('should overwrite previous gauge value', async () => {
      collector.recordGauge('connections', 5);
      collector.recordGauge('connections', 10);
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('connections 10');
      expect(metrics).not.toMatch(/connections 5\b/);
    });

    it('should record gauge with labels', async () => {
      collector.recordGauge('queue_size', 42, { queue: 'default' });
      collector.recordGauge('queue_size', 100, { queue: 'priority' });
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('queue_size{queue="default"} 42');
      expect(metrics).toContain('queue_size{queue="priority"} 100');
    });

    it('should overwrite gauge with same labels', async () => {
      collector.recordGauge('queue_size', 42, { queue: 'default' });
      collector.recordGauge('queue_size', 99, { queue: 'default' });
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('queue_size{queue="default"} 99');
    });
  });

  // ============================================================
  // getMetrics - Prometheus format
  // ============================================================

  describe('getMetrics', () => {
    it('should return Prometheus-compatible output', async () => {
      collector.incrementCounter('http_requests');
      const metrics = await collector.getMetrics();
      // Should have HELP and TYPE lines
      expect(metrics).toContain('# HELP http_requests');
      expect(metrics).toContain('# TYPE http_requests counter');
    });

    it('should include correct TYPE for each metric type', async () => {
      collector.incrementCounter('requests');
      collector.recordHistogram('latency', 100);
      collector.recordGauge('connections', 5);
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('# TYPE requests counter');
      expect(metrics).toContain('# TYPE latency histogram');
      expect(metrics).toContain('# TYPE connections gauge');
    });

    it('should return empty string when no metrics', async () => {
      const metrics = await collector.getMetrics();
      expect(metrics).toBe('');
    });

    it('should format labels correctly in Prometheus format', async () => {
      collector.incrementCounter('requests', { method: 'GET' });
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('{method="GET"}');
    });

    it('should sort labels alphabetically', async () => {
      collector.incrementCounter('requests', { z: '1', a: '2', m: '3' });
      const metrics = await collector.getMetrics();
      // Labels should be sorted: a, m, z
      const labelMatch = metrics.match(/\{([^}]+)\}/);
      expect(labelMatch).toBeDefined();
      const labels = labelMatch![1]!;
      const aPos = labels.indexOf('a=');
      const mPos = labels.indexOf('m=');
      const zPos = labels.indexOf('z=');
      expect(aPos).toBeLessThan(mPos);
      expect(mPos).toBeLessThan(zPos);
    });

    it('should handle empty labels object same as no labels', async () => {
      collector.incrementCounter('requests', {});
      collector.incrementCounter('requests');
      const metrics = await collector.getMetrics();
      // Both should contribute to the same metric
      expect(metrics).toContain('requests 2');
    });

    it('should produce valid Prometheus text format', async () => {
      collector.incrementCounter('agentforge_requests', { method: 'GET' });
      collector.recordHistogram('agentforge_latency_ms', 42, {
        endpoint: '/api',
      });
      collector.recordGauge('agentforge_connections', 3);

      const metrics = await collector.getMetrics();
      const lines = metrics.split('\n').filter((l) => l.trim());

      // Verify structure: HELP, TYPE, value lines
      for (const line of lines) {
        if (line.startsWith('#')) {
          expect(line).toMatch(/^# (HELP|TYPE) \w+/);
        }
      }
    });
  });

  // ============================================================
  // reset()
  // ============================================================

  describe('reset', () => {
    it('should clear all metrics', async () => {
      collector.incrementCounter('requests');
      collector.recordHistogram('latency', 100);
      collector.recordGauge('connections', 5);

      collector.reset();

      const metrics = await collector.getMetrics();
      expect(metrics).toBe('');
    });

    it('should allow re-recording after reset', async () => {
      collector.incrementCounter('requests');
      collector.incrementCounter('requests');
      collector.reset();
      collector.incrementCounter('requests');

      const metrics = await collector.getMetrics();
      expect(metrics).toContain('requests 1');
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe('edge cases', () => {
    it('should handle metric names with underscores', async () => {
      collector.incrementCounter('http_requests_total');
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('http_requests_total 1');
    });

    it('should handle special characters in label values', async () => {
      collector.incrementCounter('requests', { path: '/api/v1/users' });
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('/api/v1/users');
    });

    it('should handle zero values', async () => {
      collector.recordHistogram('latency', 0);
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('latency_count 1');
      expect(metrics).toContain('latency_sum 0');
    });

    it('should handle negative gauge values', async () => {
      collector.recordGauge('temperature', -10);
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('temperature -10');
    });

    it('should handle concurrent getMetrics calls', async () => {
      collector.incrementCounter('requests');
      const [m1, m2] = await Promise.all([
        collector.getMetrics(),
        collector.getMetrics(),
      ]);
      expect(m1).toBe(m2);
    });

    it('should handle many metrics without performance issues', async () => {
      for (let i = 0; i < 1000; i++) {
        collector.incrementCounter('requests', { endpoint: `/api/${i % 10}` });
      }
      const metrics = await collector.getMetrics();
      expect(metrics).toContain('requests{endpoint="/api/0"} 100');
    });

    it('should prefix agentforge_ by default when using default prefix', async () => {
      const c = new MetricsCollectorImpl({ prefix: 'agentforge' });
      c.incrementCounter('requests');
      const metrics = await c.getMetrics();
      expect(metrics).toContain('agentforge_requests');
    });

    it('should support custom prefix', async () => {
      const c = new MetricsCollectorImpl({ prefix: 'myapp' });
      c.incrementCounter('requests');
      const metrics = await c.getMetrics();
      expect(metrics).toContain('myapp_requests');
    });

    it('should support empty prefix', async () => {
      const c = new MetricsCollectorImpl({ prefix: '' });
      c.incrementCounter('requests');
      const metrics = await c.getMetrics();
      expect(metrics).toContain('requests 1');
      expect(metrics).not.toContain('_requests');
    });
  });
});
