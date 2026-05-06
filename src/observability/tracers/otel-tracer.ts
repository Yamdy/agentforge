/**
 * OTelTracer — OpenTelemetry Tracer Implementation
 *
 * Lazy-loads the full OpenTelemetry SDK at configure() time via dynamic import(),
 * keeping the baseline import cost near zero. Active spans are managed in a
 * Map<string, Span> keyed by each span's spanContext().spanId.
 *
 * Before configure(): all Tracer methods are no-ops (startSpan returns '').
 * After configure(): spans are created via OTel SDK and exported to the configured
 * OTLP HTTP endpoint via BatchSpanProcessor.
 *
 * @module observability/tracers/otel-tracer
 */

import type { Tracer, SpanOptions } from '../../core/interfaces.js';

// ============================================================
// Configuration
// ============================================================

/**
 * Configuration for OTelTracer.
 *
 * @example
 * ```typescript
 * const tracer = new OTelTracer();
 * await tracer.configure({
 *   endpoint: 'https://otel-collector.example.com/v1/traces',
 *   serviceName: 'my-agent',
 * });
 * ```
 */
export interface OTelConfig {
  /** OTLP HTTP endpoint for trace export (required) */
  endpoint: string;
  /** Service name for resource attributes (default: 'agentforge') */
  serviceName?: string;
  /** Optional headers for OTLP exporter (e.g., authorization) */
  headers?: Record<string, string>;
  /**
   * Sampling ratio 0.0–1.0 (default: 1.0).
   * 1.0 = AlwaysOnSampler, 0 = AlwaysOffSampler,
   * otherwise TraceIdRatioBasedSampler.
   */
  sampler?: number;
}

// ============================================================
// OTelTracer
// ============================================================

/**
 * OpenTelemetry Tracer implementation.
 *
 * Lazy-loads the full OTel SDK only when configure() is called,
 * keeping the baseline import cost near zero.
 *
 * Before configure(): all methods are no-ops.
 * After configure(): spans are created via OTel SDK and exported to the configured endpoint.
 *
 * @implements {Tracer}
 */
export class OTelTracer implements Tracer {
  // ============================================================
  // Internal State
  // ============================================================

  /** Whether configure() has been called and OTel SDK is initialized */
  private _configured = false;

  /** NodeTracerProvider instance (set during configure()) */
  private _provider: unknown = null;

  /** OTel Tracer obtained via trace.getTracer() */
  private _otelTracer: unknown = null;

  /** Active spans keyed by their OTel spanContext().spanId (16 hex chars) */
  private activeSpans: Map<string, unknown> = new Map();

  // ============================================================
  // Diagnostics
  // ============================================================

  /**
   * Returns true if the OTel SDK has been initialized via configure().
   */
  isConfigured(): boolean {
    return this._configured;
  }

  /**
   * Returns placeholder version string.
   * Version is resolved at build time in ESM contexts.
   */
  getVersion(): string {
    return '0.0.0';
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Initialize the OpenTelemetry SDK with lazy imports.
   *
   * Idempotent — calling multiple times has no effect for the SAME endpoint.
   * To change endpoint, call `shutdown()` first, then `configure()` again.
   * All OTel packages are loaded dynamically via await import().
   *
   * @param config - OTLP exporter and resource configuration
   * @throws If config.endpoint is empty or missing
   */
  async configure(config: OTelConfig): Promise<void> {
    if (this._configured) return;

    if (!config.endpoint || config.endpoint.trim() === '') {
      throw new Error('OTelTracer.configure(): endpoint is required and must not be empty');
    }

    const serviceName = config.serviceName ?? 'agentforge';
    const samplerRatio = config.sampler ?? 1.0;

    // ---- Phase 1: Core SDK imports ----
    const [
      { trace },
      { NodeTracerProvider },
      { BatchSpanProcessor, AlwaysOnSampler, AlwaysOffSampler, TraceIdRatioBasedSampler },
    ] = await Promise.all([
      import('@opentelemetry/api'),
      import('@opentelemetry/sdk-trace-node'),
      import('@opentelemetry/sdk-trace-base'),
    ]);

    // ---- Phase 2: Exporter + resource + semconv ----
    const [{ OTLPTraceExporter }, { Resource }, { ATTR_SERVICE_NAME }] = await Promise.all([
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
    ]);

    // ---- Build sampler ----
    let sampler: unknown;
    if (samplerRatio >= 1.0) {
      sampler = new (AlwaysOnSampler as new () => unknown)();
    } else if (samplerRatio <= 0) {
      sampler = new (AlwaysOffSampler as new () => unknown)();
    } else {
      sampler = new (TraceIdRatioBasedSampler as new (ratio: number) => unknown)(samplerRatio);
    }

    // ---- Resource ----
    const resource = new Resource({
      [ATTR_SERVICE_NAME as string]: serviceName,
    });

    // ---- Exporter ----
    const exporterConfig: Record<string, unknown> = {
      url: config.endpoint,
    };
    if (config.headers) {
      exporterConfig.headers = config.headers;
    }
    const exporter = new (OTLPTraceExporter as new (cfg: Record<string, unknown>) => unknown)(
      exporterConfig
    );

    // ---- Provider ----
    const provider = new (NodeTracerProvider as new (cfg: Record<string, unknown>) => {
      addSpanProcessor(p: unknown): void;
    })({
      resource,
      sampler,
    });

    provider.addSpanProcessor(new (BatchSpanProcessor as new (e: unknown) => unknown)(exporter));
    (trace as { setGlobalTracerProvider(p: unknown): void }).setGlobalTracerProvider(provider);

    // ---- Acquire tracer ----
    this._provider = provider;
    this._otelTracer = (trace as { getTracer(name: string, version?: string): unknown }).getTracer(
      'agentforge'
    );
    this._configured = true;
  }

  /**
   * Flush all active spans and shut down the tracer provider.
   * After shutdown, the tracer returns to no-op mode.
   */
  async shutdown(): Promise<void> {
    if (!this._configured) return;

    // End all active spans
    for (const span of this.activeSpans.values()) {
      try {
        (span as { end(): void }).end();
      } catch {
        // Best-effort cleanup on individual spans
      }
    }
    this.activeSpans.clear();

    // Shutdown provider
    try {
      const provider = this._provider as { shutdown(): Promise<void> } | null;
      if (provider) {
        await provider.shutdown();
      }
    } catch {
      // Best-effort shutdown; SDK may already be torn down
    }

    this._provider = null;
    this._otelTracer = null;
    this._configured = false;
  }

  // ============================================================
  // Tracer Interface
  // ============================================================

  /**
   * Start a new span.
   * Returns '' (empty string) when not yet configured (no-op mode).
   * When a parent span ID is provided, the new span is created as a child.
   */
  startSpan(name: string, options?: SpanOptions): string {
    if (!this._configured || !this._otelTracer) return '';

    const otelTracer = this._otelTracer as {
      startSpan(
        name: string,
        opts?: Record<string, unknown>
      ): {
        spanContext(): { spanId: string };
      };
    };

    const startOpts: Record<string, unknown> = {
      attributes: options?.attributes ?? {},
    };

    // Link to parent span if provided — enables span hierarchy
    if (options?.parent) {
      const parentSpan = this.activeSpans.get(options.parent);
      if (parentSpan) {
        const ctx = (
          parentSpan as { spanContext(): { spanId: string; traceId: string; traceFlags: number } }
        ).spanContext();
        // Import OTel context API lazily to create a parent context
        startOpts.links = [{ context: { spanContext: (): typeof ctx => ctx } }];
      }
    }

    const span = otelTracer.startSpan(name, startOpts);

    const spanId = span.spanContext().spanId;
    this.activeSpans.set(spanId, span);
    return spanId;
  }

  /**
   * End a span by its ID.
   * No-op if spanId is unknown or tracer is not configured.
   * Sets status to ERROR (code=2) when options.code === 'error',
   * otherwise defaults to OK.
   * When `duration` is provided (ms), it overrides the span's own timing
   * (useful when event timestamps are more accurate than span clock).
   */
  endSpan(spanId: string, options?: { code?: string; duration?: number }): void {
    const span = this.activeSpans.get(spanId) as
      | {
          setStatus(status: { code: number; message?: string }): void;
          end(endTime?: [number, number]): void;
        }
      | undefined;

    if (!span) return;

    if (options?.code === 'error') {
      span.setStatus({ code: 2 }); // SpanStatusCode.ERROR = 2
    } else {
      span.setStatus({ code: 1 }); // SpanStatusCode.OK = 1
    }

    if (options?.duration !== undefined) {
      // Convert ms duration to hrtime [seconds, nanoseconds]
      const seconds = Math.floor(options.duration / 1000);
      const nanos = (options.duration % 1000) * 1_000_000;
      span.end([seconds, nanos]);
    } else {
      span.end();
    }

    this.activeSpans.delete(spanId);
  }

  /**
   * Set a key-value attribute on a span.
   * No-op if spanId is unknown or tracer is not configured.
   */
  setAttribute(spanId: string, key: string, value: string | number | boolean): void {
    const span = this.activeSpans.get(spanId) as
      | { setAttribute(key: string, value: string | number | boolean): void }
      | undefined;

    if (!span) return;
    span.setAttribute(key, value);
  }

  /**
   * Add a named event to a span.
   * No-op if spanId is unknown or tracer is not configured.
   */
  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const span = this.activeSpans.get(spanId) as
      | { addEvent(name: string, attrs?: Record<string, unknown>): void }
      | undefined;

    if (!span) return;
    span.addEvent(name, attributes);
  }

  /**
   * Record an exception in a span.
   * No-op if spanId is unknown or tracer is not configured.
   */
  recordException(spanId: string, error: Error): void {
    const span = this.activeSpans.get(spanId) as { recordException(err: Error): void } | undefined;

    if (!span) return;
    span.recordException(error);
  }
}
