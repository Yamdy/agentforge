import { describe, it, expect } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-agent-core";

// 探针：确认 rpc 模块存在（RED 阶段 ./rpc.js 不存在 → 导入失败）。
import "./rpc.js";
import { serializeEvent } from "./rpc.js";
import type { HarnessEvent } from "@agentforge/shared";

function makeAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions" as any,
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: {
			input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("rpc — AgentMessage serialization round-trip", () => {
	it("AssistantMessage survives JSON.stringify → parse with no field loss", () => {
		const msg: AssistantMessage = makeAssistantMessage("hello world");
		const parsed = JSON.parse(JSON.stringify(msg)) as AssistantMessage;
		expect(parsed).toEqual(msg);
		expect(parsed.role).toBe("assistant");
		expect(parsed.content[0]).toMatchObject({ type: "text", text: "hello world" });
		expect(parsed.stopReason).toBe("stop");
		expect(parsed.usage.totalTokens).toBe(2);
	});

	it("AssistantMessage with toolCall block survives round-trip", () => {
		const msg = {
			...makeAssistantMessage("thinking"),
			content: [
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/x" } },
			],
		} as AssistantMessage;
		const parsed = JSON.parse(JSON.stringify(msg)) as AssistantMessage;
		expect(parsed).toEqual(msg);
		expect(parsed.content[1]).toMatchObject({ type: "toolCall", name: "read" });
	});
});

describe("rpc — serializeEvent whitelist", () => {
	it("serializes tool_execution_end event (slim, no result payload)", () => {
		const event = {
			type: "tool_execution_end", toolCallId: "tc-1", toolName: "read",
			result: { content: [{ type: "text", text: "file contents" }] }, isError: false,
		} as unknown as HarnessEvent;
		expect(serializeEvent(event)).toEqual({
			type: "tool_execution_end", toolCallId: "tc-1", toolName: "read", isError: false,
		});
	});

	it("serializes context_budget event", () => {
		const event = { type: "context_budget", components: {}, total: 5000, suggestions: [], headroom: 60000 } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toMatchObject({ type: "context_budget", total: 5000 });
	});

	it("serializes compaction event", () => {
		const event = { type: "compaction", summary: "SUMMARY", firstKeptEntryId: "e-1" } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toMatchObject({ type: "compaction", summary: "SUMMARY" });
	});

	it("serializes agent_start event", () => {
		const event = { type: "agent_start" } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toEqual({ type: "agent_start" });
	});

	it("serializes agent_end event as type-only (messages omitted, given in prompt result)", () => {
		const event = { type: "agent_end", messages: [{ role: "assistant" }] } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toEqual({ type: "agent_end" });
	});

	it("serializes message_end event with message", () => {
		const event = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toMatchObject({ type: "message_end", message: { role: "assistant" } });
	});

	it("returns undefined for non-whitelisted events", () => {
		const event = { type: "some_unknown_internal_event" } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toBeUndefined();
	});

	it("returns undefined for token-stream message_update event", () => {
		const event = { type: "message_update", message: {}, assistantMessageEvent: { delta: "tok" } } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toBeUndefined();
	});
});
