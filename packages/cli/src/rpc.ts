/**
 * cli RPC 模式。见 ARCHITECTURE.md §5 + docs/superpowers/specs/2026-06-23-slice3.5-rpc-design.md。
 *
 * JSONL over stdio（JSON-RPC 2.0）：stdin 读请求，stdout 写响应/事件。
 * runRpcMode 为可测函数（deps 注入），bin 入口 index.ts 调用。
 */
import type { HarnessEvent } from "@agentforge/shared";

/**
 * 把 harness EventBus 事件序列化为 JSON-RPC notification params。
 * 白名单：只推可序列化、客户端关心的事件。非白名单 → undefined（跳过）。
 * 不推逐 token 流（A 约束，message_update 排除）。tool_execution_end 推精简字段
 * （result 大，默认不推全量；safety deny 时 isError=true 仍可推）。
 *
 * pi AgentEvent 成员（@earendil-works/pi-agent-core types.d.ts:359）：
 *   agent_start | agent_end | turn_start | turn_end |
 *   message_start | message_update | message_end |
 *   tool_execution_start | tool_execution_update | tool_execution_end
 * harness 自定义（@agentforge/shared）：
 *   compaction | instinct_observed | audit_finding | adr_recorded | context_budget
 */
export function serializeEvent(
	event: HarnessEvent,
): Record<string, unknown> | undefined {
	const type = (event as { type?: string }).type;
	switch (type) {
		case "agent_start":
			return { type };
		case "agent_end":
			// agent_end 含 messages（大），只推 type；messages 在 prompt result 里给。
			return { type };
		case "message_end": {
			const e = event as { message: unknown };
			return { type, message: e.message };
		}
		case "tool_execution_end": {
			const e = event as {
				toolCallId: string;
				toolName: string;
				isError: boolean;
			};
			return {
				type,
				toolCallId: e.toolCallId,
				toolName: e.toolName,
				isError: e.isError,
			};
		}
		case "compaction": {
			const e = event as { summary: string; firstKeptEntryId: string };
			return { type, summary: e.summary, firstKeptEntryId: e.firstKeptEntryId };
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
		default:
			// 非白名单（turn_*、message_start、message_update 逐 token 流、
			// tool_execution_start/update、instinct_observed、audit_finding、adr_recorded、未知）
			return undefined;
	}
}
