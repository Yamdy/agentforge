import type { Metrics } from '@primo-ai/sdk';
import { metrics as otelMetrics } from '@opentelemetry/api';
import { InMemoryMetrics, type HistogramStats, type MetricsSnapshot } from './metrics.js';

// Duck-typed OTel Meter interface subset (avoids hard dependency on @opentelemetry/sdk-metrics types)
interface OtelMeter {
  createCounter(name: string, options?: { description?: string }): {
    add(v: number, attrs?: Record<string, string>): void;
  };
  createGauge(name: string, options?: { description?: string }): {
    record(v: number, attrs?: Record<string, string>): void;
  };
  createHistogram(name: string, options?: { description?: string }): {
    record(v: number, attrs?: Record<string, string>): void;
  };
}

export interface OtelMetricsBridgeOptions {
  meterProvider?: {
    getMeter(name: string, version?: string, options?: unknown): OtelMeter;
  };
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
  private _otelMeter: OtelMeter | null;

  constructor(options: OtelMetricsBridgeOptions = {}) {
    this.inner = new InMemoryMetrics();
    if (options.meterProvider) {
      this._otelMeter = options.meterProvider.getMeter('@primo-ai/observability', '0.1.5');
    } else {
      this._otelMeter = null;
    }
  }

  // ── Metrics interface ────────────────────────────────────────

  increment(name: string, delta = 1, labels?: Record<string, string>): void {
    this.inner.increment(name, delta, labels);

    if (this._otelMeter) {
      try {
        const attrs = labels ?? {};
        this._getOtelCounter(name).add(delta, attrs);
      } catch {
        // OTel error: silently fall through — metrics are still in InMemoryMetrics
      }
    }
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.inner.gauge(name, value, labels);

    if (this._otelMeter) {
      try {
        const attrs = labels ?? {};
        this._getOtelGauge(name).record(value, attrs);
      } catch {
        // OTel error: silently fall through
      }
    }
  }

  histogram(name: string, value: number, labels?: Record<string, string>): void {
    this.inner.histogram(name, value, labels);

    if (this._otelMeter) {
      try {
        const attrs = labels ?? {};
        this._getOtelHistogram(name).record(value, attrs);
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

  /** Clears all metrics in both InMemoryMetrics and OTel instrument caches. */
  reset(): void {
    this.inner.reset();
    this._counterCache.clear();
    this._gaugeCache.clear();
    this._histCache.clear();
  }

  // ── Private helpers ──────────────────────────────────────────

  private _counterCache = new Map<string, ReturnType<OtelMeter['createCounter']>>();
  private _gaugeCache = new Map<string, ReturnType<OtelMeter['createGauge']>>();
  private _histCache = new Map<string, ReturnType<OtelMeter['createHistogram']>>();

  private _getOtelCounter(name: string) {
    const cached = this._counterCache.get(name);
    if (cached) return cached;
    const counter = this._otelMeter!.createCounter(name, { description: name });
    this._counterCache.set(name, counter);
    return counter;
  }

  private _getOtelGauge(name: string) {
    const cached = this._gaugeCache.get(name);
    if (cached) return cached;
    const gauge = this._otelMeter!.createGauge(name, { description: name });
    this._gaugeCache.set(name, gauge);
    return gauge;
  }

  private _getOtelHistogram(name: string) {
    const cached = this._histCache.get(name);
    if (cached) return cached;
    const histogram = this._otelMeter!.createHistogram(name, { description: name });
    this._histCache.set(name, histogram);
    return histogram;
  }
}
