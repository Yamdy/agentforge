import { describe, it, expect } from "vitest";
import { serializeWebEvent } from "./ws-protocol.js";
import type { HarnessEvent } from "@agentforge/shared";

describe("serializeWebEvent", () => {
  it("保留 message_update 的 text_delta，返回 {type, delta}", () => {
    const e = {
      type: "message_update",
      message: {},
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    } as unknown as HarnessEvent;
    expect(serializeWebEvent(e)).toEqual({ type: "message_update", delta: "hello" });
  });
  it("message_update 非 text_delta 变体跳过", () => {
    const e = {
      type: "message_update",
      message: {},
      assistantMessageEvent: { type: "thinking_delta", delta: "th" },
    } as unknown as HarnessEvent;
    expect(serializeWebEvent(e)).toBeUndefined();
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
