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

export interface StudioAgentDetail {
  id: string;
  name: string;
  model: string;
  state: string;
  toolCount: number;
  description: string;
}

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export interface SSEEvent {
  type: string;
  data: unknown;
}

export interface ConstitutionInfo {
  version: number;
  protectedPaths: Array<{ pattern: string; reason: string; level: string }>;
  diffLimits: Record<string, number>;
  approvalMatrix: Record<string, { description: string; mode: string }>;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  duration: number;
  errors?: string[];
  protectionLevel?: string;
}

export interface VerificationReportView {
  overall: 'passed' | 'failed';
  gates: GateResult[];
  timestamp: string;
  approvedBy: string;
}

export interface MutationBudgetStatus {
  state: {
    hourlyCount: number;
    dailyCount: number;
    hourlyResetAt: number;
    dailyResetAt: number;
    lastMutationAt: number;
  };
  config: {
    maxMutationsPerHour: number;
    maxMutationsPerDay: number;
    maxFilesPerMutation: number;
    maxDiffLinesPerMutation: number;
    cooldownMs: number;
  };
}

export interface ModificationRecord {
  id: string;
  riskLevel: string;
  accepted: boolean;
  reason?: string;
  timestamp: string;
  verificationReport?: VerificationReportView;
}
