import { describe, it, expect } from 'vitest';
import { InMemoryMetrics } from '../src/metrics.js';

describe('InMemoryMetrics', () => {
  it('increment adds to counter', () => {
    const m = new InMemoryMetrics();
    m.increment('requests');
    m.increment('requests');
    m.increment('requests', 3);

    expect(m.getCounter('requests')).toBe(5);
  });

  it('increment with default delta of 1', () => {
    const m = new InMemoryMetrics();
    m.increment('errors');
    expect(m.getCounter('errors')).toBe(1);
  });

  it('getCounter returns 0 for unseen metric', () => {
    const m = new InMemoryMetrics();
    expect(m.getCounter('unknown')).toBe(0);
  });

  it('gauge records latest value', () => {
    const m = new InMemoryMetrics();
    m.gauge('temperature', 72);
    m.gauge('temperature', 75);

    expect(m.getGauge('temperature')).toBe(75);
  });

  it('getGauge returns undefined for unseen metric', () => {
    const m = new InMemoryMetrics();
    expect(m.getGauge('unknown')).toBeUndefined();
  });

  it('histogram records values and computes stats', () => {
    const m = new InMemoryMetrics();
    m.histogram('latency', 100);
    m.histogram('latency', 200);
    m.histogram('latency', 300);

    const stats = m.getHistogram('latency');
    expect(stats).toBeDefined();
    expect(stats!.count).toBe(3);
    expect(stats!.sum).toBe(600);
    expect(stats!.min).toBe(100);
    expect(stats!.max).toBe(300);
    expect(stats!.avg).toBeCloseTo(200);
  });

  it('getHistogram returns undefined for unseen metric', () => {
    const m = new InMemoryMetrics();
    expect(m.getHistogram('unknown')).toBeUndefined();
  });

  it('snapshot returns all metrics', () => {
    const m = new InMemoryMetrics();
    m.increment('requests');
    m.gauge('cpu', 0.8);
    m.histogram('latency', 50);

    const snap = m.snapshot();
    expect(snap.counters).toEqual({ requests: 1 });
    expect(snap.gauges).toEqual({ cpu: 0.8 });
    expect(snap.histograms.latency!.count).toBe(1);
    expect(snap.histograms.latency!.sum).toBe(50);
  });

  it('reset clears all metrics', () => {
    const m = new InMemoryMetrics();
    m.increment('x');
    m.gauge('y', 1);
    m.histogram('z', 1);

    m.reset();
    expect(m.getCounter('x')).toBe(0);
    expect(m.getGauge('y')).toBeUndefined();
    expect(m.getHistogram('z')).toBeUndefined();
  });

  it('works with namespaced metric names', () => {
    const m = new InMemoryMetrics();
    m.increment('agentforge.requests.total');
    m.gauge('agentforge.memory.used', 1024);

    expect(m.getCounter('agentforge.requests.total')).toBe(1);
    expect(m.getGauge('agentforge.memory.used')).toBe(1024);
  });
});
