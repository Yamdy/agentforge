import { describe, it, expect } from "vitest";
import type { SerializedEvent } from "@agentforge/shared";
import { reducer, initState, derivePending, type AssistantMessage, type UserMessage, type Usage, type RenderedMessage, type ServerEvent, type ServerControlEvent } from "./reducer.js";

type Api = AssistantMessage["api"];
type Provider = AssistantMessage["provider"];
const mkUsage = (o: Partial<Usage> = {}): Usage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, ...o,
});
const mkAssistant = (o: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: "assistant", content: [], api: "" as Api, provider: "" as Provider,
  model: "m", usage: mkUsage(), stopReason: "stop", timestamp: 0, ...o,
});
const mkUser = (o: Partial<UserMessage> = {}): UserMessage => ({ role: "user", content: [], timestamp: 0, ...o });

describe("reducer", () => {
  it("agent_start 设 busy", () => {
    expect(reducer(initState(), { type: "agent_start" }).busy).toBe(true);
  });
  it("providers 事件填充 state.providers + activeProvider", () => {
    const s = reducer(initState(), { type: "providers", providers: [
      { provider: "xiaomi-token-plan-cn", model: "mimo-v2.5-pro", apiKey: "tp-c…b4vf" },
      { provider: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-2…0f9a" },
    ], active: "xiaomi-token-plan-cn" });
    expect(s.providers).toHaveLength(2);
    expect(s.activeProvider).toBe("xiaomi-token-plan-cn");
  });
  it("providers 事件 active 可省（无 config 空列表）", () => {
    const s = reducer(initState(), { type: "providers", providers: [] });
    expect(s.providers).toEqual([]);
    expect(s.activeProvider).toBeUndefined();
  });
  it("message_update 整条替换 streaming（不拼 delta）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: mkAssistant({ content: [{ type: "text", text: "hel" }] }) });
    s = reducer(s, { type: "message_update", message: mkAssistant({ content: [{ type: "text", text: "hello" }] }) });
    expect((s.streaming as AssistantMessage).content[0].text).toBe("hello");
  });
  it("message_end 定稿 + 提取 usage + 清 streaming", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: mkAssistant({ content: [{ type: "text", text: "hi" }] }) });
    s = reducer(s, { type: "message_end", message: mkAssistant({ content: [{ type: "text", text: "hi" }], usage: mkUsage({ input: 10, output: 5 }) }) });
    expect(s.messages.length).toBe(1);
    expect(s.streaming).toBeUndefined();
    expect(s.lastUsage).toMatchObject({ input: 10, output: 5 });
  });
  it("message_end stopReason=aborted 记终态（用户主动中止，非失败，不设 state.error）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: mkAssistant({ content: [], stopReason: "aborted" }) });
    expect(s.messages[s.messages.length - 1].stopReason).toBe("aborted");
    expect(s.error).toBeUndefined();
  });
  it("message_end stopReason=error 设 state.error 显示失败信号（pi runWithLifecycle 不抛冒泡，靠 message_end 兜底）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: mkAssistant({ content: [{ type: "text", text: "" }], stopReason: "error", errorMessage: "boom" }) });
    expect(s.messages.length).toBe(1);
    expect(s.streaming).toBeUndefined();
    expect(s.error).toBe("boom");
  });
  it("message_end errorMessage 无 stopReason 也兜底设 state.error", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: mkAssistant({ content: [], errorMessage: "kaput" }) });
    expect(s.error).toBe("kaput");
  });
  it("agent_end 兜底不设 error（pi agent_end 不带 errorMessage 字段，仅 messages[].errorMessage；reducer agent_end 不接收 messages）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: mkAssistant({ content: [] }) });
    s = reducer(s, { type: "agent_end" });
    expect(s.busy).toBe(false);
    expect(s.streaming).toBeUndefined();
    expect(s.error).toBeUndefined();
  });
  it("message_end(user) 定稿 user 消息——server 是 user 消息唯一来源（spec §5.3，防 client 乐观 push 回归）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: mkUser({ content: [{ type: "text", text: "hi" }] }) });
    expect(s.messages.length).toBe(1);
    expect(s.messages[0].role).toBe("user");
    expect(s.messages[0].text).toBe("hi");
  });
  it("agent_end 清 busy + 兜底清 streaming", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: mkAssistant({ content: [] }) });
    s = reducer(s, { type: "agent_end" });
    expect(s.busy).toBe(false);
    expect(s.streaming).toBeUndefined();
  });
  it("error 清 busy 并存 message（防 UI 锁死）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "error", message: "boom" });
    expect(s.busy).toBe(false);
    expect(s.error).toBe("boom");
  });
  it("context_budget 更新 budget", () => {
    const s = reducer(initState(), { type: "context_budget", components: {}, total: 5000, suggestions: [], headroom: 60000 });
    expect(s.budget?.total).toBe(5000);
  });
  it("state 事件设显示 sessionId/busy/messageCount（不动 main.ts resume 控制）", () => {
    const s = reducer(initState(), {
      type: "state", sessionId: "s-1", isStreaming: true,
      isCompacting: false, messageCount: 5, pendingMessageCount: 0,
    });
    expect(s.sessionId).toBe("s-1");
    expect(s.busy).toBe(true);
    expect(s.messageCount).toBe(5);
  });
  it("state 事件 isStreaming=false 设 busy 基线", () => {
    const s = reducer(initState(), {
      type: "state", sessionId: "s-2", isStreaming: false,
      isCompacting: false, messageCount: 0, pendingMessageCount: 0,
    });
    expect(s.busy).toBe(false);
  });
  it("message_end(toolResult) → state 不变（修空 assistant 气泡 bug，pi emitToolResultMessage agent-loop.js:506-508）", () => {
    const before = initState();
    const after = reducer(before, { type: "message_end", message: { role: "toolResult", toolCallId: "tc1", toolName: "read", content: [], isError: false, timestamp: 0 } });
    expect(after).toBe(before);
  });
  it("message_end(bashExecution) → state 不变（防御，pi 不 emit 但 union 允许）", () => {
    const before = initState();
    const after = reducer(before, { type: "message_end", message: { role: "bashExecution", command: "ls", output: "", exitCode: 0, cancelled: false, truncated: false, timestamp: 0 } });
    expect(after).toBe(before);
  });
  it("message_update(非 assistant) → streaming 不变（防御，user 不流式）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: mkAssistant({ content: [{ type: "text", text: "hel" }] }) });
    expect(s.streaming).toBeDefined();
    s = reducer(s, { type: "message_update", message: mkUser({ content: [{ type: "text", text: "u" }] }) });
    expect(s.streaming?.content.find((c) => c.type === "text")?.text).toBe("hel");
  });
});

describe("derivePending", () => {
  it("空消息返回空", () => {
    expect(derivePending([])).toEqual([]);
  });

  it("streaming 含 toolCall block → pending", () => {
    const streaming: AssistantMessage = mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } }] });
    expect(derivePending([], streaming)).toEqual([
      { toolCallId: "tc1", toolName: "read", args: { path: "a.ts" } },
    ]);
  });

  it("定稿 assistant.toolCalls 未 execution_end → pending", () => {
    const messages: RenderedMessage[] = [
      { role: "assistant", text: "", toolCalls: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] },
    ];
    expect(derivePending(messages)).toEqual([{ toolCallId: "tc1", toolName: "read", args: {} }]);
  });

  it("toolCall.id 匹配 tool 条目 toolCallId → 不在 pending（已 executed）", () => {
    const messages: RenderedMessage[] = [
      { role: "assistant", text: "", toolCalls: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] },
      { role: "tool", text: "", toolCallId: "tc1", toolName: "read", args: {}, status: "done", isError: false },
    ];
    expect(derivePending(messages)).toEqual([]);
  });

  it("定稿 + streaming 同 id 不重复", () => {
    const messages: RenderedMessage[] = [
      { role: "assistant", text: "", toolCalls: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] },
    ];
    const streaming: AssistantMessage = mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] });
    expect(derivePending(messages, streaming)).toEqual([{ toolCallId: "tc1", toolName: "read", args: {} }]);
  });
});

describe("reducer tool_execution_end", () => {
  it("push done tool 条目（toolCallId/status/isError 透传）", () => {
    const state = reducer(initState(), {
      type: "tool_execution_end", toolCallId: "tc1", toolName: "read", args: { path: "a" }, isError: false,
    });
    expect(state.messages).toEqual([
      { role: "tool", text: "", toolCallId: "tc1", toolName: "read", args: { path: "a" }, status: "done", isError: false },
    ]);
  });

  it("isError:true → status:'error'（red-team F2：执行失败≠成功）", () => {
    const state = reducer(initState(), {
      type: "tool_execution_end", toolCallId: "tc1", toolName: "bash", args: {}, isError: true,
    });
    expect(state.messages[0]).toMatchObject({ status: "error", isError: true });
  });

  it("进 executed → derivePending 排除", () => {
    const streaming: AssistantMessage = mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] });
    let state = reducer(initState(), { type: "message_update", message: streaming });
    state = reducer(state, { type: "tool_execution_end", toolCallId: "tc1", toolName: "read", args: {}, isError: false });
    expect(derivePending(state.messages, state.streaming)).toEqual([]);
  });
});

describe("reducer message_end", () => {
  it("assistant 含 toolCall → push assistant 含 toolCalls + pending", () => {
    const state = reducer(initState(), {
      type: "message_end",
      message: mkAssistant({ content: [
        { type: "text", text: "hi" },
        { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a" } },
      ] }),
    });
    const last = state.messages[state.messages.length - 1];
    expect(last).toMatchObject({ role: "assistant", text: "hi" });
    expect((last as { toolCalls?: unknown }).toolCalls).toEqual([
      { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a" } },
    ]);
    expect(derivePending(state.messages, state.streaming)).toEqual([
      { toolCallId: "tc1", toolName: "read", args: { path: "a" } },
    ]);
  });

  it("stopReason:'aborted' → pending 标 error push + 自清", () => {
    let state = reducer(initState(), { type: "message_update", message: mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] }) });
    state = reducer(state, { type: "message_end", message: mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }], stopReason: "aborted" }) });
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error" && m.isError)).toBe(true);
    expect(derivePending(state.messages, state.streaming)).toEqual([]);
  });

  it("stopReason:'error' → 同 aborted 标 error", () => {
    const state = reducer(initState(), { type: "message_end", message: mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }], stopReason: "error", errorMessage: "boom" }) });
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error")).toBe(true);
    expect(state.error).toBe("boom");
  });

  it("stopReason:'stop' → 不标 error（pending 待 execution_end 自消）", () => {
    const state = reducer(initState(), { type: "message_end", message: mkAssistant({ content: [{ type: "text", text: "done" }], stopReason: "stop" }) });
    expect(state.messages.some((m) => m.role === "tool")).toBe(false);
  });
});

describe("reducer agent_end / error 兜底", () => {
  it("agent_end(残留 pending) → push error + 清 streaming + busy false", () => {
    let state = reducer(initState(), { type: "message_end", message: mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] }) });
    state = reducer(state, { type: "agent_end" });
    expect(state.busy).toBe(false);
    expect(state.streaming).toBeUndefined();
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error")).toBe(true);
    expect(derivePending(state.messages, state.streaming)).toEqual([]);
  });

  it("message_end(error) → agent_end：无重复 error 条目（单发幂等，red-team F1；server 已不合成双发，reducer 对 harness 转发的合法 message_end→agent_end 序列保持幂等）", () => {
    let state = reducer(initState(), { type: "message_end", message: mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }], stopReason: "error" }) });
    const countAfterMessageEnd = state.messages.filter((m) => m.role === "tool" && m.toolCallId === "tc1").length;
    state = reducer(state, { type: "agent_end" });
    const countAfterAgentEnd = state.messages.filter((m) => m.role === "tool" && m.toolCallId === "tc1").length;
    expect(countAfterAgentEnd).toBe(countAfterMessageEnd);  // message_end 已 push，agent_end 不重复 push
  });

  it("error(server 合成, streaming 含 toolCall) → push error + 清 streaming（Failure mode 吸收）", () => {
    let state = reducer(initState(), { type: "message_update", message: mkAssistant({ content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }] }) });
    state = reducer(state, { type: "error", message: "boom" });
    expect(state.busy).toBe(false);
    expect(state.streaming).toBeUndefined();
    expect(state.error).toBe("boom");
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error")).toBe(true);
  });
});

describe("initState", () => {
  it("无 tools 字段（P2-2 删冗余）", () => {
    const s = initState();
    expect((s as { tools?: unknown }).tools).toBeUndefined();
    expect(s.messages).toEqual([]);
    expect(s.busy).toBe(false);
  });
});

describe("ServerEvent 派生（Task 5：从 shared SerializedEvent 派生，消除手写漂移）", () => {
  it("ServerEvent 接受 forwarded SerializedEvent 成员（含 compaction.firstKeptEntryId 锁漂移点）", () => {
    // 类型断言：每个 SerializedEvent 成员都是合法 ServerEvent（forwarded 子集派生）。
    const forwarded: SerializedEvent[] = [
      { type: "agent_start" },
      { type: "agent_end" },
      { type: "message_update", message: mkAssistant({ content: [] }) },
      { type: "message_end", message: mkAssistant({ content: [] }) },
      { type: "tool_execution_end", toolCallId: "tc1", toolName: "read", isError: false },
      { type: "tool_execution_end", toolCallId: "tc1", toolName: "read", args: {}, isError: false },
      { type: "context_budget", components: {}, total: 0, suggestions: [], headroom: 0 },
      // compaction 现含 firstKeptEntryId（与 shared 契约一致，消除 reducer 旧手写无该字段的漂移）。
      { type: "compaction", summary: "s", firstKeptEntryId: "e1" },
      { type: "compaction_error", error: "boom" },
      { type: "audit_finding", severity: "low", finding: {} },
    ];
    for (const e of forwarded) {
      const _: ServerEvent = e; // 编译期：SerializedEvent ⊆ ServerEvent
      void _;
    }
    expect(forwarded.length).toBe(10);
  });

  it("ServerControlEvent = state | resumed | error 三者形状（synthesized 控制子集）", () => {
    const controls: ServerControlEvent[] = [
      { type: "state", sessionId: "s1", isStreaming: false, isCompacting: false, messageCount: 0, pendingMessageCount: 0 },
      { type: "resumed", sessionId: "s1" },
      { type: "error", message: "boom" },
    ];
    for (const e of controls) {
      const _: ServerEvent = e; // 编译期：ServerControlEvent ⊆ ServerEvent
      void _;
    }
    expect(controls.length).toBe(3);
  });

  it("reducer 对 compaction(含 firstKeptEntryId)走 default 不变（类型一致即消除漂移，行为不变）", () => {
    const before = initState();
    // compaction 现携带 firstKeptEntryId；reducer 不读它（default 返回 state 不变）。
    const after = reducer(before, { type: "compaction", summary: "s", firstKeptEntryId: "e1" });
    expect(after).toBe(before); // default 分支：原样返回
  });

  it("reducer 对 compaction_error / audit_finding 走 default 不变（forwarded 但 reducer 无 case）", () => {
    const before = initState();
    expect(reducer(before, { type: "compaction_error", error: "x" })).toBe(before);
    expect(reducer(before, { type: "audit_finding", severity: "low", finding: {} })).toBe(before);
  });
});
