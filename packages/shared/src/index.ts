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

/** compaction 失败事件（Slice 2.5）：generateSummary/compact 抛非 abort 错时 emit，不阻塞主流程。 */
export interface CompactionErrorEvent {
  type: "compaction_error";
  error: string;
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
    /**
     * memory 组件预留字段（reserved for future slices, currently undefined）。
     * Slice 1 instinct/memory 未建，audit 不填此字段；后续 slice 填充。
     */
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

/** harness afterToolCall emit 的 tool 事件(带 args,区别于 pi 原生 tool_execution_end 无 args 字段)。
 *  Slice 4-B T10:argsSummary gap 修复——harness emit 带 args,instinct observe prefer-args 去重。 */
export interface HarnessToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  args: unknown; // AfterToolCallContext.args
  result: unknown;
  isError: boolean;
}

export type HarnessCustomEvent =
  | CompactionEvent
  | CompactionErrorEvent
  | InstinctObservedEvent
  | AuditFindingEvent
  | AdrRecordedEvent
  | ContextBudgetEvent
  | HarnessToolExecutionEndEvent;

export type HarnessEvent = AgentEvent | HarnessCustomEvent;

/**
 * HarnessEvent 经 serializeEvent 序列化后上 wire 的普通对象形态。
 * 是 wire 形状的单一来源（消除 web/rpc/reducer 三处手写平行）。
 *
 * message_update 与 tool_execution_end 各含两种形状（按 opts 开关），
 * 故 union 同时包含 args/无 args、message_update 在/不在 的所有可能返回对象。
 */
export type SerializedEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "message_update"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      isError: boolean;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      args: unknown;
      isError: boolean;
    }
  | {
      type: "context_budget";
      components: ContextBudgetEvent["components"];
      total: number;
      suggestions: ContextBudgetEvent["suggestions"];
      headroom: number;
    }
  | { type: "compaction"; summary: string; firstKeptEntryId: string }
  | { type: "compaction_error"; error: string }
  | {
      type: "audit_finding";
      severity: AuditFindingEvent["severity"];
      finding: unknown;
    };

/** serializeEvent 的 opts：控制 web/rpc 两 adapter 差异。两者默认 false。 */
export interface SerializeEventOpts {
  /** true → 转发 message_update（web）；false → 丢弃逐 token 流（rpc，默认）。 */
  includeMessageUpdate?: boolean;
  /** true → tool_execution_end 带 args（web）；false → 精简无 args（rpc，默认）。 */
  includeToolArgs?: boolean;
}

/**
 * 把 harness EventBus 事件序列化为 wire 上的普通对象。
 * 白名单：只推可序列化、客户端关心的事件。非白名单 → undefined（跳过）。
 *
 * 用 switch(event.type) discriminant 窄化 HarnessEvent 联合，零 `as` 重断言，
 * 字段直接 event.xxx 读取（编译期类型安全）。
 *
 * opts 控制两 adapter 差异：
 *  - includeMessageUpdate：web 转发 message_update / rpc 丢
 *  - includeToolArgs：web 带 args / rpc 丢
 * 两者默认 false（rpc 行为）。
 */
export function serializeEvent(
  event: HarnessEvent,
  opts?: SerializeEventOpts,
): SerializedEvent | undefined {
  const includeMessageUpdate = opts?.includeMessageUpdate ?? false;
  const includeToolArgs = opts?.includeToolArgs ?? false;
  switch (event.type) {
    case "agent_start":
      return { type: "agent_start" };
    case "agent_end":
      // agent_end 含 messages（大），只推 type；messages 在 prompt result 里给。
      return { type: "agent_end" };
    case "message_update":
      // 逐 token 流：默认丢弃（rpc），web 开 includeMessageUpdate 转发累积态 message。
      // 丢 assistantMessageEvent（token-stream 细节不上 wire）。
      if (!includeMessageUpdate) return undefined;
      return { type: "message_update", message: event.message };
    case "message_end":
      return { type: "message_end", message: event.message };
    case "tool_execution_end": {
      // result 大，默认不推全量；safety deny 时 isError=true 仍推。
      // args 默认不推（rpc 精简），web 开 includeToolArgs 推 args（harness afterToolCall 带 args）。
      //
      // 注意：HarnessEvent 联合在此 case 收窄为两成员的并集——pi 原生 tool_execution_end
      // （无 args）+ harness HarnessToolExecutionEndEvent（带 args）。二者共享 type 判别式，
      // 故 event.args 不在所有成员上存在。用 `"args" in event` 类型守卫（零 `as`）安全读 args：
      // harness emit 的事件必带 args，web includeToolArgs 路径才有意义。
      const base = {
        type: "tool_execution_end" as const,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
      };
      if (includeToolArgs && "args" in event) {
        return { ...base, args: event.args };
      }
      return base;
    }
    case "context_budget":
      return {
        type: "context_budget",
        components: event.components,
        total: event.total,
        suggestions: event.suggestions,
        headroom: event.headroom,
      };
    case "compaction":
      return {
        type: "compaction",
        summary: event.summary,
        firstKeptEntryId: event.firstKeptEntryId,
      };
    case "compaction_error":
      return { type: "compaction_error", error: event.error };
    case "audit_finding":
      return {
        type: "audit_finding",
        severity: event.severity,
        finding: event.finding,
      };
    default:
      // 非白名单（turn_*、message_start、tool_execution_start/update、
      // instinct_observed、adr_recorded、未知）→ undefined
      return undefined;
  }
}

/** pi AgentMessage 单一来源 re-export：供 web/reducer 派生子类型，消除本地副本漂移。 */
export type { AgentMessage } from "@earendil-works/pi-agent-core";
