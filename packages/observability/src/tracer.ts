import type { Metrics, Span, SpanContext, Tracer } from '@primo-ai/sdk';
import { generateHex32, generateHex16, extractTraceContext, injectTraceContext } from './w3c-trace-context.js';

// ── Types ──────────────────────────────────────────────────────

export interface SpanData {
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  ended: boolean;
  startTime: number;
  endTime: number;
  durationMs: number;
}

export type OnSpanEndCallback = (span: SpanData) => void;

export interface TracerOptions {
  generateHexIds?: boolean;
  sampled?: boolean;
  traceId?: string;
}

type SpanIdGenerator = () => string;

// ── SpanImpl ───────────────────────────────────────────────────

export class SpanImpl implements Span {
  readonly name: string;
  private readonly _traceId: string;
  private readonly _spanId: string;
  private readonly _parentSpanId?: string;
  private readonly _onSpanEnd?: OnSpanEndCallback;
  private readonly _childIdGen: SpanIdGenerator;
  private _ended = false;
  private _attributes: Record<string, unknown> = {};
  private _events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
  private readonly _startTime: number;

  constructor(
    name: string,
    traceId: string,
    spanId: string,
    parentSpanId?: string,
    onSpanEnd?: OnSpanEndCallback,
    childIdGen?: SpanIdGenerator,
  ) {
    this.name = name;
    this._traceId = traceId;
    this._spanId = spanId;
    this._parentSpanId = parentSpanId;
    this._onSpanEnd = onSpanEnd;
    this._childIdGen = childIdGen ?? (() => crypto.randomUUID());
    this._startTime = Date.now();
  }

  startChild(name: string): Span {
    return new SpanImpl(name, this._traceId, this._childIdGen(), this._spanId, this._onSpanEnd, this._childIdGen);
  }

  end(): void {
    this._ended = true;
    this._onSpanEnd?.(this.toData());
  }

  get startTime(): number {
    return this._startTime;
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
    const endTime = this._ended ? Date.now() : this._startTime;
    return {
      name: this.name,
      spanId: this._spanId,
      traceId: this._traceId,
      parentSpanId: this._parentSpanId,
      attributes: { ...this._attributes },
      events: [...this._events],
      ended: this._ended,
      startTime: this._startTime,
      endTime,
      durationMs: endTime - this._startTime,
    };
  }
}

// ── TracerImpl ─────────────────────────────────────────────────

export class TracerImpl implements Tracer {
  private readonly _traceId: string;
  private readonly _generateHexIds: boolean;
  private readonly _sampled: boolean;
  private readonly _onSpanEnd?: OnSpanEndCallback;
  private readonly _childIdGen: SpanIdGenerator;
  private _currentSpan: Span | undefined;

  constructor(onSpanEnd?: OnSpanEndCallback, options?: TracerOptions) {
    this._onSpanEnd = onSpanEnd;
    this._generateHexIds = options?.generateHexIds ?? false;
    this._sampled = options?.sampled ?? true;
    this._traceId = options?.traceId ?? (this._generateHexIds ? generateHex32() : crypto.randomUUID());
    this._childIdGen = this._generateHexIds ? () => generateHex16() : () => crypto.randomUUID();
  }

  startSpan(name: string, parentContext?: SpanContext): Span {
    const traceId = parentContext?.traceId ?? this._traceId;
    const spanId = this._childIdGen();
    const parentSpanId = parentContext?.spanId;
    return new SpanImpl(name, traceId, spanId, parentSpanId, this._onSpanEnd, this._childIdGen);
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

  // ── W3C traceparent propagation ──────────────────────────────

  extract(headers: Record<string, string>): SpanContext | undefined {
    return extractTraceContext(headers) as SpanContext | undefined;
  }

  inject(span: Span, headers: Record<string, string>): void {
    injectTraceContext(span, headers, this._sampled);
  }
}

export class NoOpMetrics implements Metrics {
  increment(_name: string, _delta?: number, _labels?: Record<string, string>): void {}
  gauge(_name: string, _value: number, _labels?: Record<string, string>): void {}
  histogram(_name: string, _value: number, _labels?: Record<string, string>): void {}
}
