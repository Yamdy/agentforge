import type { Span } from '@primo-ai/sdk';
import type { SpanData, MetricsSnapshot } from '@primo-ai/observability';
import { TraceCollector, InMemoryMetrics } from '@primo-ai/observability';
import type { EventBus } from '@primo-ai/core';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpanNode {
  span: SpanData;
  children: SpanNode[];
}

export interface TraceSummary {
  id: string;
  agentName: string;
  status: string;
  duration: number;
  tokenTotal: number;
  costEstimated: number;
  startTime: number;
}

export interface TraceDetail extends TraceSummary {
  rootSpan: SpanNode;
  spans: SpanData[];
}

export interface KpiData {
  totalRuns: number;
  avgLatency: number;
  totalTokens: number;
  estimatedCost: number;
}

// ---------------------------------------------------------------------------
// Internal trace record
// ---------------------------------------------------------------------------

interface InternalTrace {
  id: string;
  agentName: string;
  status: 'running' | 'completed' | 'failed';
  startTime: number;
  duration?: number;
  tokenUsage?: { input: number; output: number };
  collector: TraceCollector;
  liveSpan: Span | undefined;
  spans: SpanData[];
  rootNode: SpanNode | undefined;
}

// ---------------------------------------------------------------------------
// StudioObservability
// ---------------------------------------------------------------------------

const COST_PER_1K_INPUT = 0.01;
const COST_PER_1K_OUTPUT = 0.03;

function computeCost(tokenUsage?: { input: number; output: number }): number {
  if (!tokenUsage) return 0;
  return (tokenUsage.input * COST_PER_1K_INPUT + tokenUsage.output * COST_PER_1K_OUTPUT) / 1000;
}

export class StudioObservability {
  private _traces = new Map<string, InternalTrace>();
  private _metrics = new InMemoryMetrics();
  private _attached = new WeakSet<EventBus>();

  // -------------------------------------------------------------------
  // attachAgent
  // -------------------------------------------------------------------

  attachAgent(agent: { eventBus: EventBus; name?: string }): () => void {
    const bus = agent.eventBus;

    if (this._attached.has(bus)) {
      return () => {};
    }
    this._attached.add(bus);

    const unsubStart = bus.subscribe('agent:start', (data) => {
      this._onAgentStart(agent, data);
    });
    const unsubEnd = bus.subscribe('agent:end', (data) => {
      this._onAgentEnd(data);
    });

    return () => {
      unsubStart();
      unsubEnd();
      this._attached.delete(bus);
    };
  }

  // -------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------

  getTraces(filter?: {
    agentName?: string;
    status?: string;
    since?: number;
    until?: number;
  }): TraceSummary[] {
    const result: TraceSummary[] = [];
    for (const t of this._traces.values()) {
      if (filter?.agentName !== undefined && t.agentName !== filter.agentName) continue;
      if (filter?.status !== undefined && t.status !== filter.status) continue;
      if (filter?.since !== undefined && t.startTime < filter.since) continue;
      if (filter?.until !== undefined && t.startTime > filter.until) continue;
      result.push(toSummary(t));
    }
    return result;
  }

  getTrace(id: string): TraceDetail | undefined {
    const t = this._traces.get(id);
    if (!t) return undefined;

    const running = t.status === 'running';
    return {
      id: t.id,
      agentName: t.agentName,
      status: t.status,
      duration: running ? (undefined as unknown as number) : (t.duration ?? 0),
      tokenTotal: running ? 0 : ((t.tokenUsage?.input ?? 0) + (t.tokenUsage?.output ?? 0)),
      costEstimated: running ? 0 : computeCost(t.tokenUsage),
      startTime: t.startTime,
      rootSpan: t.rootNode ?? emptyRootNode(t),
      spans: t.spans,
    };
  }

  getMetricsSnapshot(): MetricsSnapshot {
    return this._metrics.snapshot();
  }

  getKpi(period?: { since?: number; until?: number }): KpiData {
    const completed = filterCompleted(this._traces, period);

    const totalRuns = completed.length;
    const totalDuration = completed.reduce((sum, t) => sum + (t.duration ?? 0), 0);
    const avgLatency = totalRuns > 0 ? totalDuration / totalRuns : 0;

    let totalInput = 0;
    let totalOutput = 0;
    for (const t of completed) {
      totalInput += t.tokenUsage?.input ?? 0;
      totalOutput += t.tokenUsage?.output ?? 0;
    }

    return {
      totalRuns,
      avgLatency,
      totalTokens: totalInput + totalOutput,
      estimatedCost: computeCost({ input: totalInput, output: totalOutput }),
    };
  }

  // -------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------

  private _onAgentStart(agent: { name?: string }, data: unknown): void {
    const payload = data as Record<string, unknown> | null | undefined;
    if (!payload || typeof payload !== 'object') return;

    const sessionId = payload.sessionId as string | undefined;
    if (!sessionId || this._traces.has(sessionId)) return;

    const agentConfig = payload.agentConfig as Record<string, unknown> | undefined;
    const agentName = (agentConfig?.name as string) || agent.name || 'unknown';

    const collector = new TraceCollector();
    const tracer = collector.createTracer();
    const span = tracer.startSpan('agent.run');

    this._traces.set(sessionId, {
      id: sessionId,
      agentName,
      status: 'running',
      startTime: (payload.timestamp as number) ?? Date.now(),
      collector,
      liveSpan: span,
      spans: [],
      rootNode: undefined,
    });

    this._metrics.increment('runs.started');
    this._metrics.gauge('agents.active', this._countActive());
  }

  private _onAgentEnd(data: unknown): void {
    const payload = data as Record<string, unknown> | null | undefined;
    if (!payload || typeof payload !== 'object') return;

    const sessionId = payload.sessionId as string | undefined;
    if (!sessionId) return;

    const t = this._traces.get(sessionId);
    if (!t) return;

    t.liveSpan?.end();
    t.liveSpan = undefined;

    const flushed = t.collector.flush();

    t.status = payload.error ? 'failed' : 'completed';
    t.duration = (payload.duration as number) ?? flushed.durationMs;
    t.tokenUsage = payload.tokenUsage as InternalTrace['tokenUsage'] | undefined;
    t.spans = flushed.spans;
    t.rootNode = flushed.root as SpanNode | undefined;

    this._metrics.increment('runs.completed');
    this._metrics.histogram('latency', t.duration ?? 0);

    const input = t.tokenUsage?.input ?? 0;
    const output = t.tokenUsage?.output ?? 0;
    this._metrics.increment('tokens.input', input);
    this._metrics.increment('tokens.output', output);

    this._metrics.gauge('agents.active', this._countActive());
  }

  private _countActive(): number {
    let count = 0;
    for (const t of this._traces.values()) {
      if (t.status === 'running') count++;
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSummary(t: InternalTrace): TraceSummary {
  const input = t.tokenUsage?.input ?? 0;
  const output = t.tokenUsage?.output ?? 0;
  return {
    id: t.id,
    agentName: t.agentName,
    status: t.status,
    duration: t.status === 'running' ? 0 : (t.duration ?? 0),
    tokenTotal: input + output,
    costEstimated: computeCost(t.tokenUsage),
    startTime: t.startTime,
  };
}

function emptyRootNode(t: InternalTrace): SpanNode {
  return {
    span: {
      name: 'agent.run',
      spanId: '',
      traceId: '',
      attributes: {},
      events: [],
      ended: false,
      startTime: t.startTime,
      endTime: t.startTime,
      durationMs: 0,
    },
    children: [],
  };
}

function filterCompleted(
  traces: Map<string, InternalTrace>,
  period?: { since?: number; until?: number },
): InternalTrace[] {
  const result: InternalTrace[] = [];
  for (const t of traces.values()) {
    if (t.status !== 'completed') continue;
    if (period?.since !== undefined && t.startTime < period.since) continue;
    if (period?.until !== undefined && t.startTime > period.until) continue;
    result.push(t);
  }
  return result;
}
