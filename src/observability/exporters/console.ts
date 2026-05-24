import type { Span, SpanExporter } from '../types.js';

export class ConsoleExporter implements SpanExporter {
  async export(spans: Span[]): Promise<void> {
    for (const span of spans) {
      console.log(`[Span] ${span.name} (${span.spanId})`);
      console.log(`  Trace ID: ${span.traceId}`);
      if (span.parentSpanId) {
        console.log(`  Parent Span ID: ${span.parentSpanId}`);
      }
      console.log(`  Status: ${span.status.code}`);
      if (span.status.message) {
        console.log(`  Status Message: ${span.status.message}`);
      }
      console.log(`  Start Time: ${span.startTime.toISOString()}`);
      if (span.endTime) {
        console.log(`  End Time: ${span.endTime.toISOString()}`);
        const duration = span.endTime.getTime() - span.startTime.getTime();
        console.log(`  Duration: ${duration}ms`);
      }
      if (Object.keys(span.attributes).length > 0) {
        console.log(`  Attributes:`);
        for (const [key, value] of Object.entries(span.attributes)) {
          console.log(`    ${key}: ${value}`);
        }
      }
      if (span.events.length > 0) {
        console.log(`  Events:`);
        for (const event of span.events) {
          console.log(`    ${event.time.toISOString()}: ${event.name}`);
          if (event.attributes) {
            for (const [key, value] of Object.entries(event.attributes)) {
              console.log(`      ${key}: ${value}`);
            }
          }
        }
      }
      console.log();
    }
  }

  async shutdown(): Promise<void> {
    // No-op for console exporter
  }
}
