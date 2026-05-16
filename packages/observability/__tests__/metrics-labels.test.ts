import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMetrics, type MetricsSnapshot } from '../src/metrics.js';

describe('InMemoryMetrics — label support', () => {
  let m: InMemoryMetrics;

  beforeEach(() => {
    m = new InMemoryMetrics();
  });

  // ---------------------------------------------------------------------------
  // Counter labels
  // ---------------------------------------------------------------------------
  describe('counter with labels', () => {
    it('increments a counter with labels independently from the base counter', () => {
      m.increment('requests');
      m.increment('requests', 1, { method: 'GET' });
      m.increment('requests', 1, { method: 'POST' });
      m.increment('requests', 1, { method: 'GET' });

      expect(m.getCounter('requests')).toBe(1);
      expect(m.getCounter('requests', { method: 'GET' })).toBe(2);
      expect(m.getCounter('requests', { method: 'POST' })).toBe(1);
    });

    it('returns 0 for unseen label combination', () => {
      expect(m.getCounter('requests', { method: 'PUT' })).toBe(0);
    });

    it('handles multiple label keys', () => {
      m.increment('requests', 1, { method: 'GET', path: '/api' });
      m.increment('requests', 1, { method: 'GET', path: '/api' });
      m.increment('requests', 1, { method: 'POST', path: '/api' });

      expect(m.getCounter('requests', { method: 'GET', path: '/api' })).toBe(2);
      expect(m.getCounter('requests', { method: 'POST', path: '/api' })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Gauge labels
  // ---------------------------------------------------------------------------
  describe('gauge with labels', () => {
    it('records gauge values per label combination independently', () => {
      m.gauge('temperature', 72);
      m.gauge('temperature', 50, { city: 'NYC' });
      m.gauge('temperature', 80, { city: 'LA' });

      expect(m.getGauge('temperature')).toBe(72);
      expect(m.getGauge('temperature', { city: 'NYC' })).toBe(50);
      expect(m.getGauge('temperature', { city: 'LA' })).toBe(80);
    });

    it('returns undefined for unseen gauge label combination', () => {
      expect(m.getGauge('temperature', { city: 'CHI' })).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Histogram labels
  // ---------------------------------------------------------------------------
  describe('histogram with labels', () => {
    it('records histogram values per label combination independently', () => {
      m.histogram('latency', 100);
      m.histogram('latency', 200, { endpoint: '/api' });
      m.histogram('latency', 300, { endpoint: '/api' });
      m.histogram('latency', 400, { endpoint: '/health' });

      const base = m.getHistogram('latency');
      expect(base!.count).toBe(1);

      const apiHist = m.getHistogram('latency', { endpoint: '/api' });
      expect(apiHist!.count).toBe(2);
      expect(apiHist!.sum).toBe(500);
      expect(apiHist!.avg).toBe(250);

      const healthHist = m.getHistogram('latency', { endpoint: '/health' });
      expect(healthHist!.count).toBe(1);
      expect(healthHist!.max).toBe(400);
    });

    it('returns undefined for unseen histogram label combination', () => {
      expect(m.getHistogram('latency', { endpoint: '/unknown' })).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot with labels
  // ---------------------------------------------------------------------------
  describe('snapshot with labels', () => {
    it('includes labeled metrics in snapshot', () => {
      m.increment('requests', 1, { method: 'GET' });
      m.gauge('cpu', 0.8, { host: 'a' });
      m.histogram('latency', 50, { endpoint: '/api' });

      const snap = m.snapshot();

      // Base metrics should be empty since we only recorded labeled values
      expect(snap.counters.requests).toBeUndefined();
      expect(snap.gauges.cpu).toBeUndefined();
      expect(snap.histograms.latency).toBeUndefined();

      // Labeled metrics should appear
      expect(snap.labeledCounters).toBeDefined();
      expect(snap.labeledGauges).toBeDefined();
      expect(snap.labeledHistograms).toBeDefined();
    });

    it('snapshot includes both labeled and unlabeled metrics', () => {
      m.increment('requests');
      m.increment('requests', 1, { method: 'POST' });

      const snap = m.snapshot();
      expect(snap.counters.requests).toBe(1);

      // Find the labeled counter
      const labeledKey = 'requests|method=POST';
      expect(snap.labeledCounters![labeledKey]).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Reset with labels
  // ---------------------------------------------------------------------------
  describe('reset with labels', () => {
    it('clears all labeled metrics on reset', () => {
      m.increment('requests', 1, { method: 'GET' });
      m.gauge('cpu', 0.8, { host: 'a' });
      m.histogram('latency', 50, { endpoint: '/api' });

      m.reset();

      expect(m.getCounter('requests', { method: 'GET' })).toBe(0);
      expect(m.getGauge('cpu', { host: 'a' })).toBeUndefined();
      expect(m.getHistogram('latency', { endpoint: '/api' })).toBeUndefined();

      const snap = m.snapshot();
      expect(snap.labeledCounters).toEqual({});
      expect(snap.labeledGauges).toEqual({});
      expect(snap.labeledHistograms).toEqual({});
    });
  });
});
