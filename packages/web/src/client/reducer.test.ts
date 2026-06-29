import { describe, it, expect } from "vitest";
import { reducer, initState } from "./reducer.js";

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
  it("message_end stopReason=aborted 记终态", () => {
    let s = reducer(initState(), { type: "agent_start" });
    s = reducer(s, { type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } });
    expect(s.messages[s.messages.length - 1].stopReason).toBe("aborted");
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
});
