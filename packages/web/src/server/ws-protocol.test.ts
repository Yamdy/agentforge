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
