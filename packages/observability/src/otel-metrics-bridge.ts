import type { Metrics } from '@primo-ai/sdk';
import { metrics } from '@opentelemetry/api';
import { InMemoryMetrics, type HistogramStats, type MetricsSnapshot } from './metrics.js';

export interface OtelMetricsBridgeOptions {
  meterProvider?: unknown; // OTel MeterProvider — optional, graceful degrade when absent
  serviceName?: string;
}

/**
 * Metrics implementation that records to both InMemoryMetrics (for snapshot/query)
 * and OpenTelemetry instruments (for OTLP export), when a MeterProvider is available.
 *
 * When no MeterProvider is provided, degrades gracefully — behaves identically
 * to InMemoryMetrics with zero OTel overhead.
 */
export class OtelMetricsBridge implements Metrics {
  private inner: InMemoryMetrics;
  private _otelEnabled: boolean;

  constructor(options: OtelMetricsBridgeOptions) {
    this.inner = new InMemoryMetrics();
    this._otelEnabled = options.meterProvider != null;
  }

  // ── Metrics interface ────────────────────────────────────────

  increment(name: string, delta = 1, labels?: Record<string, string>): void {
    this.inner.increment(name, delta, labels);

    if (this._otelEnabled) {
      try {
        const attrs = labels ?? {};
        const counter = this._getOtelCounter(name);
        counter.add(delta, attrs);
      } catch {
        // OTel error: silently fall through — metrics are still in InMemoryMetrics
      }
    }
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.inner.gauge(name, value, labels);

    if (this._otelEnabled) {
      try {
        const attrs = labels ?? {};
        const hist = this._getOtelHistogram(name);
        hist.record(value, attrs);
      } catch {
        // OTel error: silently fall through
      }
    }
  }

  histogram(name: string, value: number, labels?: Record<string, string>): void {
    this.inner.histogram(name, value, labels);

    if (this._otelEnabled) {
      try {
        const attrs = labels ?? {};
        const hist = this._getOtelHistogram(name);
        hist.record(value, attrs);
      } catch {
        // OTel error: silently fall through
      }
    }
  }

  // ── Query methods (delegated to InMemoryMetrics) ─────────────

  getCounter(name: string, labels?: Record<string, string>): number {
    return this.inner.getCounter(name, labels);
  }

  getGauge(name: string, labels?: Record<string, string>): number | undefined {
    return this.inner.getGauge(name, labels);
  }

  getHistogram(name: string, labels?: Record<string, string>): HistogramStats | undefined {
    return this.inner.getHistogram(name, labels);
  }

  snapshot(): MetricsSnapshot {
    return this.inner.snapshot();
  }

  reset(): void {
    this.inner.reset();
  }

  // ── Private helpers ──────────────────────────────────────────

  private _counterCache = new Map<string, { add: (v: number, attrs?: Record<string, string>) => void }>();
  private _histCache = new Map<string, { record: (v: number, attrs?: Record<string, string>) => void }>();

  private _getOtelMeter(): {
    createCounter(name: string, options?: { description?: string }): { add: (v: number, attrs?: Record<string, string>) => void };
    createHistogram(name: string, options?: { description?: string }): { record: (v: number, attrs?: Record<string, string>) => void };
  } {
    return metrics.getMeter('@primo-ai/observability', '0.1.5') as ReturnType<typeof this._getOtelMeter>;
  }

  private _getOtelCounter(name: string) {
    const cached = this._counterCache.get(name);
    if (cached) return cached;
    const meter = this._getOtelMeter();
    const counter = meter.createCounter(name, { description: name });
    this._counterCache.set(name, counter);
    return counter;
  }

  private _getOtelHistogram(name: string) {
    const cached = this._histCache.get(name);
    if (cached) return cached;
    const meter = this._getOtelMeter();
    const histogram = meter.createHistogram(name, { description: name });
    this._histCache.set(name, histogram);
    return histogram;
  }
}
