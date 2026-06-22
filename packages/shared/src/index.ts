import type { AgentMessage, AgentEvent } from "@earendil-works/pi-agent-core";

/**
 * Session entry — 树形会话持久化的节点。见 ARCHITECTURE.md §4.1。
 * parentId 为 null 表示根；支持 fork/branch（moveTo 时写 branch_summary）。
 */
export interface SessionEntryBase {
  entryId: string;
  parentId: string | null;
  timestamp: number;
}

export interface MessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
}

export interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  summary: string;
}

export interface CustomEntry extends SessionEntryBase {
  type: "custom";
  kind: string; // "instinct" | "adr" | "audit" | ... 后续 slice 扩展
  data: unknown;
}

export type SessionEntry =
  | MessageEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry;

/** 序列化为 JSONL 行（不含换行）。 */
export function serializeEntry(entry: SessionEntry): string {
  return JSON.stringify(entry);
}

/** 从 JSON 字符串反序列化。无效 JSON 抛 SyntaxError。 */
export function deserializeEntry(json: string): SessionEntry {
  return JSON.parse(json) as SessionEntry;
}

/**
 * Harness 事件总线事件类型。见 ARCHITECTURE.md §4.5。
 * = pi Agent 事件（agent_start、turn 系列、tool_execution 系列、message 系列）+ harness 自定义事件。
 * pi Agent 事件由 Agent.subscribe 产出，harness EventBus 在其上叠加自定义事件。
 */
export interface CompactionEvent {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
}

export interface InstinctObservedEvent {
  type: "instinct_observed";
  observation: unknown;
}

export interface AuditFindingEvent {
  type: "audit_finding";
  severity: "critical" | "high" | "medium" | "low";
  finding: unknown;
}

export interface AdrRecordedEvent {
  type: "adr_recorded";
  adrId: string;
}

/**
 * ContextBudget 诊断事件（issue #12）。harness.prompt 每 turn 完成、maybeCompact 之后，
 * 若注入了 modelContextWindow 则调 context-budget.audit，当有 suggestions 或 headroom
 * 不足时 emit 此事件。诊断性，不阻塞主流程。
 */
export interface ContextBudgetEvent {
  type: "context_budget";
  /** 各组件 token 估算。 */
  components: {
    systemPrompt: number;
    skills: number;
    tools: number;
    history: number;
    memory?: number;
  };
  /** 总 token 数。 */
  total: number;
  /** 优化建议（无超阈值时为空数组）。 */
  suggestions: Array<{
    component: "systemPrompt" | "skills" | "tools" | "history";
    action: string;
    reason: string;
  }>;
  /** 剩余空间：max(0, modelContextWindow - total)。 */
  headroom: number;
}

export type HarnessCustomEvent =
  | CompactionEvent
  | InstinctObservedEvent
  | AuditFindingEvent
  | AdrRecordedEvent
  | ContextBudgetEvent;

export type HarnessEvent = AgentEvent | HarnessCustomEvent;
