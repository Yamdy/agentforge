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
import { createCompactor } from "./compaction.js";
import * as contextBudget from "./context-budget.js";
import type { SantaVerifier, Rubric, ReviewResult } from "./verification.js";

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

		it("on signal abort: throws, filters aborted assistant msg from session, releases activeRun", async () => {
			// streamFn：第 1 次 hang-on-abort（push error event 让 agent loop 退出），
			// 第 2 次正常完成（start + done）。验证 abort 后 activeRun 释放、下次 prompt 不被拒。
			let callCount = 0;
			const abortThenNormal = (_m: unknown, _ctx: unknown, opts: { signal?: AbortSignal } = {}) => {
				callCount += 1;
				const stream = new AssistantMessageEventStream();
				if (callCount === 1) {
					const abortedMsg: AssistantMessage = {
						...makeAssistantMessage("partial"),
						stopReason: "aborted",
						errorMessage: "aborted",
					};
					opts.signal?.addEventListener("abort", () => {
						stream.push({ type: "error", reason: "aborted", error: abortedMsg });
					});
				} else {
					const message = makeAssistantMessage("ok");
					queueMicrotask(() => {
						stream.push({ type: "start", partial: message });
						stream.push({ type: "done", reason: "stop", message });
					});
				}
				return stream;
			};
			const { harness, session } = buildHarness({ streamFn: abortThenNormal as any });
			const ac = new AbortController();
			// 延迟 abort 让 agent loop 先启动（activeRun 就绪、streamFn 注册 signal 监听）。
			setTimeout(() => ac.abort(), 50);

			await expect(harness.prompt("hang", ac.signal)).rejects.toThrow(/aborted/i);

			// activeRun 必须已释放——下一次 prompt 不抛 "already processing"。
			const ac2 = new AbortController();
			await expect(harness.prompt("next", ac2.signal)).resolves.toBeUndefined();

			// session 路径上不应含 stopReason==="aborted" 的 assistant 消息。
			const path = session.getPathToRoot(session.getLeafId());
			const aborted = path.filter(
				(e: any) => e?.type === "message" && e?.message?.role === "assistant" && e?.message?.stopReason === "aborted",
			);
			expect(aborted).toHaveLength(0);
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

		it("does not emit context_budget when total is under the window and no component exceeds thresholds (issue #3)", async () => {
			const events = createEventBus();
			const session = createMemorySession();
			const seen: any[] = [];
			events.on("context_budget", (e: any) => seen.push(e));

			// 构造 total 在 window/2 到 window 之间、无 suggestions:
			// modelContextWindow 1000;reply 2400 chars → history ~600 tokens;
			// history/window=0.6 < 0.8 阈值 → 无 history suggestion;
			// tools=[] / skills=[] / systemPrompt 短 → 无其他 suggestion。
			// total ~602 > window/2=500 → 旧条件(remaining<total)emit;新条件(total<window)不 emit。
			const harness = new AgentForgeHarness({
				session,
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: "x",
				streamFn: makeMockStreamFn("a".repeat(2400)),
				modelContextWindow: 1000,
			});

			await harness.prompt("hi");

			expect(seen).toHaveLength(0);
		});

		it("budget failure (audit throws) does not break the main prompt flow", async () => {
			const events = createEventBus();
			const session = createMemorySession();
			const harness = new AgentForgeHarness({
				session,
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: "test",
				streamFn: makeMockStreamFn("still works"),
				modelContextWindow: 1000,
			});

			// mock audit 抛错,验证 harness try/catch 吞掉,prompt 仍正常完成。
			const spy = vi
				.spyOn(contextBudget, "audit")
				.mockImplementation(() => {
					throw new Error("audit boom");
				});

			await harness.prompt("hi");

			spy.mockRestore();

			// 主流程未抛错,assistant 消息照常落盘。
			const messages = harness.agent.state.messages;
			const lastAssistant = [...messages]
				.reverse()
				.find((m: any) => m.role === "assistant");
			expect(lastAssistant).toBeDefined();
		});
	});

	describe("compaction error handling (Slice 2.5)", () => {
		it("maybeCompact emits compaction_error and does not throw when generateSummary fails", async () => {
			const events = createEventBus();
			const received: any[] = [];
			events.on("compaction_error", (e: any) => received.push(e));
			const compactor = createCompactor();
			const compactorDeps = {
				generateSummary: async () => {
					throw new Error("LLM down");
				},
			};
			const harness = new AgentForgeHarness({
				session: createMemorySession(),
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: "",
				compactor,
				compactorDeps,
				compactionTokenThreshold: 0, // 强制每 turn 触发 shouldCompact
				streamFn: makeMockStreamFn("ok"), // mock：user→assistant "ok"
			});
			// 不应抛错
			await harness.prompt("hi");
			expect(received).toHaveLength(1);
			expect(received[0].type).toBe("compaction_error");
			expect(received[0].error).toBe("LLM down");
		});

		it("maybeCompact does not emit compaction_error on AbortError", async () => {
			const events = createEventBus();
			const received: any[] = [];
			events.on("compaction_error", (e: any) => received.push(e));
			const ac = new AbortController();
			const compactor = createCompactor();
			const compactorDeps = {
				generateSummary: async (_m: unknown, signal?: AbortSignal) => {
					if (signal?.aborted)
						throw new DOMException("aborted", "AbortError");
					throw new Error("unreachable");
				},
			};
			const harness = new AgentForgeHarness({
				session: createMemorySession(),
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: "",
				compactor,
				compactorDeps,
				compactionTokenThreshold: 0,
				streamFn: makeMockStreamFn("ok"),
			});
			ac.abort();
			// prompt 在 abort 时抛 "aborted"（在到达 maybeCompact 之前），
			// 故 compaction_error 永不 emit。received 保持空。
			await expect(harness.prompt("hi", ac.signal)).rejects.toThrow(/aborted/i);
			expect(received).toHaveLength(0); // abort 不 emit compaction_error
		});
	});
});

describe("AgentForgeHarness verifier mounting", () => {
	it("verify() delegates to the injected verifier.review", async () => {
		const fakeReview = vi.fn(async (): Promise<ReviewResult> => ({
			verdict: "nice",
			issues: [],
			reviews: [
				{ verdict: "nice", issues: [] },
				{ verdict: "nice", issues: [] },
			],
		}));
		const verifier: SantaVerifier = {
			review: fakeReview,
			verifyUntilNice: vi.fn(async () => ({
				output: "o",
				verdict: "nice",
				rounds: 1,
				history: [],
			})) as any,
		};
		const events = createEventBus();
		const session = createMemorySession();
		const harness = new AgentForgeHarness({
			session,
			events,
			tools: [],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt: "test",
			streamFn: () => ({}) as any,
			verifier,
		});
		const rubric: Rubric = { criteria: ["c1"] };
		const r = await harness.verify("output", rubric);
		expect(fakeReview).toHaveBeenCalledTimes(1);
		expect(r.verdict).toBe("nice");
	});

	it("verify() throws when no verifier is configured", async () => {
		const events = createEventBus();
		const session = createMemorySession();
		const harness = new AgentForgeHarness({
			session,
			events,
			tools: [],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt: "test",
			streamFn: () => ({}) as any,
		});
		await expect(harness.verify("output", { criteria: ["c1"] })).rejects.toThrow(
			/no verifier/i,
		);
	});

	it("exposes verifier via getter (undefined when not injected)", () => {
		const events = createEventBus();
		const session = createMemorySession();
		const harness = new AgentForgeHarness({
			session,
			events,
			tools: [],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt: "test",
			streamFn: () => ({}) as any,
		});
		expect(harness.verifier).toBeUndefined();
	});
});
