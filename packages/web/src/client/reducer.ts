/**
 * client reducer（纯函数）。pi 借鉴（spec §4.1.1/§5.3）：
 *  - message_update 整条替换 streaming（内核 message 已累积态，不拼 delta）；仅 assistant 流式（防御性 narrow）
 *  - message_end 定稿 + 提取 usage + 记 stopReason；agent_end 兜底清 streaming（harness 转发，server 不再合成双发）
 *  - 非 user/assistant（toolResult/bashExecution/custom/...）走 default 不渲染（修 toolResult 空气泡 bug，pi emitToolResultMessage）
 *  - error 终态清 busy（防 UI 锁死）
 */
import type { AgentMessage, SerializedEvent } from "@agentforge/shared";

/** 从 pi AgentMessage 派生子类型（单一来源，消除本地副本漂移）。agentforge 不扩展 CustomAgentMessages，
 *  但 pi-agent-core 自扩展（bashExecution/custom/branchSummary/compactionSummary），故 AgentMessage 实为 7 成员 union。 */
export type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
export type UserMessage = Extract<AgentMessage, { role: "user" }>;
export type ToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
export type Usage = AssistantMessage["usage"];

export interface BudgetInfo { components: unknown; total: number; suggestions: unknown[]; headroom: number; }
export type RenderedMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; stopReason?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; text: ""; toolCallId: string; toolName: string; args: unknown;
      status: "done" | "error"; isError: boolean };
export interface ToolEvent { toolName: string; args: unknown; isError: boolean; }
export interface State {
  messages: RenderedMessage[];
  streaming?: AssistantMessage;
  budget?: BudgetInfo;
  busy: boolean;
  error?: string;
  lastUsage?: Usage;
  sessionId?: string;
  messageCount?: number;
}
/**
 * server 合成控制事件联合（synthesized，来源 server 非 harness）。
 * 见 CONTEXT.md：state/resumed/error 三者形状。
 */
export type ServerControlEvent =
  | { type: "state"; id?: string; sessionId: string; isStreaming: boolean; isCompacting: boolean; messageCount: number; pendingMessageCount: number }
  | { type: "resumed"; sessionId: string }
  | { type: "error"; message: string };

/**
 * client reducer 消费的 wire 事件联合 = forwarded(SerializedEvent, shared 单一来源) | synthesized(ServerControlEvent)。
 * 从 shared 派生，非手写：消除与 shared SerializedEvent 的平行漂移
 * （旧手写 compaction 无 firstKeptEntryId，现已随 shared 契约一致；reducer 走 default 不读，类型一致即消除漂移）。
 * 见 CONTEXT.md。
 */
export type ServerEvent = SerializedEvent | ServerControlEvent;

const isAssistant = (m: AgentMessage): m is AssistantMessage => m.role === "assistant";
const isUser = (m: AgentMessage): m is UserMessage => m.role === "user";

export function initState(): State {
  return { messages: [], busy: false };
}

export function reducer(state: State, event: ServerEvent): State {
  switch (event.type) {
    case "agent_start":
      return { ...state, busy: true, error: undefined };
    case "message_update":
      // 仅 assistant 流式累积（pi 语义）；非 assistant 不覆盖 streaming（防御）。
      return isAssistant(event.message) ? { ...state, streaming: event.message } : state;
    case "message_end": {
      const msg = event.message;
      if (isUser(msg)) {
        const text = typeof msg.content === "string" ? msg.content : msg.content.find((c) => c.type === "text")?.text ?? "";
        return { ...state, messages: [...state.messages, { role: "user", text }] };
      }
      if (!isAssistant(msg)) return state;  // toolResult/bashExecution/custom/branchSummary/compactionSummary → 不渲染
      const text = msg.content.find((c) => c.type === "text")?.text ?? "";
      const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
      const failError = (msg.stopReason === "error" || msg.errorMessage)
        ? (msg.errorMessage ?? "LLM error") : undefined;
      const messages: RenderedMessage[] = [...state.messages, { role: "assistant", text, stopReason: msg.stopReason, toolCalls }];
      // 终态：pending toolCall 标 error push（进 executed → derivePending 自清）。
      // message_end.message 含全部 toolCall（pi agent-loop finalMessage 在 executeToolCalls 前 emit，red-team 核实）。
      if (msg.stopReason === "aborted" || msg.stopReason === "error") {
        const pending = derivePending(messages, undefined);
        for (const p of pending) {
          messages.push({ role: "tool", text: "", toolCallId: p.toolCallId, toolName: p.toolName, args: p.args, status: "error", isError: true });
        }
      }
      return { ...state, messages, streaming: undefined, lastUsage: msg.usage, error: failError ?? state.error };
    }
    case "agent_end": {
      // 兜底：残留 pending push error（双保险，防 message_end 未清干净锁死）。
      const pending = derivePending(state.messages, state.streaming);
      const errorEntries = pending.map((p) => ({
        role: "tool" as const, text: "" as const, toolCallId: p.toolCallId, toolName: p.toolName,
        args: p.args, status: "error" as const, isError: true,
      }));
      return { ...state, busy: false, streaming: undefined, messages: [...state.messages, ...errorEntries] };
    }
    case "error": {
      // server 合成 error 兜底（harness.prompt throw 未走 message_end，spec §8）：
      // 同 agent_end——derivePending 取残留 pending（含 streaming toolCall）push error + 清 streaming。
      // red-team Failure mode：不加则 pending 静默丢失（UI 悬挂）。
      const pending = derivePending(state.messages, state.streaming);
      const errorEntries = pending.map((p) => ({
        role: "tool" as const, text: "" as const, toolCallId: p.toolCallId, toolName: p.toolName,
        args: p.args, status: "error" as const, isError: true,
      }));
      return { ...state, busy: false, streaming: undefined, error: event.message,
        messages: [...state.messages, ...errorEntries] };
    }
    case "context_budget":
      return { ...state, budget: { components: event.components, total: event.total, suggestions: event.suggestions, headroom: event.headroom } };
    case "tool_execution_end":
      return {
        ...state,
        messages: [...state.messages, {
          role: "tool", text: "", toolCallId: event.toolCallId, toolName: event.toolName,
          args: event.args, status: event.isError ? "error" : "done", isError: event.isError,
        }],
      };
    case "state":
      return { ...state, sessionId: event.sessionId, busy: event.isStreaming, messageCount: event.messageCount };
    default:
      return state;
  }
}

export interface PendingTool { toolCallId: string; toolName: string; args: unknown; }

/**
 * 推断 in-flight pending 工具调用（未匹配 tool_execution_end 的 toolCall block）。
 * 纯函数 derive，不存 State：tool 条目进 messages 即进 executed → pending 自清。
 * pi 借鉴：ToolCall.id === tool_execution_end.toolCallId。
 */
export function derivePending(messages: RenderedMessage[], streaming?: AssistantMessage): PendingTool[] {
  const executed = new Set(
    messages.filter((m): m is Extract<RenderedMessage, { role: "tool" }> => m.role === "tool")
      .map((m) => m.toolCallId)
  );
  const calls: PendingTool[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const tc of m.toolCalls) {
        if (!executed.has(tc.id) && !seen.has(tc.id)) {
          seen.add(tc.id);
          calls.push({ toolCallId: tc.id, toolName: tc.name, args: tc.arguments });
        }
      }
    }
  }
  if (streaming) {
    for (const b of streaming.content) {
      if (b.type === "toolCall" && !executed.has(b.id) && !seen.has(b.id)) {
        seen.add(b.id);
        calls.push({ toolCallId: b.id, toolName: b.name, args: b.arguments });
      }
    }
  }
  return calls;
}
