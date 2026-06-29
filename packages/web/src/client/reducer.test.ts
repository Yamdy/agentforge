import { describe, it, expect } from "vitest";
import { reducer, initState, derivePending, type AssistantMessage, type RenderedMessage } from "./reducer.js";

describe("reducer", () => {
  it("agent_start 设 busy", () => {
    expect(reducer(initState(), { type: "agent_start" }).busy).toBe(true);
  });
  it("message_update 整条替换 streaming（不拼 delta）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hel" }] } });
    s = reducer(s, { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } });
    expect((s.streaming as any).content[0].text).toBe("hello");
  });
  it("message_end 定稿 + 提取 usage + 清 streaming", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } });
    s = reducer(s, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hi" }], usage: { input: 10, output: 5 } } });
    expect(s.messages.length).toBe(1);
    expect(s.streaming).toBeUndefined();
    expect(s.lastUsage).toEqual({ input: 10, output: 5 });
  });
  it("message_end stopReason=aborted 记终态（用户主动中止，非失败，不设 state.error）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } });
    expect(s.messages[s.messages.length - 1].stopReason).toBe("aborted");
    expect(s.error).toBeUndefined();
  });
  it("message_end stopReason=error 设 state.error 显示失败信号（pi runWithLifecycle 不抛冒泡，靠 message_end 兜底）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error", errorMessage: "boom" } as any });
    expect(s.messages.length).toBe(1);
    expect(s.streaming).toBeUndefined();
    expect(s.error).toBe("boom");
  });
  it("message_end errorMessage 无 stopReason 也兜底设 state.error", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: { role: "assistant", content: [], errorMessage: "kaput" } as any });
    expect(s.error).toBe("kaput");
  });
  it("agent_end 兜底不设 error（pi agent_end 不带 errorMessage 字段，仅 messages[].errorMessage；reducer agent_end 不接收 messages）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: { role: "assistant", content: [] } });
    s = reducer(s, { type: "agent_end" });
    expect(s.busy).toBe(false);
    expect(s.streaming).toBeUndefined();
    expect(s.error).toBeUndefined();
  });
  it("message_end(user) 定稿 user 消息——server 是 user 消息唯一来源（spec §5.3，防 client 乐观 push 回归）", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
    expect(s.messages.length).toBe(1);
    expect(s.messages[0].role).toBe("user");
    expect(s.messages[0].text).toBe("hi");
  });
  it("agent_end 清 busy + 兜底清 streaming", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_update", message: { role: "assistant", content: [] } });
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
});

describe("derivePending", () => {
  it("空消息返回空", () => {
    expect(derivePending([])).toEqual([]);
  });

  it("streaming 含 toolCall block → pending", () => {
    const streaming: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } }],
    };
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
    const streaming: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
    };
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
    const streaming: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
    };
    let state = reducer(initState(), { type: "message_update", message: streaming });
    state = reducer(state, { type: "tool_execution_end", toolCallId: "tc1", toolName: "read", args: {}, isError: false });
    expect(derivePending(state.messages, state.streaming)).toEqual([]);
  });
});

describe("reducer message_end", () => {
  it("assistant 含 toolCall → push assistant 含 toolCalls + pending", () => {
    const state = reducer(initState(), {
      type: "message_end",
      message: { role: "assistant", content: [
        { type: "text", text: "hi" },
        { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a" } },
      ] },
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
    let state = reducer(initState(), { type: "message_update", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
    } });
    state = reducer(state, { type: "message_end", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
      stopReason: "aborted",
    } });
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error" && m.isError)).toBe(true);
    expect(derivePending(state.messages, state.streaming)).toEqual([]);
  });

  it("stopReason:'error' → 同 aborted 标 error", () => {
    const state = reducer(initState(), { type: "message_end", message: {
      role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }],
      stopReason: "error", errorMessage: "boom",
    } });
    expect(state.messages.some((m) => m.role === "tool" && m.toolCallId === "tc1" && m.status === "error")).toBe(true);
    expect(state.error).toBe("boom");
  });

  it("stopReason:'stop' → 不标 error（pending 待 execution_end 自消）", () => {
    const state = reducer(initState(), { type: "message_end", message: {
      role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop",
    } });
    expect(state.messages.some((m) => m.role === "tool")).toBe(false);
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
