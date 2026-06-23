import { describe, it, expect } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-agent-core";

// 探针：确认 rpc 模块存在（RED 阶段 ./rpc.js 不存在 → 导入失败）。
import "./rpc.js";

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
