import type { Metrics, Span, SpanContext, Tracer } from '@primo-ai/sdk';

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
  /** When true, generates W3C hex-format IDs (32-char traceId, 16-char spanId) instead of UUIDs. */
  generateHexIds?: boolean;
  /** Sets the sampled flag in traceparent. Default true. */
  sampled?: boolean;
  /** Explicit traceId for resuming an existing trace context. */
  traceId?: string;
}

// W3C traceparent: version-traceId-spanId-flags
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/;

function hex32(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hex16(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── SpanImpl ───────────────────────────────────────────────────

export class SpanImpl implements Span {
  readonly name: string;
  private readonly _traceId: string;
  private readonly _spanId: string;
  private readonly _parentSpanId?: string;
  private readonly _onSpanEnd?: OnSpanEndCallback;
  private _ended = false;
  private _attributes: Record<string, unknown> = {};
  private _events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
  private readonly _startTime: number;

  constructor(name: string, traceId: string, spanId: string, parentSpanId?: string, onSpanEnd?: OnSpanEndCallback) {
    this.name = name;
    this._traceId = traceId;
    this._spanId = spanId;
    this._parentSpanId = parentSpanId;
    this._onSpanEnd = onSpanEnd;
    this._startTime = Date.now();
  }

  startChild(name: string): Span {
    return new SpanImpl(name, this._traceId, crypto.randomUUID(), this._spanId, this._onSpanEnd);
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
  private _currentSpan: Span | undefined;

  constructor(onSpanEnd?: OnSpanEndCallback, options?: TracerOptions) {
    this._onSpanEnd = onSpanEnd;
    this._generateHexIds = options?.generateHexIds ?? false;
    this._sampled = options?.sampled ?? true;
    this._traceId = options?.traceId ?? (this._generateHexIds ? hex32() : crypto.randomUUID());
  }

  startSpan(name: string, parentContext?: SpanContext): Span {
    const traceId = parentContext?.traceId ?? this._traceId;
    const spanId = this._generateHexIds ? hex16() : crypto.randomUUID();
    const parentSpanId = parentContext?.spanId;
    return new SpanImpl(name, traceId, spanId, parentSpanId, this._onSpanEnd);
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

  /**
   * Extract SpanContext from W3C traceparent (and optional tracestate) headers.
   * Returns undefined if traceparent is missing or malformed.
   */
  extract(headers: Record<string, string>): SpanContext | undefined {
    const tp = headers.traceparent;
    if (!tp) return undefined;
    const m = TRACEPARENT_RE.exec(tp);
    if (!m) return undefined;
    const ctx: SpanContext = { traceId: m[1]!, spanId: m[2]! };
    if (headers.tracestate) {
      (ctx as unknown as Record<string, unknown>).tracestate = headers.tracestate;
    }
    return ctx;
  }

  /**
   * Inject W3C traceparent header from a span into outgoing headers.
   */
  inject(span: Span, headers: Record<string, string>): void {
    const ctx = span.spanContext();
    const flags = this._sampled ? '01' : '00';
    headers.traceparent = `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
  }
}

export class NoOpMetrics implements Metrics {
  increment(_name: string, _delta?: number, _labels?: Record<string, string>): void {}
  gauge(_name: string, _value: number, _labels?: Record<string, string>): void {}
  histogram(_name: string, _value: number, _labels?: Record<string, string>): void {}
}
