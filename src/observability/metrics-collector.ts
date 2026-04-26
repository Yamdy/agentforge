/**
 * Metrics Collector
 *
 * In-memory metrics collection with Prometheus text format output.
 * Supports counters, histograms, and gauges with labels.
 *
 * @module observability/metrics-collector
 */

import type { MetricsCollector } from '../contracts/mpu-interfaces.js';

/**
 * MetricsCollector constructor options
 */
export interface MetricsCollectorOptions {
  /**
   * Metric name prefix.
   * Set to '' for no prefix. Default: no prefix.
   */
  readonly prefix?: string;
}

/**
 * Internal counter state
 */
interface CounterState {
  type: 'counter';
  labelSets: Map<string, number>;
}

/**
 * Internal histogram state
 */
interface HistogramState {
  type: 'histogram';
  labelSets: Map<string, { count: number; sum: number; min: number; max: number }>;
}

/**
 * Internal gauge state
 */
interface GaugeState {
  type: 'gauge';
  labelSets: Map<string, number>;
}

type MetricState = CounterState | HistogramState | GaugeState;

/**
 * Concrete implementation of the MetricsCollector interface.
 *
 * Stores metrics in memory and outputs Prometheus text exposition format.
 *
 * @example
 * ```typescript
 * const collector = new MetricsCollectorImpl({ prefix: 'agentforge' });
 *
 * collector.incrementCounter('requests', { method: 'GET' });
 * collector.recordHistogram('latency_ms', 42, { endpoint: '/api' });
 * collector.recordGauge('connections', 5);
 *
 * const prometheus = await collector.getMetrics();
 * // # HELP agentforge_requests Total count
 * // # TYPE agentforge_requests counter
 * // agentforge_requests{method="GET"} 1
 * ```
 */
export class MetricsCollectorImpl implements MetricsCollector {
  private readonly _prefix: string;
  private readonly _metrics: Map<string, MetricState> = new Map();

  constructor(options: MetricsCollectorOptions = {}) {
    this._prefix = options.prefix ?? '';
  }

  /**
   * Increment a counter by 1.
   *
   * @param name - Counter name
   * @param labels - Optional label key-value pairs
   */
  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = this._fullName(name);
    let state = this._metrics.get(key);

    if (!state) {
      state = { type: 'counter', labelSets: new Map() };
      this._metrics.set(key, state);
    }

    if (state.type !== 'counter') {
      // Type conflict — silently ignore (same as Prometheus client behavior)
      return;
    }

    const labelKey = this._labelKey(labels);
    const current = state.labelSets.get(labelKey) ?? 0;
    state.labelSets.set(labelKey, current + 1);
  }

  /**
   * Record a histogram observation.
   *
   * Tracks count, sum, min, and max per label set.
   *
   * @param name - Histogram name
   * @param value - Observed value
   * @param labels - Optional label key-value pairs
   */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this._fullName(name);
    let state = this._metrics.get(key);

    if (!state) {
      state = { type: 'histogram', labelSets: new Map() };
      this._metrics.set(key, state);
    }

    if (state.type !== 'histogram') {
      return;
    }

    const labelKey = this._labelKey(labels);
    const existing = state.labelSets.get(labelKey);

    if (!existing) {
      state.labelSets.set(labelKey, {
        count: 1,
        sum: value,
        min: value,
        max: value,
      });
    } else {
      existing.count += 1;
      existing.sum += value;
      if (value < existing.min) existing.min = value;
      if (value > existing.max) existing.max = value;
    }
  }

  /**
   * Record a gauge value (overwrites previous).
   *
   * @param name - Gauge name
   * @param value - Current value
   * @param labels - Optional label key-value pairs
   */
  recordGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this._fullName(name);
    let state = this._metrics.get(key);

    if (!state) {
      state = { type: 'gauge', labelSets: new Map() };
      this._metrics.set(key, state);
    }

    if (state.type !== 'gauge') {
      return;
    }

    const labelKey = this._labelKey(labels);
    state.labelSets.set(labelKey, value);
  }

  /**
   * Get all metrics in Prometheus text exposition format.
   *
   * @returns Prometheus-formatted string
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getMetrics(): Promise<string> {
    const lines: string[] = [];

    for (const [fullName, state] of this._metrics) {
      const type = state.type;
      lines.push(`# HELP ${fullName}`);
      lines.push(`# TYPE ${fullName} ${type}`);

      for (const [labelKey, value] of state.labelSets) {
        const labelStr = labelKey ? `{${labelKey}}` : '';

        if (type === 'counter') {
          lines.push(`${fullName}${labelStr} ${String(value)}`);
        } else if (type === 'gauge') {
          lines.push(`${fullName}${labelStr} ${String(value)}`);
        } else if (type === 'histogram') {
          const h = value as {
            count: number;
            sum: number;
            min: number;
            max: number;
          };
          lines.push(`${fullName}_count${labelStr} ${h.count}`);
          lines.push(`${fullName}_sum${labelStr} ${h.sum}`);
          lines.push(`${fullName}_min${labelStr} ${h.min}`);
          lines.push(`${fullName}_max${labelStr} ${h.max}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Reset all collected metrics.
   */
  reset(): void {
    this._metrics.clear();
  }

  // ===== Private Methods =====

  /**
   * Build full metric name with prefix.
   */
  private _fullName(name: string): string {
    if (this._prefix === '') return name;
    return `${this._prefix}_${name}`;
  }

  /**
   * Build a canonical label string from a labels object.
   * Labels are sorted alphabetically by key.
   * Empty labels object is treated same as undefined.
   */
  private _labelKey(labels?: Record<string, string>): string {
    if (!labels) return '';
    const keys = Object.keys(labels);
    if (keys.length === 0) return '';

    keys.sort();
    return keys.map(k => `${k}="${labels[k]}"`).join(',');
  }
}
