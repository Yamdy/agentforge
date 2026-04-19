type StatusChangeListener = (from: AgentStatus, to: AgentStatus) => void;

export type AgentStatus =
  | "idle"
  | "running"
  | "waiting_tool"
  | "streaming"
  | "completed"
  | "error"
  | "stopped"
  | "aborted";

export interface StepStats {
  round: number;
  llmCalls: number;
  toolCalls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ProcessorContext {
  toolCallMap: Map<string, { name: string; parameters: Record<string, unknown> }>;
  shouldBreak: boolean;
  shouldStop: boolean;
  snapshot: string | undefined;
  isStreaming: boolean;
  currentToolCallId: string | undefined;
  stats: StepStats;
}

export const createInitialContext = (): ProcessorContext => ({
  toolCallMap: new Map(),
  shouldBreak: false,
  shouldStop: false,
  snapshot: undefined,
  isStreaming: false,
  currentToolCallId: undefined,
  stats: {
    round: 0,
    llmCalls: 0,
    toolCalls: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  },
});

export const createSnapshot = (ctx: ProcessorContext): string => {
  return JSON.stringify({
    toolCallMap: Array.from(ctx.toolCallMap.entries()),
    stats: ctx.stats,
    snapshot: ctx.snapshot,
  });
};

export const restoreSnapshot = (data: string): ProcessorContext => {
  const parsed = JSON.parse(data);
  return {
    toolCallMap: new Map(parsed.toolCallMap),
    shouldBreak: false,
    shouldStop: false,
    snapshot: parsed.snapshot,
    isStreaming: false,
    currentToolCallId: undefined,
    stats: parsed.stats,
  };
};

export class AgentState {
  private context: ProcessorContext;
  private statusChangeListeners: StatusChangeListener[] = [];

  constructor() {
    this.context = createInitialContext();
  }

  onStatusChange(listener: StatusChangeListener): void {
    this.statusChangeListeners.push(listener);
  }

  removeStatusChangeListener(listener: StatusChangeListener): void {
    const index = this.statusChangeListeners.indexOf(listener);
    if (index > -1) {
      this.statusChangeListeners.splice(index, 1);
    }
  }

  private notifyStatusChange(from: AgentStatus, to: AgentStatus): void {
    this.statusChangeListeners.forEach((listener) => {
      try {
        listener(from, to);
      } catch {
        // Ignore listener errors
      }
    });
  }

  getStatus(): AgentStatus {
    if (this.context.shouldStop) {
      return "stopped";
    }
    if (this.context.shouldBreak) {
      return "completed";
    }
    if (this.context.isStreaming) {
      return "streaming";
    }
    return "running";
  }

  getContext(): Readonly<ProcessorContext> {
    return this.context;
  }

  setStatus(newStatus: AgentStatus): void {
    const oldStatus = this.getStatus();
    if (oldStatus !== newStatus) {
      this.applyStatus(newStatus);
      this.notifyStatusChange(oldStatus, newStatus);
    }
  }

  private applyStatus(status: AgentStatus): void {
    switch (status) {
      case "stopped":
        this.context.shouldStop = true;
        break;
      case "completed":
        this.context.shouldBreak = true;
        break;
      case "streaming":
        this.context.isStreaming = true;
        break;
      case "idle":
        this.context.shouldBreak = false;
        this.context.shouldStop = false;
        this.context.isStreaming = false;
        break;
      case "error":
        this.context.shouldStop = true;
        break;
      case "running":
      case "waiting_tool":
      default:
        break;
    }
  }

  incrementRound(): void {
    this.context.stats.round++;
  }

  incrementLlmCalls(): void {
    this.context.stats.llmCalls++;
  }

  incrementToolCalls(count: number = 1): void {
    this.context.stats.toolCalls += count;
  }

  addTokens(input: number, output: number): void {
    this.context.stats.inputTokens += input;
    this.context.stats.outputTokens += output;
    this.context.stats.totalTokens += input + output;
  }

  addToolCall(id: string, name: string, parameters: Record<string, unknown>): void {
    this.context.toolCallMap.set(id, { name, parameters });
  }

  getToolCall(id: string) {
    return this.context.toolCallMap.get(id);
  }

  clearToolCalls(): void {
    this.context.toolCallMap.clear();
  }

  stop(): void {
    this.context.shouldStop = true;
  }

  break(): void {
    this.context.shouldBreak = true;
  }

  setStreaming(value: boolean): void {
    this.context.isStreaming = value;
  }

  setCurrentToolCall(id: string | undefined): void {
    this.context.currentToolCallId = id;
  }

  getStats(): Readonly<StepStats> {
    return { ...this.context.stats };
  }

  takeSnapshot(): string {
    return createSnapshot(this.context);
  }

  restore(data: string): void {
    this.context = restoreSnapshot(data);
  }

  reset(): void {
    this.context = createInitialContext();
  }
}