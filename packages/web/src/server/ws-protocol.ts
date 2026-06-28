import type { HarnessEvent } from "@agentforge/shared";

/**
 * web 版事件序列化。与 rpc.serializeEvent 差异：
 *  1. 保留 message_update（rpc 排除）—— server 端 narrow text_delta 取 delta，发 {type,delta}；非 text_delta 跳过。
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
      const inner = (
        event as {
          assistantMessageEvent?: { type?: string; delta?: string };
        }
      ).assistantMessageEvent;
      if (
        !inner ||
        inner.type !== "text_delta" ||
        typeof inner.delta !== "string"
      ) {
        return undefined;
      }
      return { type: "message_update", delta: inner.delta };
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
