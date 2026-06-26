import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runTask, runSuite } from "./runner.js";
import type { Task, EvalConfig, SuiteResult, TaskResult } from "./types.js";

/**
 * Slice 7 eval 包 runner 测试(spec §4.2 / plan Task 3)。
 *
 * runTask(task, config, sandbox):setup → 构造 AgentForgeHarness(mock streamFn)→
 * harness.prompt(task.prompt) → 提取 reply(最后 AssistantMessage content text join)/
 * tokensIn(usage.input)/tokensOut(usage.output)/cost(usage.cost.total)/wallClockMs →
 * runAcceptance(checks, sandbox, reply) → teardown → TaskResult。
 *
 * 数据源断言(red-team 🟡 2/3):reply/tokens/cost 全部从 harness.agent.state.messages
 * 最后 AssistantMessage 提取,harness.prompt() 返 void。
 */
/** 构造一个带 usage 的合法 AssistantMessage(模块级,供 runTask/runSuite 共用)。 */
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
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: usage.costTotal,
			},
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

const config: EvalConfig = {
	name: "test-config",
	provider: "anthropic",
	model: "claude-sonnet-4-5",
	systemPrompt: "you are a test agent",
};

describe("runTask", () => {
	let sandbox: string;

	beforeEach(() => {
		sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "eval-runner-"));
	});

	afterEach(() => {
		fs.rmSync(sandbox, { recursive: true, force: true });
	});

	it("提取 reply / tokensIn / tokensOut / cost / wallClockMs 并 passed=true(acceptance 全过)", async () => {
		const setupSpy = vi.fn<(s: string) => Promise<void>>().mockResolvedValue(undefined);
		const teardownSpy = vi.fn<(s: string) => Promise<void>>().mockResolvedValue(undefined);
		// setup 写一个文件,acceptance 验其内容
		const task: Task = {
			id: "t1",
			prompt: "给 a.ts 顶部加 // edited",
			acceptanceChecks: [
				{ kind: "file-contains", path: "a.ts", contains: "// edited" },
			],
			setup: async (s: string) => {
				fs.writeFileSync(path.join(s, "a.ts"), "// edited\ncode\n");
			},
			teardown: teardownSpy,
		};

		const streamFn = makeMockStreamFn("done editing a.ts", {
			input: 42,
			output: 7,
			costTotal: 0.0123,
		});

		const result = await runTask(task, config, sandbox, { streamFn });

		// reply:最后 AssistantMessage content text join
		expect(result.taskId).toBe("t1");
		expect(result.reply).toBe("done editing a.ts");
		// tokensIn:usage.input
		expect(result.tokensIn).toBe(42);
		// tokensOut:usage.output
		expect(result.tokensOut).toBe(7);
		// cost:usage.cost.total
		expect(result.cost).toBeCloseTo(0.0123, 6);
		// wallClockMs:正数(包了 await harness.prompt)
		expect(result.wallClockMs).toBeGreaterThanOrEqual(0);
		// passed:acceptance 全过
		expect(result.passed).toBe(true);
		expect(result.error).toBeUndefined();
		// setup 在 prompt 前跑、teardown 在 acceptance 后跑
		expect(setupSpy).not.toHaveBeenCalled(); // task 用 inline setup,setupSpy 未注入
		expect(teardownSpy).toHaveBeenCalledTimes(1);
		expect(teardownSpy).toHaveBeenCalledWith(sandbox);
	});

	it("acceptance 不过 → passed=false(仍提取 reply/usage)", async () => {
		const task: Task = {
			id: "t2",
			prompt: "加注释",
			acceptanceChecks: [
				{ kind: "file-contains", path: "a.ts", contains: "// edited" }, // 文件不存在
			],
		};

		const streamFn = makeMockStreamFn("reply text", {
			input: 10,
			output: 5,
			costTotal: 0.001,
		});

		const result = await runTask(task, config, sandbox, { streamFn });

		expect(result.reply).toBe("reply text");
		expect(result.tokensIn).toBe(10);
		expect(result.tokensOut).toBe(5);
		expect(result.cost).toBeCloseTo(0.001, 6);
		expect(result.passed).toBe(false);
	});

	it("setup 在 prompt 前执行(写文件 → acceptance 见到 setup 产物)", async () => {
		const task: Task = {
			id: "t3",
			prompt: "读 package.json 报告 name",
			acceptanceChecks: [
				{ kind: "file-exists", path: "package.json" },
			],
			setup: async (s: string) => {
				fs.writeFileSync(path.join(s, "package.json"), '{"name":"x"}');
			},
		};

		const streamFn = makeMockStreamFn("name is x", {
			input: 3,
			output: 2,
			costTotal: 0,
		});

		const result = await runTask(task, config, sandbox, { streamFn });

		expect(result.passed).toBe(true); // setup 写的文件被 acceptance 见到
	});

	it("teardown 总被调用(即使 acceptance 不过)", async () => {
		const teardownSpy = vi.fn<(s: string) => Promise<void>>().mockResolvedValue(undefined);
		const task: Task = {
			id: "t4",
			prompt: "p",
			acceptanceChecks: [
				{ kind: "file-exists", path: "nope.json" }, // 不过
			],
			teardown: teardownSpy,
		};

		const streamFn = makeMockStreamFn("r", { input: 1, output: 1, costTotal: 0 });

		await runTask(task, config, sandbox, { streamFn });

		expect(teardownSpy).toHaveBeenCalledTimes(1);
	});

	it("reply 为多 text block 时 join", async () => {
		// 多 text content block 的 AssistantMessage
		function makeMultiTextStreamFn() {
			return () => {
				const stream = new AssistantMessageEventStream();
				const message: AssistantMessage = {
					role: "assistant",
					content: [
						{ type: "text", text: "part1" },
						{ type: "text", text: "part2" },
					],
					api: "anthropic" as any,
					provider: "anthropic",
					model: "claude-sonnet-4-5",
					usage: {
						input: 5,
						output: 5,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 10,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				};
				const startEvent: AssistantMessageEvent = { type: "start", partial: message };
				const doneEvent: AssistantMessageEvent = { type: "done", reason: "stop", message };
				queueMicrotask(() => {
					stream.push(startEvent);
					stream.push(doneEvent);
				});
				return stream;
			};
		}

		const task: Task = {
			id: "t5",
			prompt: "p",
			acceptanceChecks: [],
		};

		const result = await runTask(task, config, sandbox, {
			streamFn: makeMultiTextStreamFn(),
		});

		expect(result.reply).toBe("part1part2");
		expect(result.cost).toBeCloseTo(0.5, 6);
	});
});

/**
 * runSuite 测试(spec §4.2 / plan Task 4)。
 *
 * runSuite(tasks, config, opts?):跑全部 task,聚合 metrics → SuiteResult。
 * - repeats 默认 1;repeats=N 每 task 跑 N 次收集 TaskResult[]
 * - metrics:completionRate(passed/total)/totalTokens(sum)/totalCost(sum)/avgWallClockMs(mean)
 * - pass3:repeats≥3 时填(任一 run 通过率);repeats=1 时 pass1=completionRate,pass3 undefined
 */
describe("runSuite", () => {
	let sandbox: string;

	beforeEach(() => {
		sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "eval-suite-"));
	});

	afterEach(() => {
		fs.rmSync(sandbox, { recursive: true, force: true });
	});

	/** 构造一个 task:setup 写文件,acceptance file-contains 验内容(→ passed=true)。 */
	function makePassingTask(
		id: string,
		usage: { input: number; output: number; costTotal: number },
	): Task {
		return {
			id,
			prompt: `p-${id}`,
			acceptanceChecks: [{ kind: "file-contains", path: "a.ts", contains: "// edited" }],
			setup: async (s: string) => {
				fs.writeFileSync(path.join(s, "a.ts"), "// edited\n");
			},
			tools: [],
		};
	}

	it("repeats=1(默认):2 task 聚合 metrics(completionRate/totalTokens/totalCost/avgWallClockMs)", async () => {
		const tasks: Task[] = [
			makePassingTask("t1", { input: 0, output: 0, costTotal: 0 }),
			makePassingTask("t2", { input: 0, output: 0, costTotal: 0 }),
		];

		// runSuite 注入 streamFn(透传给 runTask)。mock 每 run 发 fixed usage:
		// input=20,output=12,costTotal=0.05。2 task × 1 repeat = 2 runs。
		// → totalTokens = (20+12)*2 = 64,totalCost = 0.05*2 = 0.1。
		const result: SuiteResult = await runSuite(tasks, config, {
			repeats: 1,
			sandboxDir: sandbox,
			streamFn: makeMockStreamFn("done", { input: 20, output: 12, costTotal: 0.05 }),
		});

		expect(result.config).toBe(config);
		expect(result.results).toHaveLength(2);
		// 两 task 均通过 → completionRate 1.0
		expect(result.metrics.completionRate).toBe(1.0);
		expect(result.metrics.pass1).toBe(1.0);
		expect(result.metrics.pass3).toBeUndefined(); // repeats<3
		// totalTokens = sum(tokensIn+tokensOut) over 2 runs = 32*2 = 64
		expect(result.metrics.totalTokens).toBe(64);
		// totalCost = sum(cost) = 0.05*2 = 0.1
		expect(result.metrics.totalCost).toBeCloseTo(0.1, 6);
		// avgWallClockMs = mean(wallClockMs) 非负
		expect(result.metrics.avgWallClockMs).toBeGreaterThanOrEqual(0);
	});

	it("repeats=3:每 task 跑 3 次,pass3=任一通过率(results 长度=tasks*repeats)", async () => {
		const tasks: Task[] = [
			makePassingTask("t1", { input: 0, output: 0, costTotal: 0 }),
		];

		// mock 每 run 发 input=5,output=5,costTotal=0.1。1 task × 3 repeats = 3 runs。
		const result: SuiteResult = await runSuite(tasks, config, {
			repeats: 3,
			sandboxDir: sandbox,
			streamFn: makeMockStreamFn("done", { input: 5, output: 5, costTotal: 0.1 }),
		});

		// 每 task 跑 3 次 → results 长度 = 1*3 = 3
		expect(result.results).toHaveLength(3);
		// 单 task 全过 → pass3=1.0(任一通过)
		expect(result.metrics.pass3).toBe(1.0);
		// completionRate 仍 = passed/total runs = 3/3 = 1.0
		expect(result.metrics.completionRate).toBe(1.0);
		// totalTokens = sum over 3 runs = (5+5)*3 = 30
		expect(result.metrics.totalTokens).toBe(30);
		// totalCost = 0.1 * 3 = 0.3
		expect(result.metrics.totalCost).toBeCloseTo(0.3, 6);
	});

	it("部分 task 不过 → completionRate < 1.0,pass1 反映单跑通过率", async () => {
		// t1 通过(setup 写文件);t2 不过(无 setup,acceptance file-contains 找不到文件)
		const t1 = makePassingTask("t1", { input: 1, output: 1, costTotal: 0.01 });
		const t2: Task = {
			id: "t2",
			prompt: "p-t2",
			acceptanceChecks: [{ kind: "file-contains", path: "missing.ts", contains: "x" }],
		};
		const tasks: Task[] = [t1, t2];

		const result: SuiteResult = await runSuite(tasks, config, {
			repeats: 1,
			sandboxDir: sandbox,
			streamFn: makeMockStreamFn("r", { input: 0, output: 0, costTotal: 0 }),
		});

		// 1/2 通过 → completionRate 0.5
		expect(result.metrics.completionRate).toBe(0.5);
		expect(result.metrics.pass1).toBe(0.5);
		expect(result.metrics.pass3).toBeUndefined();
		expect(result.results).toHaveLength(2);
		// t1 passed, t2 not
		expect(result.results.find((r) => r.taskId === "t1")?.passed).toBe(true);
		expect(result.results.find((r) => r.taskId === "t2")?.passed).toBe(false);
	});
});

/**
 * Task 8 real-harness smoke test(red-team ⚪ 8:mock 保真)。
 *
 * 区别于上面 runTask 的 makeAssistantMessage(手搓 usage 字段、api 用 as any):
 * 此 smoke test 直接构造一个 **类型化为真实 pi-ai `Usage`** 的 usage 对象(无 as any
 * cast,字段与 pi-ai types.d.ts:189-204 完全一致,含 cacheWrite1h 可选字段),并构造
 * 完整 AssistantMessage,验 runTask 的完整提取路径 prompt → harness.prompt(void) →
 * harness.agent.state.messages → last AssistantMessage → usage.{input/output/cost.total}。
 *
 * 关键断言:
 * - reply:从 content text block 提取(过滤 thinking/toolCall)
 * - tokensIn === usage.input、tokensOut === usage.output
 * - cost === usage.cost.total(pi 预算,不重算)
 * - wallClockMs >= 0(包了 await harness.prompt)
 * - passed:acceptance 全过
 *
 * 此 test 若 runner.ts 提取路径回归(如改用 harness 返回值、或 usage 字段名漂移),会
 * typecheck 失败(Usage 类型约束)或断言失败,立即暴露。
 */
describe("runTask — real-harness smoke test (Task 8, red-team ⚪ 8)", () => {
	let sandbox: string;

	beforeEach(() => {
		sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "eval-smoke-"));
	});

	afterEach(() => {
		fs.rmSync(sandbox, { recursive: true, force: true });
	});

	it("真实 pi-ai Usage 结构 → runTask 提取 reply/tokens/cost/wallClock(prompt→messages→usage)", async () => {
		// 真实 pi-ai Usage 结构(types.d.ts:189-204),无 as any,类型约束保真。
		const usage: Usage = {
			input: 1337,
			output: 42,
			cacheRead: 100,
			cacheWrite: 50,
			cacheWrite1h: 10,
			totalTokens: 1337 + 42 + 100 + 50,
			cost: {
				input: 0.004,
				output: 0.002,
				cacheRead: 0.0001,
				cacheWrite: 0.0005,
				total: 0.0066,
			},
		};

		// 构造完整 AssistantMessage:content 含一个 text block(reply 提取目标)。
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "smoke reply: edited a.ts" }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage,
			stopReason: "stop",
			timestamp: Date.now(),
		};

		// mock streamFn:产出 start + done 事件,done 携带上面构造的真实-usage AssistantMessage。
		const streamFn = () => {
			const stream = new AssistantMessageEventStream();
			const startEvent: AssistantMessageEvent = { type: "start", partial: message };
			const doneEvent: AssistantMessageEvent = { type: "done", reason: "stop", message };
			queueMicrotask(() => {
				stream.push(startEvent);
				stream.push(doneEvent);
			});
			return stream;
		};

		const task: Task = {
			id: "smoke-1",
			prompt: "给 a.ts 顶部加 // edited",
			acceptanceChecks: [
				{ kind: "file-contains", path: "a.ts", contains: "// edited" },
			],
			setup: async (s: string) => {
				fs.writeFileSync(path.join(s, "a.ts"), "// edited\ncode\n");
			},
		};

		const result = await runTask(task, config, sandbox, { streamFn });

		// reply:content text block 提取
		expect(result.taskId).toBe("smoke-1");
		expect(result.reply).toBe("smoke reply: edited a.ts");
		// tokensIn:usage.input(非 totalTokens、非 cacheRead)
		expect(result.tokensIn).toBe(1337);
		// tokensOut:usage.output
		expect(result.tokensOut).toBe(42);
		// cost:usage.cost.total(pi 预算,不重算 Model.cost)
		expect(result.cost).toBeCloseTo(0.0066, 6);
		// wallClockMs:包了 await harness.prompt,非负
		expect(result.wallClockMs).toBeGreaterThanOrEqual(0);
		// passed:acceptance 全过
		expect(result.passed).toBe(true);
		expect(result.error).toBeUndefined();
	});

	it("content 含 thinking + text block → reply 仅取 text(过滤 thinking)", async () => {
		// 真实 Usage 结构,带 cacheWrite1h 可选字段。
		const usage: Usage = {
			input: 100,
			output: 20,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 120,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 },
		};

		// content:thinking block(应被过滤)+ text block(应提取)。
		const message: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", text: "internal reasoning", signature: "sig" } as any,
				{ type: "text", text: "visible reply" },
			],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage,
			stopReason: "stop",
			timestamp: Date.now(),
		};

		const streamFn = () => {
			const stream = new AssistantMessageEventStream();
			const startEvent: AssistantMessageEvent = { type: "start", partial: message };
			const doneEvent: AssistantMessageEvent = { type: "done", reason: "stop", message };
			queueMicrotask(() => {
				stream.push(startEvent);
				stream.push(doneEvent);
			});
			return stream;
		};

		const task: Task = {
			id: "smoke-2",
			prompt: "p",
			acceptanceChecks: [],
		};

		const result = await runTask(task, config, sandbox, { streamFn });

		// reply 仅取 text block,thinking 被过滤
		expect(result.reply).toBe("visible reply");
		expect(result.tokensIn).toBe(100);
		expect(result.tokensOut).toBe(20);
		expect(result.cost).toBeCloseTo(0.001, 6);
	});
});
