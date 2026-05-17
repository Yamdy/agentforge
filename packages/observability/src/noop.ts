import type { Span, SpanContext, Tracer } from '@primo-ai/sdk';

export class NoOpSpan implements Span {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  startChild(name: string): Span {
    return new NoOpSpan(name);
  }

  end(): void {}

  setAttribute(_key: string, _value: unknown): Span {
    return this;
  }

  addEvent(_name: string, _attributes?: Record<string, unknown>): Span {
    return this;
  }

  spanContext(): SpanContext {
    return { spanId: '', traceId: '' };
  }
}

export class NoOpTracer implements Tracer {
  startSpan(name: string): Span {
    return new NoOpSpan(name);
  }

  getCurrentSpan(): Span | undefined {
    return undefined;
  }
}
