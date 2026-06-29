import { describe, it, expect } from "vitest";
import { serializeWebEvent } from "./ws-protocol.js";
import type { HarnessEvent } from "@agentforge/shared";

describe("serializeWebEvent", () => {
  it("保留 message_update，转发累积态 message（丢 assistantMessageEvent）", () => {
    const msg = { role: "assistant", content: [{ type: "text", text: "hello" }] };
    const e = {
      type: "message_update",
      message: msg,
      assistantMessageEvent: { type: "text_delta", delta: "hel" },
    } as unknown as HarnessEvent;
    expect(serializeWebEvent(e)).toEqual({ type: "message_update", message: msg });
  });
  it("补 audit_finding", () => {
    const e = {
      type: "audit_finding",
      severity: "warn",
      finding: { x: 1 },
    } as unknown as HarnessEvent;
    expect(serializeWebEvent(e)).toEqual({
      type: "audit_finding",
      severity: "warn",
      finding: { x: 1 },
    });
  });
  it("context_budget 透传", () => {
    const e = {
      type: "context_budget",
      components: {},
      total: 5000,
      suggestions: [],
      headroom: 60000,
    } as unknown as HarnessEvent;
    expect(serializeWebEvent(e)).toEqual({
      type: "context_budget",
      components: {},
      total: 5000,
      suggestions: [],
      headroom: 60000,
    });
  });
  it("非白名单跳过", () => {
    expect(
      serializeWebEvent({ type: "turn_start" } as unknown as HarnessEvent),
    ).toBeUndefined();
    expect(
      serializeWebEvent({ type: "message_start" } as unknown as HarnessEvent),
    ).toBeUndefined();
  });
  it("agent_end / agent_start 透传 type", () => {
    expect(
      serializeWebEvent({ type: "agent_start" } as unknown as HarnessEvent),
    ).toEqual({ type: "agent_start" });
    expect(
      serializeWebEvent({ type: "agent_end", messages: [] } as unknown as HarnessEvent),
    ).toEqual({ type: "agent_end" });
  });
});

import { parseClientMessage } from "./ws-protocol.js";

describe("parseClientMessage", () => {
  it("解析 prompt", () => {
    expect(parseClientMessage(JSON.stringify({ method: "prompt", input: "hi" })))
      .toEqual({ ok: true, method: "prompt", input: "hi" });
  });
  it("解析 abort", () => {
    expect(parseClientMessage(JSON.stringify({ method: "abort" }))).toEqual({ ok: true, method: "abort" });
  });
  it("解析 resume", () => {
    expect(parseClientMessage(JSON.stringify({ method: "resume", sessionId: "s-1" })))
      .toEqual({ ok: true, method: "resume", sessionId: "s-1" });
  });
  it("prompt 缺 input 报错", () => {
    expect(parseClientMessage(JSON.stringify({ method: "prompt" }))).toEqual({ ok: false, error: "prompt requires input: string" });
  });
  it("非法 JSON 报错", () => {
    expect(parseClientMessage("{bad")).toEqual({ ok: false, error: "invalid json" });
  });
  it("未知 method 报错", () => {
    expect(parseClientMessage(JSON.stringify({ method: "foo" }))).toEqual({ ok: false, error: "unknown method: foo" });
  });
  it("解析 get_state", () => {
    expect(parseClientMessage(JSON.stringify({ method: "get_state" })))
      .toEqual({ ok: true, method: "get_state" });
  });
  it("各命令可选 id 透传", () => {
    expect(parseClientMessage(JSON.stringify({ method: "get_state", id: "1" })))
      .toEqual({ ok: true, method: "get_state", id: "1" });
    expect(parseClientMessage(JSON.stringify({ method: "prompt", input: "hi", id: "2" })))
      .toEqual({ ok: true, method: "prompt", input: "hi", id: "2" });
    expect(parseClientMessage(JSON.stringify({ method: "abort", id: "3" })))
      .toEqual({ ok: true, method: "abort", id: "3" });
    expect(parseClientMessage(JSON.stringify({ method: "resume", sessionId: "s", id: "4" })))
      .toEqual({ ok: true, method: "resume", sessionId: "s", id: "4" });
  });
  it("id 非字符串忽略（undefined）", () => {
    expect(parseClientMessage(JSON.stringify({ method: "get_state", id: 123 })))
      .toEqual({ ok: true, method: "get_state" });
  });
});
