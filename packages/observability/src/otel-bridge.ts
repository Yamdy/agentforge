import type { Span, SpanContext, Tracer } from '@agentforge/sdk';
import type { Span as OTelSpanType, Tracer as OTelTracerType, Context } from '@opentelemetry/api';
import { context, trace } from '@opentelemetry/api';
import { NoOpSpan } from './noop.js';

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
      options?.tracerName ?? '@agentforge/observability',
    );
    this.eventBus = options?.eventBus;
  }

  startSpan(name: string): Span {
    if (!this.otelTracer) return new NoOpSpan(name);
    const otelSpan = this.otelTracer.startSpan(name);
    return new OTelAdapterSpan(name, otelSpan, this.otelTracer, context.active(), this.eventBus);
  }

  getCurrentSpan(): Span | undefined {
    return undefined;
  }
}
