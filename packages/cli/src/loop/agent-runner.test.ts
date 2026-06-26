import { describe, it, expect } from "vitest";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";
import { InProcessAgentRunner } from "./agent-runner.js";

/** 构造带 usage 的合法 AssistantMessage(契约同 eval runner.test.ts)。 */
function makeAssistantMessage(
	text: string,
	usage: { input: number; output: number; costTotal: number },
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic" as any,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: usage.input,
			output: usage.output,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: usage.input + usage.output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.costTotal },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** mock streamFn:产出 start + done 事件,done 携带带 usage 的 AssistantMessage。 */
function makeMockStreamFn(
	text: string,
	usage: { input: number; output: number; costTotal: number },
) {
	return () => {
		const stream = new AssistantMessageEventStream();
		const message = makeAssistantMessage(text, usage);
		const startEvent: AssistantMessageEvent = { type: "start", partial: message };
		const doneEvent: AssistantMessageEvent = { type: "done", reason: "stop", message };
		queueMicrotask(() => {
			stream.push(startEvent);
			stream.push(doneEvent);
		});
		return stream;
	};
}

describe("InProcessAgentRunner", () => {
	it("run → 提取 reply / cost / tokensIn / tokensOut", async () => {
		const runner = new InProcessAgentRunner({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			getApiKey: () => "k",
			tools: [],
			systemPrompt: "",
			streamFn: makeMockStreamFn("hello", { input: 10, output: 5, costTotal: 0.02 }),
		});
		const r = await runner.run("do something", { cwd: process.cwd() });
		expect(r.reply).toBe("hello");
		expect(r.cost).toBeCloseTo(0.02, 6);
		expect(r.tokensIn).toBe(10);
		expect(r.tokensOut).toBe(5);
	});

	it("fresh context:多次 run 独立(新 harness per run,streamFn 闭包计数)", async () => {
		let callCount = 0;
		const streamFn = () => {
			callCount++;
			const stream = new AssistantMessageEventStream();
			const message = makeAssistantMessage(`reply-${callCount}`, {
				input: 1,
				output: 1,
				costTotal: 0.01,
			});
			const startEvent: AssistantMessageEvent = { type: "start", partial: message };
			const doneEvent: AssistantMessageEvent = { type: "done", reason: "stop", message };
			queueMicrotask(() => {
				stream.push(startEvent);
				stream.push(doneEvent);
			});
			return stream;
		};
		const runner = new InProcessAgentRunner({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			getApiKey: () => "k",
			tools: [],
			systemPrompt: "",
			streamFn,
		});
		const r1 = await runner.run("p1", { cwd: process.cwd() });
		const r2 = await runner.run("p2", { cwd: process.cwd() });
		expect(r1.reply).toBe("reply-1");
		expect(r2.reply).toBe("reply-2");
	});
});
