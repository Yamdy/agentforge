export interface TraceSummary {
  id: string;
  agentName: string;
  status: string;
  duration: number;
  tokenTotal: number;
  costEstimated: number;
  startTime: number;
}

export interface SpanNode {
  span: {
    name: string;
    spanId: string;
    traceId: string;
    startTime: number;
    durationMs: number;
    attributes: Record<string, unknown>;
    events: unknown[];
  };
  children: SpanNode[];
}

export interface TraceDetail extends TraceSummary {
  rootSpan: SpanNode;
  spans: unknown[];
}

export interface SessionSummary {
  id: string;
  agentName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  parentSessionId?: string;
}

export interface SessionDetail {
  id: string;
  agentName: string;
  status: string;
  meta: Record<string, unknown>;
  events: Array<{
    seq: number;
    timestamp: string;
    type: string;
    payload: unknown;
  }>;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, {
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
  }>;
}

export interface KpiData {
  totalRuns: number;
  avgLatency: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface AgentInfo {
  name: string;
  description: string;
  model: string;
  toolCount: number;
  lastRunAt: string | null;
}
