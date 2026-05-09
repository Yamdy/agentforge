import type { Span, SpanContext, Tracer } from '@agentforge/sdk';

export interface SpanData {
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  ended: boolean;
}

export class SpanImpl implements Span {
  readonly name: string;
  private readonly _traceId: string;
  private readonly _spanId: string;
  private readonly _parentSpanId?: string;
  private _ended = false;
  private _attributes: Record<string, unknown> = {};
  private _events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];

  constructor(name: string, traceId: string, spanId: string, parentSpanId?: string) {
    this.name = name;
    this._traceId = traceId;
    this._spanId = spanId;
    this._parentSpanId = parentSpanId;
  }

  startChild(name: string): Span {
    return new SpanImpl(name, this._traceId, crypto.randomUUID(), this._spanId);
  }

  end(): void {
    this._ended = true;
  }

  setAttribute(key: string, value: unknown): Span {
    this._attributes[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): Span {
    this._events.push({ name, attributes });
    return this;
  }

  spanContext(): SpanContext {
    return { spanId: this._spanId, traceId: this._traceId };
  }

  get parentSpanId(): string | undefined {
    return this._parentSpanId;
  }

  get ended(): boolean {
    return this._ended;
  }

  toData(): SpanData {
    return {
      name: this.name,
      spanId: this._spanId,
      traceId: this._traceId,
      parentSpanId: this._parentSpanId,
      attributes: { ...this._attributes },
      events: [...this._events],
      ended: this._ended,
    };
  }
}

export class TracerImpl implements Tracer {
  private _currentSpan: Span | undefined;

  startSpan(name: string): Span {
    const traceId = crypto.randomUUID();
    const spanId = crypto.randomUUID();
    return new SpanImpl(name, traceId, spanId);
  }

  getCurrentSpan(): Span | undefined {
    return this._currentSpan;
  }

  withSpan<T>(span: Span, fn: () => T): T {
    const previous = this._currentSpan;
    this._currentSpan = span;
    try {
      return fn();
    } finally {
      this._currentSpan = previous;
    }
  }
}
