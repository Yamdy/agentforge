import { createSpan } from './span.js';
import type { Span, SpanExporter, ObservabilityConfig } from './types.js';
import { ConsoleExporter } from './exporters/console.js';

class TracerImpl {
  private config: ObservabilityConfig;
  private exporter: SpanExporter;
  private activeSpans: Map<string, Span> = new Map();
  private spanBuffer: Span[] = [];
  private bufferSize: number = 10;
  private currentSpan?: Span;

  constructor(config: ObservabilityConfig) {
    this.config = config;
    this.exporter = config.exporter ?? new ConsoleExporter();
  }

  startSpan(
    name: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
    }
  ): Span {
    const span = createSpan(name, {
      traceId: this.currentSpan?.traceId,
      parentSpanId: this.currentSpan?.spanId,
      attributes: options?.attributes,
    });

    this.activeSpans.set(span.spanId, span);
    this.currentSpan = span;

    return span;
  }

  endSpan(span: Span): void {
    span.end();
    this.activeSpans.delete(span.spanId);
    this.spanBuffer.push(span);

    if (this.spanBuffer.length >= this.bufferSize) {
      this.flush();
    }

    if (span.parentSpanId) {
      this.currentSpan = this.activeSpans.get(span.parentSpanId);
    } else {
      this.currentSpan = undefined;
    }
  }

  async flush(): Promise<void> {
    if (this.spanBuffer.length === 0) return;

    const spansToExport = [...this.spanBuffer];
    this.spanBuffer = [];

    try {
      await this.exporter.export(spansToExport);
    } catch (error) {
      console.error('Failed to export spans:', error);
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
    await this.exporter.shutdown();
  }

  getCurrentSpan(): Span | undefined {
    return this.currentSpan;
  }
}

let globalTracer: TracerImpl | undefined;

export function setupObservability(config: ObservabilityConfig): void {
  globalTracer = new TracerImpl(config);
}

export function getTracer(): TracerImpl {
  if (!globalTracer) {
    globalTracer = new TracerImpl({});
  }
  return globalTracer;
}

export function setTracer(tracer: TracerImpl): void {
  globalTracer = tracer;
}

export const tracer = {
  startSpan: (
    name: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
    }
  ) => getTracer().startSpan(name, options),
  endSpan: (span: Span) => getTracer().endSpan(span),
  flush: () => getTracer().flush(),
  shutdown: () => getTracer().shutdown(),
  getCurrentSpan: () => getTracer().getCurrentSpan(),
};
