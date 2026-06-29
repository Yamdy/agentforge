/**
 * client reducer（纯函数）。pi 借鉴（spec §4.1.1/§5.3）：
 *  - message_update 整条替换 streaming（内核 message 已累积态，不拼 delta）
 *  - message_end 定稿 + 提取 usage + 记 stopReason；agent_end 兜底清 streaming（双保险）
 *  - error 终态清 busy（防 UI 锁死）
 */
export interface Usage { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; }
export interface BudgetInfo { components: unknown; total: number; suggestions: unknown[]; headroom: number; }
export interface AssistantMessage { role: string; content: Array<{ type?: string; text?: string }>; stopReason?: string; usage?: Usage; }
export interface RenderedMessage { role: string; text: string; stopReason?: string; }
export interface ToolEvent { toolName: string; args: unknown; isError: boolean; }
export interface State {
  messages: RenderedMessage[];
  streaming?: AssistantMessage;
  budget?: BudgetInfo;
  busy: boolean;
  error?: string;
  lastUsage?: Usage;
  tools: ToolEvent[];
}
export type ServerEvent =
  | { type: "agent_start" }
  | { type: "message_update"; message: AssistantMessage }
  | { type: "message_end"; message: AssistantMessage }
  | { type: "agent_end" }
  | { type: "error"; message: string }
  | { type: "context_budget"; components: unknown; total: number; suggestions: unknown[]; headroom: number }
  | { type: "tool_execution_end"; toolName: string; args: unknown; isError: boolean }
  | { type: "compaction"; summary: string }
  | { type: "audit_finding"; severity: string; finding: unknown }
  | { type: "resumed"; sessionId: string };

export function initState(): State {
  return { messages: [], busy: false, tools: [] };
}

export function reducer(state: State, event: ServerEvent): State {
  switch (event.type) {
    case "agent_start":
      return { ...state, busy: true, error: undefined };
    case "message_update":
      return { ...state, streaming: event.message }; // 整条替换（pi 借鉴，内核已累积）
    case "message_end": {
      const text = event.message?.content?.find((c) => c.type === "text")?.text ?? "";
      return {
        ...state,
        messages: [...state.messages, { role: event.message?.role ?? "assistant", text, stopReason: event.message?.stopReason }],
        streaming: undefined,
        lastUsage: event.message?.usage,
      };
    }
    case "agent_end":
      return { ...state, busy: false, streaming: undefined }; // 兜底清 streaming（双保险）
    case "error":
      return { ...state, busy: false, error: event.message }; // 终态：必须清 busy
    case "context_budget":
      return { ...state, budget: { components: event.components, total: event.total, suggestions: event.suggestions, headroom: event.headroom } };
    case "tool_execution_end":
      return { ...state, tools: [...state.tools, { toolName: event.toolName, args: event.args, isError: event.isError }] };
    default:
      return state;
  }
}
