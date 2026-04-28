/**
 * Console tracer for production agent (M8).
 *
 * Provides distributed tracing for agent operations.
 */

export interface TraceSpan {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
}

export class ConsoleTracer {
  private spans: TraceSpan[] = [];

  startSpan(name: string, attributes: Record<string, unknown> = {}): TraceSpan {
    const span: TraceSpan = {
      id: `span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      startTime: Date.now(),
      attributes,
    };
    this.spans.push(span);
    return span;
  }

  endSpan(span: TraceSpan): void {
    span.endTime = Date.now();
    const duration = span.endTime - span.startTime;
    console.log(`[TRACE] ${span.name} (${duration}ms)`, span.attributes);
  }

  getSpans(): TraceSpan[] {
    return [...this.spans];
  }

  clear(): void {
    this.spans = [];
  }
}

export const tracer = new ConsoleTracer();