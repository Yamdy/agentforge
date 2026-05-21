import type { Span, SpanContext, Tracer } from '@primo-ai/sdk';
import type { Span as OTelSpanType, Tracer as OTelTracerType, Context, SpanContext as OTelSpanContext } from '@opentelemetry/api';
import { context, trace } from '@opentelemetry/api';
import { NoOpSpan } from './noop.js';
import { extractTraceContext, injectTraceContext as injectW3C } from './w3c-trace-context.js';

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
  private readonly _traceFlags: number;

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
    this._traceFlags = otelSpan.spanContext().traceFlags;
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

  /** Read the sampling flag from the underlying OTel span context. */
  get isSampled(): boolean {
    return (this._traceFlags & 1) === 1;
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
        traceFlags: 1,
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
   * Delegates to the shared w3c-trace-context module.
   */
  extractTraceContext(headers: Record<string, string>): SpanContext | undefined {
    return extractTraceContext(headers) as SpanContext | undefined;
  }

  /**
   * Inject W3C traceparent header from a span into outgoing headers.
   * Reads the sampling flag from the underlying OTel span when available.
   */
  injectTraceContext(span: Span, headers: Record<string, string>): void {
    const sampled = span instanceof OTelAdapterSpan ? span.isSampled : true;
    injectW3C(span, headers, sampled);
  }
}
