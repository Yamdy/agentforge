import { describe, it, expect, vi } from "vitest";
import {
	AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	AgentTool,
} from "@earendil-works/pi-agent-core";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentForgeHarness } from "./harness.js";
import { createEventBus } from "./events.js";
import { createMemorySession } from "./session.js";
import { createCompactor } from "./compaction.js";
import * as contextBudget from "./context-budget.js";
import { estimateStringTokens } from "./context-budget.js";
import type { SantaVerifier, Rubric, ReviewResult } from "./verification.js";
import type { HarnessEvent, CompactionErrorEvent } from "@agentforge/shared";
import {
	createInstinctStore,
	formatInstinctsForSystemPrompt,
	type Instinct,
} from "./instinct.js";

/** 构造一个 Instinct JSON 写到 `<dir>/projects/<hash>/instincts/<id>.json`。 */
function writeInstinct(dir: string, inst: Instinct): void {
	mkdirSync(join(dir, "projects", inst.projectHash ?? "_", "instincts"), {
		recursive: true,
	});
	writeFileSync(
		join(dir, "projects", inst.projectHash ?? "_", "instincts", `${inst.id}.json`),
		JSON.stringify(inst),
	);
}

/** mock streamFn for instinct integration tests：复用 makeMockStreamFn 风格。 */
function mockStreamFn(text = "ok") {
	return makeMockStreamFn(text);
}

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
			const received: HarnessEvent[] = [];
			events.on("compaction_error", (e) => received.push(e));
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
			const received: HarnessEvent[] = [];
			events.on("compaction_error", (e) => received.push(e));
			const ac = new AbortController();
			const compactor = createCompactor();
			// 关键：generateSummary 在 compact await 内部延迟 abort 后抛 AbortError，
			// 使 abort 落在 maybeCompact 的 try 块里（而非 prompt 的前置 abort 检查），
			// 从而真正驱动 catch 分支（harness.ts:407-411）。
			let generateSummaryCalled = false;
			const compactorDeps = {
				generateSummary: async (_m: unknown, signal?: AbortSignal) => {
					generateSummaryCalled = true;
					await new Promise((r) => setTimeout(r, 10));
					ac.abort();
					throw new DOMException("aborted", "AbortError");
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
			// 不预 abort：让 prompt 正常进入 maybeCompact，abort 在 generateSummary 内部触发。
			// maybeCompact catch 见 signal.aborted===true 静默 return（不 emit）。
			// prompt 的 abort 检查在 maybeCompact 之前（harness.ts:260，waitForIdle 后立即判），
			// 此处 abort 落在 maybeCompact 内部，已越过该检查，故 prompt 正常 resolve。
			await harness.prompt("hi", ac.signal);
			// 证明 catch 分支确被执行（generateSummary 被调到 = maybeCompact try 块已进入）。
			expect(generateSummaryCalled).toBe(true);
			// abort 非治理失败，不 emit compaction_error。
			expect(received).toHaveLength(0);
		});
	});

	describe("compaction end-to-end integration (Slice 2.5 T7)", () => {
		it("end-to-end: multi-turn over threshold triggers compaction + context_budget", async () => {
			const events = createEventBus();
			const seen: HarnessEvent[] = [];
			events.on("*", (e) => seen.push(e));
			const session = createMemorySession();
			const compactor = createCompactor();
			const compactorDeps = { generateSummary: async () => "SUMMARY" };
			// 阈值调整说明（对齐真实行为，非 brief 字面值 10/50）：
			// - compactionTokenThreshold: 5。estimateTokens 每条 min 1 token（chars/4）。
			//   turn1 = [user "turn1"(2), assistant "reply"(2)] = 4 tokens < 5 → 不触发；
			//   turn2 累计 [turn1, reply, turn2, reply] = 8 tokens > 5 → 触发 compaction。
			//   brief 的 10 在 2 turn 短消息下永不超阈值，故降至 5。
			// - modelContextWindow: 8。maybeAuditBudget 在 maybeCompact 之后跑：turn2 压缩后
			//   messages = [summary(~9 tokens), user "turn2"(2), assistant "reply"(2)]，
			//   total ~14 > 8 且 history 占比 > 0.8 → emit context_budget。
			//   brief 的 50 在压缩后 total ~14 < 50 且占比 < 0.8 → 不触发，故降至 8。
			const harness = new AgentForgeHarness({
				session,
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: "",
				compactor,
				compactorDeps,
				compactionTokenThreshold: 5,
				modelContextWindow: 8,
				streamFn: makeMockStreamFn("reply"), // user→assistant "reply"
			});
			await harness.prompt("turn1");
			await harness.prompt("turn2");

			const compactionEvents = seen.filter((e) => e.type === "compaction");
			const budgetEvents = seen.filter((e) => e.type === "context_budget");
			expect(compactionEvents.length).toBe(1);
			expect((compactionEvents[0] as any).summary).toBe("SUMMARY");
			// messages 被替换为 [summary, ...kept]：summary 作为 user 消息注入，
			// content 形如 "[Previous context summary]\nSUMMARY"（见 harness.ts maybeCompact）。
			const msgs = harness.agent.state.messages;
			expect(msgs[0]).toMatchObject({ role: "user" });
			expect((msgs[0] as any).content).toContain("[Previous context summary]");
			// 保留区应含 turn2 的 user + assistant（切点对齐 turn 边界，turn1 被压缩）。
			expect(msgs.length).toBeGreaterThanOrEqual(2);
			expect(budgetEvents.length).toBe(1);
			expect((budgetEvents[0] as any).type).toBe("context_budget");
		});
	});

	describe("persistent compaction failure (Slice 2.5 T8)", () => {
		it("persistent compaction failure: context_budget fires when total exceeds window", async () => {
			const events = createEventBus();
			const seen: HarnessEvent[] = [];
			events.on("*", (e) => seen.push(e));
			const compactor = createCompactor();
			// generateSummary 每次都抛错：maybeCompact catch emit compaction_error 不 rethrow，
			// messages 不被替换 → 历史每 turn 持续膨胀。maybeAuditBudget 在 maybeCompact 之后
			// 仍执行（harness.ts:271→277），历史超 window 时 emit context_budget。
			const compactorDeps = {
				generateSummary: async () => {
					throw new Error("always fails");
				},
			};
			// 阈值说明（对齐真实行为，非 brief 字面值 10/50）：
			// - compactionTokenThreshold: 0。强制每 turn shouldCompact=true → compact → 抛错。
			//   brief 的 10 在短消息下未必每 turn 触发，0 确保连续失败。
			// - modelContextWindow: 8。estimateTokens: "turnN"(5 chars)=2, "reply"(5)=2。
			//   turn0=[u,a]=4 tokens, maybeAuditBudget: 4>8? 否, history 4/8=0.5<0.8 → 不 emit。
			//   turn1=[u,a,u,a]=8, maybeAuditBudget: history 8/8=1.0>0.8 → suggestion → emit。
			//   turn2=[u,a,u,a,u,a]=12, maybeAuditBudget: total 12>8 → emit。
			//   brief 的 50 在 3 turn 短消息下 total 最大 ~12 < 50 → 永不超窗口，故降至 8。
			//   断言 filter total>8（非 brief 字面 50）以匹配真实 window。
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
				modelContextWindow: 8,
				streamFn: makeMockStreamFn("reply"),
			});
			for (let i = 0; i < 3; i++) await harness.prompt(`turn${i}`);

			// 连续失败：每 turn emit 一次 compaction_error（3 turn = 3 次）。
			const compactionErrors = seen.filter((e) => e.type === "compaction_error");
			expect(compactionErrors).toHaveLength(3);
			expect((compactionErrors[0] as CompactionErrorEvent).error).toBe("always fails");
			// 历史未被压缩替换：3 turn × (user+assistant) = 6 条消息。
			expect(harness.agent.state.messages.length).toBe(6);
			// context_budget 在历史膨胀后 fire：至少一次 total > window(8)。
			const budgetEvents = seen.filter((e) => e.type === "context_budget");
			const overWindow = budgetEvents.filter((e: any) => e.total > 8);
			expect(overWindow.length).toBeGreaterThanOrEqual(1);
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

describe("harness instinct integration", () => {
	it("apply: constructs agent with instinct block in systemPrompt", () => {
		const dir = mkdtempSync(join(tmpdir(), "h-inst-"));
		const inst: Instinct = {
			id: "x",
			trigger: "when t",
			action: "do a",
			confidence: 0.7,
			domain: "x",
			scope: "project",
			projectHash: "abc",
			evidence: [],
			createdAt: 1,
			updatedAt: 1,
		};
		writeInstinct(dir, inst);
		const instinct = createInstinctStore({ projectHash: "abc", dataDir: dir });
		const h = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools: [],
			provider: "xiaomi-token-plan-cn",
			model: "mimo-v2.5-pro",
			systemPrompt: "BASE",
			streamFn: mockStreamFn(),
			instinct,
		});
		expect(h.agent.state.systemPrompt).toContain("BASE");
		expect(h.agent.state.systemPrompt).toContain("<learned_instincts>");
		expect(h.instinctStore).toBe(instinct);
	});

	it("apply filters confidence>=0.5 + cap 20 (sort desc, none below 0.5)", () => {
		const dir = mkdtempSync(join(tmpdir(), "h-cap-"));
		const now = Date.now();
		// 25 instincts: 5 with confidence below 0.5 (0.3, 0.35, 0.4, 0.45, 0.49)
		// + 20 with confidence >= 0.5 ranging 0.50..0.90 (step 0.02 → 21 values, take 20).
		const below: Instinct[] = [];
		for (let i = 0; i < 5; i++) {
			const c = 0.3 + i * 0.05;
			const id = `below-${i}`;
			below.push({
				id,
				trigger: `when below ${i}`,
				action: `skip ${i}`,
				confidence: c,
				domain: "testing",
				scope: "project",
				projectHash: "abc",
				evidence: [],
				createdAt: now,
				updatedAt: now,
			});
		}
		const above: Instinct[] = [];
		// 20 instincts with confidence 0.50..0.90 step ~0.02 (20 distinct values).
		for (let i = 0; i < 20; i++) {
			const c = 0.5 + (i * 0.4) / 19; // 0.50 .. 0.90 inclusive
			const id = `above-${i}`;
			above.push({
				id,
				trigger: `when above ${i}`,
				action: `do ${i}`,
				confidence: c,
				domain: "testing",
				scope: "project",
				projectHash: "abc",
				evidence: [],
				createdAt: now,
				updatedAt: now,
			});
		}
		for (const inst of [...below, ...above]) writeInstinct(dir, inst);

		const instinct = createInstinctStore({ projectHash: "abc", dataDir: dir });
		const h = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools: [],
			provider: "xiaomi-token-plan-cn",
			model: "mimo-v2.5-pro",
			systemPrompt: "BASE",
			streamFn: mockStreamFn(),
			instinct,
		});
		const prompt = h.agent.state.systemPrompt;
		// block present
		expect(prompt).toContain("<learned_instincts>");
		// none of the below-0.5 instincts injected
		for (const b of below) {
			expect(prompt).not.toContain(b.trigger);
		}
		// exactly 20 of the above instincts injected (all of them, since 20 >= 0.5)
		let injectedCount = 0;
		for (const a of above) {
			if (prompt.includes(a.trigger)) injectedCount++;
		}
		expect(injectedCount).toBe(20);
		// Cap 20: even if 25 qualified, only 20 lines in the block.
		const blockMatch = prompt.match(/<learned_instincts>([\s\S]*?)<\/learned_instincts>/);
		expect(blockMatch).not.toBeNull();
		const lines = (blockMatch![1] as string).trim().split("\n").filter(Boolean);
		expect(lines.length).toBe(20);
		// Sorted desc by confidence: first line's trigger should be the highest-confidence one (above-19, 0.90).
		const highest = above[above.length - 1];
		expect(lines[0]).toContain(highest.trigger);
	});

	it("observe: emit tool_execution_end → observations.jsonl grows", () => {
		const dir = mkdtempSync(join(tmpdir(), "h-obs-"));
		const instinct = createInstinctStore({ projectHash: "abc", dataDir: dir });
		const events = createEventBus();
		new AgentForgeHarness({
			session: createMemorySession(),
			events,
			tools: [],
			provider: "xiaomi-token-plan-cn",
			model: "mimo-v2.5-pro",
			systemPrompt: "BASE",
			streamFn: mockStreamFn(),
			instinct,
		});
		// Slice 4-B T10 prefer-args 去重：无 args 的 tool_execution_end 被跳过（pi 原生事件无 args，
		// 仅 harness afterToolCall emit 带 args）。此集成测试须发带 args 事件才会落盘 observations.jsonl。
		events.emit({
			type: "tool_execution_end",
			toolCallId: "1",
			toolName: "bash",
			args: { command: "ls -la" },
			result: {},
			isError: false,
		} as any);
		const lines = readFileSync(
			join(dir, "projects", "abc", "observations.jsonl"),
			"utf-8",
		).trim();
		expect(lines).toBeTruthy();
		const parsed = JSON.parse(lines.split("\n")[0] as string);
		expect(parsed.kind).toBe("tool_call");
		expect(parsed.data.toolName).toBe("bash");
		expect(parsed.data.argsSummary).toContain("ls -la");
	});

	it("afterToolCall emit tool_execution_end 含 args(AfterToolCallContext.args)", async () => {
		const events = createEventBus();
		const emitted: any[] = [];
		events.on("*", (e) => emitted.push(e));
		// read tool:接收 {path}，返回文本结果。
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "read a file",
			parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as any,
			execute: async () => ({
				content: [{ type: "text", text: "file-content" }],
				details: {},
			}),
		};
		// mockStreamFn：第一次调用返回带 toolCall block 的 assistant message（stopReason "toolUse"），
		// 后续调用返回纯文本 stop 消息，避免 agent loop 死循环。
		let callCount = 0;
		const toolCallStreamFn = () => {
			callCount++;
			const stream = new AssistantMessageEventStream();
			const message: AssistantMessage = callCount === 1
				? {
						role: "assistant",
						content: [
							{ type: "toolCall", id: "tc-1", name: "read", arguments: { path: "x" } },
						],
						api: "anthropic" as any,
						provider: "anthropic",
						model: "claude-sonnet-4-5",
						usage: {
							input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "toolUse",
						timestamp: Date.now(),
					}
				: makeAssistantMessage("done");
			const startEvent: AssistantMessageEvent = { type: "start", partial: message };
			const doneEvent: AssistantMessageEvent = {
				type: "done",
				reason: callCount === 1 ? "toolUse" : "stop",
				message,
			};
			queueMicrotask(() => {
				stream.push(startEvent);
				stream.push(doneEvent);
			});
			return stream;
		};
		const h = new AgentForgeHarness({
			session: createMemorySession(),
			events,
			tools: [readTool],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt: "BASE",
			streamFn: toolCallStreamFn,
		});
		await h.prompt("读 x");
		const toolEv = emitted.find((e) => e.type === "tool_execution_end");
		expect(toolEv).toBeDefined();
		expect(toolEv.args).toEqual({ path: "x" }); // args 非空,深等于工具参数
	});

	it("extract() delegates to instinctStore.extract()", async () => {
		const dir = mkdtempSync(join(tmpdir(), "h-ext-"));
		const instinct = createInstinctStore({
			projectHash: "abc",
			dataDir: dir,
			extractRun: async () => [],
		});
		const spy = vi.spyOn(instinct, "extract").mockResolvedValue();
		const h = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools: [],
			provider: "xiaomi-token-plan-cn",
			model: "mimo-v2.5-pro",
			systemPrompt: "BASE",
			streamFn: mockStreamFn(),
			instinct,
		});
		await h.extract();
		expect(spy).toHaveBeenCalled();
	});

	it("maybeAuditBudget passes baseSystemPrompt + memory (no double count)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "h-budget-"));
		const inst: Instinct = {
			id: "mem",
			trigger: "when mem",
			action: "use memory",
			confidence: 0.8,
			domain: "workflow",
			scope: "project",
			projectHash: "abc",
			evidence: [],
			createdAt: 1,
			updatedAt: 1,
		};
		writeInstinct(dir, inst);
		const instinct = createInstinctStore({ projectHash: "abc", dataDir: dir });
		const BASE = "BASE_PROMPT_FOR_BUDGET";
		const expectedBlock = formatInstinctsForSystemPrompt([inst]);
		const expectedSystemTokens = estimateStringTokens(BASE);
		const expectedMemoryTokens = estimateStringTokens(expectedBlock);

		const events = createEventBus();
		const seen: any[] = [];
		events.on("context_budget", (e) => seen.push(e));
		const harness = new AgentForgeHarness({
			session: createMemorySession(),
			events,
			tools: [],
			provider: "xiaomi-token-plan-cn",
			model: "mimo-v2.5-pro",
			systemPrompt: BASE,
			streamFn: mockStreamFn("reply"),
			instinct,
			// 极小窗口强制 emit context_budget 事件（history 短但 total 仍可能不超；
			// modelContextWindow + history 占比阈值触发 history suggestion）。
			modelContextWindow: 4,
		});
		await harness.prompt("hi");

		// 至少触发一次 context_budget。
		expect(seen.length).toBeGreaterThanOrEqual(1);
		const evt = seen[0];
		expect(evt.type).toBe("context_budget");
		// systemPrompt 组件 == estimate(BASE)，不含 instinct block（避免双重计数）。
		expect(evt.components.systemPrompt).toBe(expectedSystemTokens);
		// memory 组件 == estimate(block)。
		expect(evt.components.memory).toBe(expectedMemoryTokens);
		// agent 实际 systemPrompt 仍是 BASE + block（apply 注入）。
		expect(harness.agent.state.systemPrompt).toContain(BASE);
		expect(harness.agent.state.systemPrompt).toContain("<learned_instincts>");
	});
});

