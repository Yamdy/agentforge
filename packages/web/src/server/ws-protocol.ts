import { serializeEvent } from "@agentforge/shared";
import type { HarnessEvent, SerializedEvent } from "@agentforge/shared";

/**
 * web 版事件序列化：shared.serializeEvent 的薄包装。
 * web opts：includeMessageUpdate（转发累积态 message，丢 assistantMessageEvent，server 不 narrow 不批量）
 *  + includeToolArgs（tool_execution_end 带 args）。白名单与窄化逻辑由 shared 统一维护，本处零 `as`。
 * message_update 与 message_end 都转发完整累积态 message（pi 借鉴整条替换；背压由前端 rAF 合帧吸收）。
 */
export function serializeWebEvent(
  event: HarnessEvent,
): SerializedEvent | undefined {
  return serializeEvent(event, {
    includeMessageUpdate: true,
    includeToolArgs: true,
  });
}

export type ClientMessage =
  | { ok: true; method: "prompt"; input: string; id?: string }
  | { ok: true; method: "abort"; id?: string }
  | { ok: true; method: "resume"; sessionId: string; id?: string }
  | { ok: true; method: "get_state"; id?: string }
  | { ok: false; error: string };

export function parseClientMessage(data: string): ClientMessage {
  let obj: unknown;
  try { obj = JSON.parse(data); } catch { return { ok: false, error: "invalid json" }; }
  if (typeof obj !== "object" || obj === null) return { ok: false, error: "invalid request" };
  const o = obj as { method?: unknown; input?: unknown; sessionId?: unknown; id?: unknown };
  const id = typeof o.id === "string" ? o.id : undefined;
  if (o.method === "prompt") {
    if (typeof o.input !== "string") return { ok: false, error: "prompt requires input: string" };
    return { ok: true, method: "prompt", input: o.input, ...(id !== undefined ? { id } : {}) };
  }
  if (o.method === "abort") return { ok: true, method: "abort", ...(id !== undefined ? { id } : {}) };
  if (o.method === "resume") {
    if (typeof o.sessionId !== "string") return { ok: false, error: "resume requires sessionId: string" };
    return { ok: true, method: "resume", sessionId: o.sessionId, ...(id !== undefined ? { id } : {}) };
  }
  if (o.method === "get_state") return { ok: true, method: "get_state", ...(id !== undefined ? { id } : {}) };
  return { ok: false, error: `unknown method: ${String(o.method)}` };
}
