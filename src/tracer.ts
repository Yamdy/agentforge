import { v4 as uuidv4 } from 'uuid';
import { BehaviorSubject, Observable, filter, map, Subject } from 'rxjs';
import { LogService, LogEntry } from './logger/index.js';

export type SpanStatus = 'started' | 'completed' | 'failed' | 'cancelled';

export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  operationName: string;
  status: SpanStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tags: Record<string, string>;
  logs: { timestamp: Date; message: string; fields: Record<string, unknown> }[];
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  operationName: string;
}

// Create an empty span that will never be used in normal operation
const emptySpan: Span = {
  traceId: '',
  spanId: '',
  operationName: '',
  status: 'completed',
  startTime: new Date(0),
  tags: {},
  logs: [],
};

export class Tracer {
  private spans: Map<string, Span> = new Map();
  private spanSubject: BehaviorSubject<Span> = new BehaviorSubject<Span>(emptySpan);
  private activeSpans: Map<string, Span> = new Map();
  private logSubject: Subject<LogEntry> = new Subject<LogEntry>();
  private logger: LogService;

  constructor(serviceName: string = 'app') {
    this.logger = new LogService(serviceName);
    LogService.setLogSubject(this.logSubject);
  }

  startSpan(
    operationName: string,
    parentId?: string,
    tags: Record<string, string> = {}
  ): TraceContext {
    const traceId = parentId ? this.getActiveTraceId() || uuidv4() : uuidv4();
    const spanId = uuidv4();

    const span: Span = {
      traceId,
      spanId,
      parentId,
      operationName,
      status: 'started',
      startTime: new Date(),
      tags,
      logs: [],
    };

    this.spans.set(spanId, span);
    this.activeSpans.set(spanId, span);
    this.spanSubject.next(span);
    this.logger.info(`[TRACER] Span started: ${operationName}`, { traceId, spanId });

    return { traceId, spanId, operationName };
  }

  private getActiveTraceId(): string | undefined {
    // Get the most recently started active span
    const activeSpansArray = Array.from(this.activeSpans.values());
    // If no active spans, return undefined
    if (activeSpansArray.length === 0) return undefined;
    // Return the last active span's trace id (most recently started)
    return activeSpansArray[activeSpansArray.length - 1].traceId;
  }

  log(spanId: string, message: string, fields: Record<string, unknown> = {}): void {
    const span = this.spans.get(spanId);
    if (span) {
      span.logs.push({
        timestamp: new Date(),
        message,
        fields,
      });
      this.logger.debug(`[TRACER] ${span.operationName}: ${message}`, fields);
    }
  }

  setTag(spanId: string, key: string, value: string): void {
    const span = this.spans.get(spanId);
    if (span) {
      span.tags[key] = value;
    }
  }

  endSpan(spanId: string, status: SpanStatus = 'completed', error?: Error): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.endTime = new Date();
    span.duration = span.endTime.getTime() - span.startTime.getTime();
    span.status = status;

    this.activeSpans.delete(spanId);
    this.spanSubject.next(span);

    if (status === 'failed' && error) {
      this.logger.error(`[TRACER] Span failed: ${span.operationName}`, {
        traceId: span.traceId,
        spanId: span.spanId,
        error: error.message,
        duration: span.duration,
      });
    } else {
      this.logger.info(`[TRACER] Span ended: ${span.operationName}`, {
        traceId: span.traceId,
        spanId: span.spanId,
        status,
        duration: span.duration,
      });
    }
  }

  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }

  getAllSpans(): Span[] {
    return Array.from(this.spans.values());
  }

  observable(): Observable<Span> {
    return this.spanSubject.asObservable();
  }

  observableByTraceId(traceId: string): Observable<Span> {
    return this.spanSubject.pipe(
      filter((span) => span.traceId === traceId),
      map((span) => span)
    );
  }

  getTraceSummary(traceId: string): { spans: Span[]; totalDuration: number; failed: number } {
    const traceSpans = Array.from(this.spans.values()).filter((s) => s.traceId === traceId);
    let totalDuration = 0;
    if (traceSpans.length > 0) {
      totalDuration = Math.max(...traceSpans.map((s) => s.duration || 0));
    }
    const failed = traceSpans.filter((s) => s.status === 'failed').length;
    return { spans: traceSpans, totalDuration, failed };
  }

  clear(): void {
    this.spans.clear();
    this.activeSpans.clear();
    this.spanSubject.next(emptySpan);
  }
}

let globalTracer: Tracer | null = null;

export function getTracer(serviceName?: string): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer(serviceName);
  }
  return globalTracer;
}

export function setTracer(tracer: Tracer): void {
  globalTracer = tracer;
}

export const tracer = getTracer();
