import { describe, it, expect } from "vitest";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";
import type { AgentForgeHarness } from "@agentforge/harness";

import { parseArgs, runPrintMode } from "./print-mode.js";

/** 构造一个合法的最小 AssistantMessage（stopReason "stop"，无 toolCall）。 */
function makeAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions" as any,
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** mock streamFn：产出 start + done 事件，result() 返回最终 message。 */
function makeMockStreamFn(text: string) {
	return () => {
		const stream = new AssistantMessageEventStream();
		const message = makeAssistantMessage(text);
		const startEvent: AssistantMessageEvent = {
			type: "start",
			partial: message,
		};
		const doneEvent: AssistantMessageEvent = {
			type: "done",
			reason: "stop",
			message,
		};
		queueMicrotask(() => {
			stream.push(startEvent);
			stream.push(doneEvent);
		});
		return stream;
	};
}

describe("cli print mode — parseArgs", () => {
	it("parses -p <prompt>", () => {
		const args = parseArgs(["-p", "hello"]);
		expect(args.print).toBe(true);
		expect(args.prompt).toBe("hello");
	});

	it("parses --print <prompt>", () => {
		const args = parseArgs(["--print", "world"]);
		expect(args.print).toBe(true);
		expect(args.prompt).toBe("world");
	});

	it("defaults provider to deepseek and model to deepseek-v4-pro", () => {
		const args = parseArgs(["-p", "hi"]);
		expect(args.provider).toBe("deepseek");
		expect(args.model).toBe("deepseek-v4-pro");
	});

	it("overrides provider/model via --provider/--model", () => {
		const args = parseArgs([
			"-p",
			"hi",
			"--provider",
			"anthropic",
			"--model",
			"claude-sonnet-4-5",
		]);
		expect(args.provider).toBe("anthropic");
		expect(args.model).toBe("claude-sonnet-4-5");
	});

	it("parses optional --session-dir", () => {
		const args = parseArgs(["-p", "hi", "--session-dir", "/tmp/sess"]);
		expect(args.sessionDir).toBe("/tmp/sess");
	});

	it("print=false when no -p/--print given", () => {
		const args = parseArgs([]);
		expect(args.print).toBe(false);
		expect(args.prompt).toBeUndefined();
	});

	it("throws on -p without a value", () => {
		expect(() => parseArgs(["-p"])).toThrow();
	});
});

describe("cli print mode — runPrintMode", () => {
	it("drives harness and returns final assistant text", async () => {
		const streamFn = makeMockStreamFn("mocked reply from deepseek");
		const output = await runPrintMode(["-p", "你好"], {
			streamFn,
			getApiKey: () => "fake-key",
		});
		expect(output).toBe("mocked reply from deepseek");
	});

	it("uses injected provider/model overrides", async () => {
		const streamFn = makeMockStreamFn("anthropic reply");
		const output = await runPrintMode(
			["-p", "hi", "--provider", "anthropic", "--model", "claude-sonnet-4-5"],
			{ streamFn, getApiKey: () => "fake-key" },
		);
		expect(output).toBe("anthropic reply");
	});

	it("returns empty string when assistant message has no text content", async () => {
		// mock 一个空文本消息
		const streamFn = () => {
			const stream = new AssistantMessageEventStream();
			const message = makeAssistantMessage("");
			queueMicrotask(() => {
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};
		const output = await runPrintMode(["-p", "hi"], {
			streamFn,
			getApiKey: () => "fake-key",
		});
		expect(output).toBe("");
	});

	it("runs without real env when streamFn + getApiKey are injected", async () => {
		const streamFn = makeMockStreamFn("injected reply");
		// 注入 mock streamFn + getApiKey，不依赖 process.env，不触发真实 LLM
		const output = await runPrintMode(["-p", "hi"], {
			streamFn,
			getApiKey: () => "fake-key",
		});
		expect(output).toBe("injected reply");
	});
});

describe("cli print mode — T8 Safety + 6 tools (no askHandler)", () => {
	it("constructs harness with 6 tools + safety guard, no askHandler (ask degrades deny)", async () => {
		let seenHarness: AgentForgeHarness | null = null;
		await runPrintMode(["-p", "hi"], {
			streamFn: makeMockStreamFn("reply"),
			getApiKey: () => "fake-key",
			onHarnessCreated: (h: AgentForgeHarness) => {
				seenHarness = h;
			},
		});

		expect(seenHarness).not.toBeNull();
		const h = seenHarness as AgentForgeHarness;
		// 6 tools
		const toolNames = h.agent.state.tools.map((t: any) => t.name).sort();
		expect(toolNames).toEqual(["bash", "edit", "glob", "grep", "read", "write"]);
		// safety present: deny pattern blocked
		const denyResult = await h.applySafety({
			toolName: "bash",
			args: { command: "rm -rf /tmp/x" },
		});
		expect(denyResult).toEqual({ block: true, reason: "safety:deny" });
		// no askHandler in print mode → ask degrades to deny
		const askResult = await h.applySafety({
			toolName: "bash",
			args: { command: "git push origin main" },
		});
		expect(askResult).toEqual({ block: true, reason: "safety:ask-no-handler" });
	});
});
