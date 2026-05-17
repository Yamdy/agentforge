import type { Metrics } from '@primo-ai/sdk';

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
  labeledCounters: Record<string, number>;
  labeledGauges: Record<string, number>;
  labeledHistograms: Record<string, HistogramStats>;
}

type HistogramData = { count: number; sum: number; min: number; max: number };

/**
 * Build a stable serialization key from a metric name and its labels.
 * Labels are sorted alphabetically to ensure deterministic keys.
 */
function labelKey(name: string, labels: Record<string, string>): string {
  const parts = Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`);
  return `${name}|${parts.join(',')}`;
}

export class InMemoryMetrics implements Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, HistogramData>();

  // Labeled variants — keyed by `name|k1=v1,k2=v2`
  private labeledCounters = new Map<string, number>();
  private labeledGauges = new Map<string, number>();
  private labeledHistograms = new Map<string, HistogramData>();

  increment(name: string, delta = 1, labels?: Record<string, string>): void {
    if (labels && Object.keys(labels).length > 0) {
      const key = labelKey(name, labels);
      this.labeledCounters.set(key, (this.labeledCounters.get(key) ?? 0) + delta);
    } else {
      this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
    }
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    if (labels && Object.keys(labels).length > 0) {
      const key = labelKey(name, labels);
      this.labeledGauges.set(key, value);
    } else {
      this.gauges.set(name, value);
    }
  }

  histogram(name: string, value: number, labels?: Record<string, string>): void {
    if (labels && Object.keys(labels).length > 0) {
      const key = labelKey(name, labels);
      const existing = this.labeledHistograms.get(key);
      if (existing) {
        existing.count += 1;
        existing.sum += value;
        if (value < existing.min) existing.min = value;
        if (value > existing.max) existing.max = value;
      } else {
        this.labeledHistograms.set(key, { count: 1, sum: value, min: value, max: value });
      }
    } else {
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
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    if (labels && Object.keys(labels).length > 0) {
      return this.labeledCounters.get(labelKey(name, labels)) ?? 0;
    }
    return this.counters.get(name) ?? 0;
  }

  getGauge(name: string, labels?: Record<string, string>): number | undefined {
    if (labels && Object.keys(labels).length > 0) {
      return this.labeledGauges.get(labelKey(name, labels));
    }
    return this.gauges.get(name);
  }

  getHistogram(name: string, labels?: Record<string, string>): HistogramStats | undefined {
    const map = (labels && Object.keys(labels).length > 0) ? this.labeledHistograms : this.histograms;
    const key = (labels && Object.keys(labels).length > 0) ? labelKey(name, labels) : name;
    const h = map.get(key);
    if (!h) return undefined;
    return { ...h, avg: h.sum / h.count };
  }

  snapshot(): MetricsSnapshot {
    const histograms: Record<string, HistogramStats> = {};
    for (const [name, h] of this.histograms) {
      histograms[name] = { ...h, avg: h.sum / h.count };
    }
    const labeledHists: Record<string, HistogramStats> = {};
    for (const [key, h] of this.labeledHistograms) {
      labeledHists[key] = { ...h, avg: h.sum / h.count };
    }
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
      labeledCounters: Object.fromEntries(this.labeledCounters),
      labeledGauges: Object.fromEntries(this.labeledGauges),
      labeledHistograms: labeledHists,
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.labeledCounters.clear();
    this.labeledGauges.clear();
    this.labeledHistograms.clear();
  }
}
