import type { Metrics } from '@agentforge/sdk';

export interface HistogramStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramStats>;
}

export class InMemoryMetrics implements Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, { count: number; sum: number; min: number; max: number }>();

  increment(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  histogram(name: string, value: number): void {
    const existing = this.histograms.get(name);
    if (existing) {
      existing.count += 1;
      existing.sum += value;
      if (value < existing.min) existing.min = value;
      if (value > existing.max) existing.max = value;
    } else {
      this.histograms.set(name, { count: 1, sum: value, min: value, max: value });
    }
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  getHistogram(name: string): HistogramStats | undefined {
    const h = this.histograms.get(name);
    if (!h) return undefined;
    return { ...h, avg: h.sum / h.count };
  }

  snapshot(): MetricsSnapshot {
    const histograms: Record<string, HistogramStats> = {};
    for (const [name, h] of this.histograms) {
      histograms[name] = { ...h, avg: h.sum / h.count };
    }
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}
