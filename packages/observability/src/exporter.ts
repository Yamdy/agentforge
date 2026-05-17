import type { Span, Tracer } from '@primo-ai/sdk';
import { SpanImpl, type SpanData } from './tracer.js';

class ExporterSpan extends SpanImpl {
  private readonly exporter: TestExporter;

  constructor(exporter: TestExporter, name: string, traceId: string, spanId: string, parentSpanId?: string) {
    super(name, traceId, spanId, parentSpanId);
    this.exporter = exporter;
  }

  startChild(name: string): Span {
    const child = new ExporterSpan(
      this.exporter,
      name,
      (this.spanContext().traceId),
      crypto.randomUUID(),
      this.spanContext().spanId,
    );
    this.exporter['spans'].push(child);
    return child;
  }
}

export class TestExporter {
  private spans: ExporterSpan[] = [];

  createTracer(): Tracer {
    const exporter = this;
    return {
      startSpan(name: string): Span {
        const traceId = crypto.randomUUID();
        const spanId = crypto.randomUUID();
        const span = new ExporterSpan(exporter, name, traceId, spanId);
        exporter.spans.push(span);
        return span;
      },
      getCurrentSpan(): Span | undefined {
        return undefined;
      },
    };
  }

  getSpans(): SpanData[] {
    return this.spans.map((s) => s.toData());
  }

  clear(): void {
    this.spans = [];
  }
}
