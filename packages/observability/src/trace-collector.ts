import type { Span, Tracer } from '@agentforge/sdk';
import { SpanImpl, type SpanData, type OnSpanEndCallback } from './tracer.js';

export interface TraceNode {
  span: SpanData;
  children: TraceNode[];
}

export interface Trace {
  traceId: string;
  durationMs: number;
  spans: SpanData[];
  root?: TraceNode;
}

class CollectorSpan extends SpanImpl {
  private readonly collector: TraceCollector;

  constructor(
    collector: TraceCollector,
    name: string,
    traceId: string,
    spanId: string,
    parentSpanId?: string,
  ) {
    super(name, traceId, spanId, parentSpanId, (data) => collector.onSpanEnd(data));
    this.collector = collector;
  }

  startChild(name: string): Span {
    const child = new CollectorSpan(
      this.collector,
      name,
      this.spanContext().traceId,
      crypto.randomUUID(),
      this.spanContext().spanId,
    );
    return child;
  }
}

export class TraceCollector {
  private _endedSpans: SpanData[] = [];
  private _traceId = crypto.randomUUID();

  createTracer(): Tracer {
    const collector = this;
    const traceId = this._traceId;
    return {
      startSpan(name: string): Span {
        return new CollectorSpan(collector, name, traceId, crypto.randomUUID());
      },
      getCurrentSpan(): Span | undefined {
        return undefined;
      },
    };
  }

  getTrace(): Trace {
    const ended = this._endedSpans;
    const root = this.buildTree(ended);
    return {
      traceId: this._traceId,
      durationMs: root?.span.durationMs ?? 0,
      spans: ended,
      root,
    };
  }

  clear(): void {
    this._endedSpans = [];
    this._traceId = crypto.randomUUID();
  }

  flush(): Trace {
    const trace = this.getTrace();
    this.clear();
    return trace;
  }

  /** Arrow field so CollectorSpan can reference it via closure without private-access issues. */
  onSpanEnd = (data: SpanData): void => {
    if (!data.ended) return;
    this._endedSpans.push(data);
  };

  private buildTree(spans: SpanData[]): TraceNode | undefined {
    if (spans.length === 0) return undefined;

    const byId = new Map<string, TraceNode>();
    for (const span of spans) {
      byId.set(span.spanId, { span, children: [] });
    }

    let root: TraceNode | undefined;
    for (const node of byId.values()) {
      if (node.span.parentSpanId) {
        const parent = byId.get(node.span.parentSpanId);
        parent?.children.push(node);
      } else {
        root = node;
      }
    }

    return root;
  }
}

export function formatTraceJson(trace: Trace): string {
  if (!trace.root) return 'null';
  return JSON.stringify(trace, null, 2);
}

export function formatTraceConsole(trace: Trace): string {
  if (!trace.root) return '(no trace)';

  const lines: string[] = [];
  renderNode(trace.root, 0, lines);
  return lines.join('\n');
}

function renderNode(node: TraceNode, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  const attrs = Object.entries(node.span.attributes);
  const attrStr = attrs.length > 0
    ? ' ' + attrs.map(([k, v]) => `${k}=${v}`).join(' ')
    : '';
  lines.push(`${indent}${node.span.name} ${node.span.durationMs}ms${attrStr}`);
  for (const child of node.children) {
    renderNode(child, depth + 1, lines);
  }
}

// ---------------------------------------------------------------------------
// OTLP export
// ---------------------------------------------------------------------------

export interface OtlpOptions {
  serviceName?: string;
}

function toHex16(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 16).toLowerCase();
}

function toHex32(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

function msToNano(ms: number): string {
  return String(BigInt(ms) * 1_000_000n);
}

function toOtlpAttributes(attrs: Record<string, unknown>): any[] {
  return Object.entries(attrs).map(([key, value]) => {
    if (typeof value === 'string') return { key, value: { stringValue: value } };
    if (typeof value === 'number') return { key, value: { intValue: String(value) } };
    if (typeof value === 'boolean') return { key, value: { boolValue: value } };
    return { key, value: { stringValue: String(value) } };
  });
}

export function formatTraceOtlp(trace: Trace, options?: OtlpOptions): string {
  if (!trace.root) {
    return JSON.stringify({ resourceSpans: [] });
  }

  const serviceName = options?.serviceName ?? 'agentforge';

  const otlpSpans = trace.spans.map((span) => {
    const otlpSpan: Record<string, unknown> = {
      traceId: toHex32(span.traceId),
      spanId: toHex16(span.spanId),
      name: span.name,
      kind: 1,
      startTimeUnixNano: msToNano(span.startTime),
      endTimeUnixNano: msToNano(span.endTime),
      attributes: toOtlpAttributes(span.attributes),
      status: {},
    };
    if (span.parentSpanId) {
      otlpSpan.parentSpanId = toHex16(span.parentSpanId);
    }
    if (span.events.length > 0) {
      otlpSpan.events = span.events.map((ev) => ({
        name: ev.name,
        timeUnixNano: msToNano(span.startTime),
        attributes: ev.attributes ? toOtlpAttributes(ev.attributes) : [],
      }));
    }
    return otlpSpan;
  });

  return JSON.stringify({
    resourceSpans: [{
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
      },
      scopeSpans: [{
        scope: { name: '@agentforge/observability' },
        spans: otlpSpans,
      }],
    }],
  });
}
