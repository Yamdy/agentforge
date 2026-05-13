import type { Metrics, Span, SpanContext, Tracer } from '@agentforge/sdk';

export interface SpanData {
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  ended: boolean;
}

export type OnSpanEndCallback = (span: SpanData) => void;

export class SpanImpl implements Span {
  readonly name: string;
  private readonly _traceId: string;
  private readonly _spanId: string;
  private readonly _parentSpanId?: string;
  private readonly _onSpanEnd?: OnSpanEndCallback;
  private _ended = false;
  private _attributes: Record<string, unknown> = {};
  private _events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];

  constructor(name: string, traceId: string, spanId: string, parentSpanId?: string, onSpanEnd?: OnSpanEndCallback) {
    this.name = name;
    this._traceId = traceId;
    this._spanId = spanId;
    this._parentSpanId = parentSpanId;
    this._onSpanEnd = onSpanEnd;
  }

  startChild(name: string): Span {
    return new SpanImpl(name, this._traceId, crypto.randomUUID(), this._spanId, this._onSpanEnd);
  }

  end(): void {
    this._ended = true;
    this._onSpanEnd?.(this.toData());
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
  private readonly _traceId: string;
  private _currentSpan: Span | undefined;

  constructor() {
    this._traceId = crypto.randomUUID();
  }

  startSpan(name: string): Span {
    const spanId = crypto.randomUUID();
    return new SpanImpl(name, this._traceId, spanId);
  }

  get traceId(): string {
    return this._traceId;
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

export class NoOpMetrics implements Metrics {
  increment(_name: string): void {}
  gauge(_name: string, _value: number): void {}
  histogram(_name: string, _value: number): void {}
}
