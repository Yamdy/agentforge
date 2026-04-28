/**
 * AgentForge Decision Trace Storage
 *
 * Append-only storage for decision traceability.
 * Answers the core question: "Why did the agent do this?"
 *
 * @see docs/design/01-CORE-TYPES.md - Decision Trace System section
 */

// ============================================================
// Types
// ============================================================

/**
 * Decision trace record
 */
export interface DecisionTrace {
  /** Unique trace ID */
  id: string;
  /** Session ID */
  sessionId: string;
  /** Step number in agent loop */
  step: number;
  /** Timestamp */
  timestamp: number;

  /** Type of decision made */
  decisionType:
    | 'tool_selection'
    | 'tool_argument'
    | 'completion'
    | 'retry'
    | 'replan'
    | 'subagent_delegation';

  /** Decision context */
  context: {
    /** Inputs that influenced the decision */
    inputs: Record<string, unknown>;
    /** Available options (if applicable) */
    availableOptions?: unknown[] | undefined;
    /** Selected option */
    selected: unknown;
    /** Rationale for the selection */
    rationale?: string | undefined;
  };

  /** LLM reasoning (if available) */
  llmReasoning?:
    | {
        rawOutput?: string | undefined;
        thoughtProcess?: string | undefined;
        model?: string | undefined;
      }
    | undefined;

  /** Confidence score (0-1) */
  confidence?: number | undefined;

  /** Parent decision ID for hierarchical tracing */
  parentDecisionId?: string | undefined;
}

/**
 * Query filter for decision traces
 */
export interface DecisionTraceFilter {
  /** Filter by session ID */
  sessionId: string;
  /** Filter by step number */
  step?: number;
  /** Filter by decision type */
  decisionType?: DecisionTrace['decisionType'];
}

/**
 * Decision Trace Storage Interface
 *
 * Append-only storage for decision records.
 */
export interface DecisionTraceStorage {
  /** Append a decision record (Append-Only) */
  append(trace: DecisionTrace): Promise<void>;

  /** Query decision records */
  query(filter: DecisionTraceFilter): Promise<DecisionTrace[]>;

  /** Get decision chain (parent → children) */
  getChain(sessionId: string): Promise<DecisionTrace[]>;
}

// ============================================================
// In-Memory Implementation
// ============================================================

/**
 * In-memory implementation of DecisionTraceStorage
 *
 * Suitable for development and testing.
 * For production, use a persistent implementation.
 */
export class InMemoryDecisionTraceStorage implements DecisionTraceStorage {
  private traces: DecisionTrace[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await
  async append(trace: DecisionTrace): Promise<void> {
    this.traces.push(trace);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async query(filter: DecisionTraceFilter): Promise<DecisionTrace[]> {
    return this.traces.filter(trace => {
      if (trace.sessionId !== filter.sessionId) return false;
      if (filter.step !== undefined && trace.step !== filter.step) return false;
      if (filter.decisionType !== undefined && trace.decisionType !== filter.decisionType) {
        return false;
      }
      return true;
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getChain(sessionId: string): Promise<DecisionTrace[]> {
    const sessionTraces = this.traces.filter(t => t.sessionId === sessionId);

    // Build chain: start with root decisions (no parent)
    const roots = sessionTraces.filter(t => !t.parentDecisionId);
    const chain: DecisionTrace[] = [];

    const addChildren = (parentId: string): void => {
      const children = sessionTraces.filter(t => t.parentDecisionId === parentId);
      for (const child of children) {
        chain.push(child);
        addChildren(child.id);
      }
    };

    for (const root of roots) {
      chain.push(root);
      addChildren(root.id);
    }

    return chain;
  }

  /** Clear all traces (for testing) */
  clear(): void {
    this.traces = [];
  }

  /** Get trace count */
  get count(): number {
    return this.traces.length;
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Create a decision trace storage instance
 *
 * @param type - Storage type ('memory' for now, can be extended)
 * @returns DecisionTraceStorage instance
 */
export function createDecisionTraceStorage(type: 'memory' = 'memory'): DecisionTraceStorage {
  switch (type) {
    case 'memory':
      return new InMemoryDecisionTraceStorage();
    default:
      return new InMemoryDecisionTraceStorage();
  }
}

// ============================================================
// Helper: Create Decision Trace
// ============================================================

/**
 * Create a decision trace record with generated ID
 */
export function createDecisionTrace(
  params: Omit<DecisionTrace, 'id' | 'timestamp'>
): DecisionTrace {
  return {
    id: `dt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    ...params,
  };
}
