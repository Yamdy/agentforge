import { v4 as uuidv4 } from 'uuid';
import type { Span, SpanEvent, SpanStatus } from './types.js';

class SpanImpl implements Span {
  public readonly spanId: string;
  public readonly traceId: string;
  public readonly parentSpanId?: string;
  public readonly name: string;
  public readonly startTime: Date;
  public endTime?: Date;
  public attributes: Record<string, string | number | boolean> = {};
  public status: SpanStatus = { code: 'UNSET' };
  public events: SpanEvent[] = [];

  private ended: boolean = false;

  constructor(
    name: string,
    traceId?: string,
    parentSpanId?: string,
    attributes?: Record<string, string | number | boolean>
  ) {
    this.name = name;
    this.spanId = uuidv4().slice(0, 16);
    this.traceId = traceId ?? uuidv4();
    this.parentSpanId = parentSpanId;
    this.startTime = new Date();
    if (attributes) {
      this.attributes = { ...attributes };
    }
  }

  end(status?: SpanStatus): void {
    if (this.ended) return;

    this.ended = true;
    this.endTime = new Date();
    if (status) {
      this.status = status;
    }
  }

  recordException(error: Error): void {
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack ?? '',
    });
    this.status = { code: 'ERROR', message: error.message };
  }

  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    this.events.push({
      name,
      time: new Date(),
      attributes: attributes ? { ...attributes } : undefined,
    });
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }
}

export function createSpan(
  name: string,
  options?: {
    traceId?: string;
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
  }
): Span {
  return new SpanImpl(name, options?.traceId, options?.parentSpanId, options?.attributes);
}
