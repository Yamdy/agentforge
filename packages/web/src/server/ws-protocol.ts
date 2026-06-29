import type { HarnessEvent } from "@agentforge/shared";

/**
 * web 版事件序列化。与 rpc.serializeEvent 差异：
 *  1. 保留 message_update（rpc 排除）—— 转发累积态 message，丢 assistantMessageEvent，server 不 narrow 不批量。
 *  2. 补 audit_finding（rpc 有）。
 *  3. 不含全 message（背压；完整消息在 message_end）。
 */
export function serializeWebEvent(
  event: HarnessEvent,
): Record<string, unknown> | undefined {
  const type = (event as { type?: string }).type;
  switch (type) {
    case "agent_start":
      return { type };
    case "agent_end":
      return { type };
    case "message_update": {
      return {
        type: "message_update",
        message: (event as { message: unknown }).message,
      };
    }
    case "message_end": {
      const e = event as { message: unknown };
      return { type, message: e.message };
    }
    case "tool_execution_end": {
      const e = event as {
        toolCallId: string;
        toolName: string;
        args: unknown;
        isError: boolean;
      };
      return {
        type,
        toolCallId: e.toolCallId,
        toolName: e.toolName,
        args: e.args,
        isError: e.isError,
      };
    }
    case "context_budget": {
      const e = event as {
        components: unknown;
        total: number;
        suggestions: unknown[];
        headroom: number;
      };
      return {
        type,
        components: e.components,
        total: e.total,
        suggestions: e.suggestions,
        headroom: e.headroom,
      };
    }
    case "compaction": {
      const e = event as { summary: string; firstKeptEntryId: string };
      return { type, summary: e.summary, firstKeptEntryId: e.firstKeptEntryId };
    }
    case "compaction_error": {
      const e = event as { error: string };
      return { type, error: e.error };
    }
    case "audit_finding": {
      const e = event as { severity: string; finding: unknown };
      return { type, severity: e.severity, finding: e.finding };
    }
    default:
      return undefined;
  }
}

export type ClientMessage =
  | { ok: true; method: "prompt"; input: string }
  | { ok: true; method: "abort" }
  | { ok: true; method: "resume"; sessionId: string }
  | { ok: false; error: string };

export function parseClientMessage(data: string): ClientMessage {
  let obj: unknown;
  try { obj = JSON.parse(data); } catch { return { ok: false, error: "invalid json" }; }
  if (typeof obj !== "object" || obj === null) return { ok: false, error: "invalid request" };
  const o = obj as { method?: unknown; input?: unknown; sessionId?: unknown };
  if (o.method === "prompt") {
    if (typeof o.input !== "string") return { ok: false, error: "prompt requires input: string" };
    return { ok: true, method: "prompt", input: o.input };
  }
  if (o.method === "abort") return { ok: true, method: "abort" };
  if (o.method === "resume") {
    if (typeof o.sessionId !== "string") return { ok: false, error: "resume requires sessionId: string" };
    return { ok: true, method: "resume", sessionId: o.sessionId };
  }
  return { ok: false, error: `unknown method: ${String(o.method)}` };
}
