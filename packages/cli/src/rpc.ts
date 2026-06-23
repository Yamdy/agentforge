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

/** JSON-RPC 2.0 标准错误码。 */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export type RequestId = number | string;

export type ParsedRequest =
	| { ok: true; value: { id: RequestId; method: string; params: unknown } }
	| { ok: false; code: number; id: RequestId | null };

/** 解析一行 stdin 为 JSON-RPC 请求。JSON 非法 → PARSE_ERROR(id=null)；结构不全 → INVALID_REQUEST。 */
export function parseRequest(line: string): ParsedRequest {
	let obj: unknown;
	try {
		obj = JSON.parse(line);
	} catch {
		return { ok: false, code: PARSE_ERROR, id: null };
	}
	if (typeof obj !== "object" || obj === null) {
		return { ok: false, code: INVALID_REQUEST, id: null };
	}
	const o = obj as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
	if (typeof o.method !== "string") {
		return { ok: false, code: INVALID_REQUEST, id: null };
	}
	if (o.id !== undefined && typeof o.id !== "number" && typeof o.id !== "string") {
		return { ok: false, code: INVALID_REQUEST, id: null };
	}
	return { ok: true, value: { id: o.id as RequestId, method: o.method, params: o.params ?? {} } };
}

export function makeResult(id: RequestId, result: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function makeError(id: RequestId | null, code: number, message: string): string {
	return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

export function makeNotification(method: string, params: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", method, params });
}
