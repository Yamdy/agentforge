/**
 * Default Implementations for Core DI Interfaces
 *
 * Provides zero-config defaults for Tracer and Metrics interfaces.
 * Following AgentForge's DI pattern: interfaces in core, implementations
 * can be swapped. Defaults allow `createAgent()` to work out of the box.
 *
 * @module core/defaults
 */

import type { Tracer, Metrics, SpanOptions } from './interfaces.js';

// ============================================================
// Tracer Defaults
// ============================================================

/**
 * No-op Tracer — silently discards all spans.
 *
 * Use when tracing is not needed (testing, simple scripts).
 * Zero overhead: all method bodies are empty.
 *
 * @example
 * ```typescript
 * const services = createDefaultAppServices();
 * // services.tracer is NoopTracer by default
 * ```
 */
export class NoopTracer implements Tracer {
  startSpan(_name: string, _options?: SpanOptions): string {
    return '';
  }

  endSpan(_spanId: string, _options?: { code?: string }): void {
    // no-op
  }

  addEvent(_spanId: string, _name: string, _attributes?: Record<string, unknown>): void {
    // no-op
  }

  recordException(_spanId: string, _error: Error): void {
    // no-op
  }
}

/**
 * Console Tracer — logs span lifecycle to console.
 *
 * Suitable for development and debugging.
 * Produces human-readable output like:
 * ```
 * [trace] START span "llm.request" (span-abc123)
 * [trace]   EVENT "tool.call" in span-abc123 { tool: "read" }
 * [trace] END span "llm.request" (span-abc123) code=ok
 * ```
 *
 * @example
 * ```typescript
 * const tracer = new ConsoleTracer();
 * const spanId = tracer.startSpan('llm.request', { attributes: { model: 'gpt-4o' } });
 * // ... do work ...
 * tracer.endSpan(spanId, { code: 'ok' });
 * ```
 */
export class ConsoleTracer implements Tracer {
  private prefix: string;

  constructor(prefix = 'trace') {
    this.prefix = prefix;
  }

  startSpan(name: string, options?: SpanOptions): string {
    const spanId = `span-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const attrs = options?.attributes
      ? ` ${JSON.stringify(options.attributes)}`
      : '';
    const parent = options?.parent ? ` (parent: ${options.parent})` : '';
    console.info(`[${this.prefix}] START "${name}" (${spanId})${parent}${attrs}`);
    return spanId;
  }

  endSpan(spanId: string, options?: { code?: string }): void {
    const code = options?.code ?? 'ok';
    console.info(`[${this.prefix}] END (${spanId}) code=${code}`);
  }

  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const attrs = attributes ? ` ${JSON.stringify(attributes)}` : '';
    console.info(`[${this.prefix}]   EVENT "${name}" in ${spanId}${attrs}`);
  }

  recordException(spanId: string, error: Error): void {
    console.error(`[${this.prefix}]   EXCEPTION in ${spanId}: ${error.message}`, error);
  }
}

// ============================================================
// Metrics Defaults
// ============================================================

/**
 * No-op Metrics — silently discards all metric recordings.
 *
 * Use when metrics collection is not needed (testing, simple scripts).
 * Zero overhead: all method bodies are empty.
 *
 * @example
 * ```typescript
 * const services = createDefaultAppServices();
 * // services.metrics is NoopMetrics by default
 * ```
 */
export class NoopMetrics implements Metrics {
  increment(_name: string, _value?: number, _tags?: Record<string, string>): void {
    // no-op
  }

  histogram(_name: string, _value: number, _tags?: Record<string, string>): void {
    // no-op
  }

  gauge(_name: string, _value: number, _tags?: Record<string, string>): void {
    // no-op
  }
}

/**
 * Console Metrics — logs metric recordings to console.
 *
 * Suitable for development and debugging.
 * Produces output like:
 * ```
 * [metrics] counter "agent.steps" +1 {session: "abc"}
 * [metrics] histogram "llm.latency_ms" 142 {model: "gpt-4o"}
 * [metrics] gauge "agent.memory_mb" 23.5
 * ```
 *
 * @example
 * ```typescript
 * const metrics = new ConsoleMetrics();
 * metrics.increment('agent.steps', 1, { session: 'abc' });
 * metrics.histogram('llm.latency_ms', 142, { model: 'gpt-4o' });
 * ```
 */
export class ConsoleMetrics implements Metrics {
  private prefix: string;

  constructor(prefix = 'metrics') {
    this.prefix = prefix;
  }

  increment(name: string, value?: number, tags?: Record<string, string>): void {
    const tagStr = tags ? ` ${JSON.stringify(tags)}` : '';
    console.info(`[${this.prefix}] counter "${name}" +${value ?? 1}${tagStr}`);
  }

  histogram(name: string, value: number, tags?: Record<string, string>): void {
    const tagStr = tags ? ` ${JSON.stringify(tags)}` : '';
    console.info(`[${this.prefix}] histogram "${name}" ${value}${tagStr}`);
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    const tagStr = tags ? ` ${JSON.stringify(tags)}` : '';
    console.info(`[${this.prefix}] gauge "${name}" ${value}${tagStr}`);
  }
}

/**
 * Bridge Metrics — adapts core Metrics interface to MPU MetricsCollector.
 *
 * This bridges the gap between the lightweight core `Metrics` interface
 * (increment/histogram/gauge) and the production MPU `MetricsCollector`
 * (incrementCounter/recordHistogram/recordGauge + Prometheus output).
 *
 * Use when you want production-grade metrics collection with Prometheus
 * output but need to wire it through the core `Metrics` interface.
 *
 * @example
 * ```typescript
 * import { MetricsCollectorImpl } from '../observability/metrics-collector.js';
 *
 * const collector = new MetricsCollectorImpl({ prefix: 'agentforge' });
 * const metrics = new BridgeMetrics(collector);
 *
 * // Now metrics.increment() goes through MetricsCollectorImpl
 * // and can be exported via collector.getMetrics() in Prometheus format
 * ```
 */
export class BridgeMetrics implements Metrics {
  private collector: {
    incrementCounter(name: string, labels?: Record<string, string>): void;
    recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
    recordGauge(name: string, value: number, labels?: Record<string, string>): void;
  };

  constructor(
    collector: {
      incrementCounter(name: string, labels?: Record<string, string>): void;
      recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
      recordGauge(name: string, value: number, labels?: Record<string, string>): void;
    },
  ) {
    this.collector = collector;
  }

  increment(name: string, value?: number, tags?: Record<string, string>): void {
    // Metrics.increment defaults to 1, MetricsCollector tracks counts
    // Call incrementCounter 'value' times (default 1)
    const count = value ?? 1;
    for (let i = 0; i < count; i++) {
      this.collector.incrementCounter(name, tags);
    }
  }

  histogram(name: string, value: number, tags?: Record<string, string>): void {
    this.collector.recordHistogram(name, value, tags);
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    this.collector.recordGauge(name, value, tags);
  }
}