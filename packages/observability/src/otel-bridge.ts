import type { Span, SpanContext, Tracer } from '@primo-ai/sdk';
import type { Span as OTelSpanType, Tracer as OTelTracerType, Context, SpanContext as OTelSpanContext } from '@opentelemetry/api';
import { context, trace, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { NoOpSpan } from './noop.js';

// W3C traceparent: version-traceId-spanId-flags
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/;

export interface EventBusLike {
  emit(eventType: string, data?: unknown): void;
}

export interface OTelBridgeOptions {
  tracerProvider?: { getTracer(name: string, version?: string): OTelTracerType };
  tracerName?: string;
  eventBus?: EventBusLike;
}

class OTelAdapterSpan implements Span {
  readonly name: string;
  private readonly otelSpan: OTelSpanType;
  private readonly otelTracer: OTelTracerType;
  private readonly otelContext: Context;
  private readonly eventBus?: EventBusLike;

  constructor(
    name: string,
    otelSpan: OTelSpanType,
    otelTracer: OTelTracerType,
    otelContext: Context,
    eventBus?: EventBusLike,
  ) {
    this.name = name;
    this.otelSpan = otelSpan;
    this.otelTracer = otelTracer;
    this.otelContext = otelContext;
    this.eventBus = eventBus;
  }

  startChild(childName: string): Span {
    const childCtx = trace.setSpan(this.otelContext, this.otelSpan);
    const childSpan = this.otelTracer.startSpan(childName, undefined, childCtx);
    return new OTelAdapterSpan(childName, childSpan, this.otelTracer, childCtx, this.eventBus);
  }

  end(): void {
    this.otelSpan.end();
    if (this.eventBus) {
      const ctx = this.otelSpan.spanContext();
      this.eventBus.emit('span.end', {
        name: this.name,
        spanContext: { traceId: ctx.traceId, spanId: ctx.spanId },
      });
    }
  }

  setAttribute(key: string, value: unknown): Span {
    this.otelSpan.setAttribute(key, value as Parameters<OTelSpanType['setAttribute']>[1]);
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): Span {
    this.otelSpan.addEvent(name, attributes as Parameters<OTelSpanType['addEvent']>[1]);
    return this;
  }

  spanContext(): SpanContext {
    const ctx = this.otelSpan.spanContext();
    return { spanId: ctx.spanId, traceId: ctx.traceId };
  }
}

export class OTelBridge implements Tracer {
  private readonly otelTracer: OTelTracerType | undefined;
  private readonly eventBus?: EventBusLike;

  constructor(options?: OTelBridgeOptions) {
    this.otelTracer = options?.tracerProvider?.getTracer(
      options?.tracerName ?? '@primo-ai/observability',
    );
    this.eventBus = options?.eventBus;
  }

  startSpan(name: string, parentContext?: SpanContext): Span {
    if (!this.otelTracer) return new NoOpSpan(name);

    let parentCtx: Context = context.active();
    if (parentContext) {
      const otelCtx: OTelSpanContext = {
        traceId: parentContext.traceId,
        spanId: parentContext.spanId,
        traceFlags: 1, // sampled
        isRemote: true,
      };
      parentCtx = trace.setSpanContext(parentCtx, otelCtx);
    }

    const otelSpan = this.otelTracer.startSpan(name, undefined, parentCtx);
    return new OTelAdapterSpan(name, otelSpan, this.otelTracer, parentCtx, this.eventBus);
  }

  getCurrentSpan(): Span | undefined {
    return undefined;
  }

  // ── W3C traceparent propagation ──────────────────────────────

  /**
   * Extract SpanContext from W3C traceparent (and optional tracestate) headers.
   * Returns undefined if traceparent is missing or malformed.
   */
  extractTraceContext(headers: Record<string, string>): SpanContext | undefined {
    const tp = headers.traceparent;
    if (!tp) return undefined;
    const m = TRACEPARENT_RE.exec(tp);
    if (!m) return undefined;
    const ctx: SpanContext = { traceId: m[1]!, spanId: m[2]! };
    const tracestate = headers.tracestate;
    if (tracestate) {
      (ctx as unknown as Record<string, unknown>).tracestate = tracestate;
    }
    return ctx;
  }

  /**
   * Inject W3C traceparent header from a span into outgoing headers.
   */
  injectTraceContext(span: Span, headers: Record<string, string>): void {
    const ctx = span.spanContext();
    headers.traceparent = `00-${ctx.traceId}-${ctx.spanId}-01`;
  }
}
