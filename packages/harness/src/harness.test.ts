import { describe, it, expect, vi } from "vitest";
import {
	AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	AgentTool,
} from "@earendil-works/pi-agent-core";

import { AgentForgeHarness } from "./harness.js";
import { createEventBus } from "./events.js";
import { createMemorySession } from "./session.js";

/** 构造一个合法的最小 AssistantMessage（stopReason "stop"，无 toolCall）。 */
function makeAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic" as any,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
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

const noopTool: AgentTool = {
	name: "noop",
	label: "Noop",
	description: "does nothing",
	parameters: {} as any,
	execute: async () => ({
		content: [{ type: "text", text: "ok" }],
		details: {},
	}),
};

function buildHarness(opts: { streamFn?: any } = {}) {
	const events = createEventBus();
	const session = createMemorySession();
	const harness = new AgentForgeHarness({
		session,
		events,
		tools: [noopTool],
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		systemPrompt: "you are a test agent",
		streamFn: opts.streamFn ?? makeMockStreamFn("hello from mock"),
	});
	return { harness, events, session };
}

describe("AgentForgeHarness", () => {
	describe("construction wiring", () => {
		it("exposes a non-null agent", () => {
			const { harness } = buildHarness();
			expect(harness.agent).toBeTruthy();
		});

		it("forwards tools to the underlying agent state", () => {
			const { harness } = buildHarness();
			expect(harness.agent.state.tools).toHaveLength(1);
			expect(harness.agent.state.tools[0].name).toBe("noop");
		});

		it("forwards the system prompt to the underlying agent state", () => {
			const { harness } = buildHarness();
			expect(harness.agent.state.systemPrompt).toBe("you are a test agent");
		});

		it("starts with an empty messages array", () => {
			const { harness } = buildHarness();
			expect(harness.agent.state.messages).toEqual([]);
		});
	});

	describe("event forwarding", () => {
		it("forwards pi Agent events to the EventBus via subscribe", async () => {
			const { harness, events } = buildHarness();
			const seen: string[] = [];
			events.on("agent_start", () => seen.push("agent_start"));
			events.on("turn_start", () => seen.push("turn_start"));

			await harness.prompt("hi");

			// agent_start / turn_start 都应经由 subscribe 转发到 EventBus
			expect(seen).toContain("agent_start");
			expect(seen).toContain("turn_start");
		});
	});

	describe("prompt", () => {
		it("appends the new assistant message to the session", async () => {
			const { harness, session } = buildHarness({
				streamFn: makeMockStreamFn("mocked reply"),
			});
			const appendSpy = vi.spyOn(session, "appendEntry");

			await harness.prompt("hi");

			expect(appendSpy).toHaveBeenCalled();
			// 至少一次 append 携带 type: "message"
			const messageCalls = appendSpy.mock.calls.filter(
				([e]: any[]) => e && e.type === "message",
			);
			expect(messageCalls.length).toBeGreaterThan(0);
			const appended = messageCalls[messageCalls.length - 1][0] as any;
			expect(appended.message).toBeDefined();
			expect(appended.message.role).toBe("assistant");
		});

		it("leaves the agent idle after prompt resolves", async () => {
			const { harness } = buildHarness();
			await harness.prompt("hi");
			expect(harness.agent.state.isStreaming).toBe(false);
		});
	});

	describe("context budget (issue #12)", () => {
		it("emits a context_budget event with suggestions when history exceeds the model context window", async () => {
			const events = createEventBus();
			const session = createMemorySession();
			const seen: any[] = [];
			events.on("context_budget", (e: any) => seen.push(e));

			// 注入极小 modelContextWindow + 长 systemPrompt 触发 history 占比超阈值
			// （history tokens / window > 0.8 默认阈值）。
			const harness = new AgentForgeHarness({
				session,
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: "test",
				streamFn: makeMockStreamFn("reply"),
				modelContextWindow: 10, // 极小窗口，任何 history 都超 80%
			});

			await harness.prompt("a reasonably long prompt to exceed the tiny window");

			expect(seen.length).toBeGreaterThanOrEqual(1);
			const evt = seen[0];
			expect(evt.type).toBe("context_budget");
			expect(evt.components).toBeDefined();
			expect(typeof evt.total).toBe("number");
			expect(typeof evt.headroom).toBe("number");
			// 应有至少一条 suggestion（history 超阈值）。
			expect(evt.suggestions.length).toBeGreaterThanOrEqual(1);
			expect(
				evt.suggestions.some(
					(s: any) => s.component === "history",
				),
			).toBe(true);
		});

		it("does not emit context_budget when modelContextWindow is not provided", async () => {
			const { harness, events } = buildHarness();
			const seen: any[] = [];
			events.on("context_budget", (e: any) => seen.push(e));

			await harness.prompt("hi");

			expect(seen).toHaveLength(0);
		});

		it("budget failure does not break the main prompt flow", async () => {
			const events = createEventBus();
			const session = createMemorySession();
			// 用一个会令 audit 内部出错的 systemPrompt（非字符串）模拟 budget 失败。
			// harness 应 try/catch 吞掉，prompt 仍正常完成。
			const harness = new AgentForgeHarness({
				session,
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: undefined as any,
				streamFn: makeMockStreamFn("still works"),
				modelContextWindow: 1000,
			});

			await harness.prompt("hi");

			// 主流程未抛错，assistant 消息照常落盘。
			const messages = harness.agent.state.messages;
			const lastAssistant = [...messages]
				.reverse()
				.find((m: any) => m.role === "assistant");
			expect(lastAssistant).toBeDefined();
		});
	});
});
