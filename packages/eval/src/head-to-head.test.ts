import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runHeadToHead, compare } from "./head-to-head.js";
import type {
	EvalConfig,
	SuiteResult,
	Task,
	TaskResult,
	Metrics,
} from "./types.js";

/**
 * Slice 7 eval head-to-head 测试(spec §4.3 / plan Task 5)。
 *
 * runHeadToHead(tasks, configs, opts?):configs 各跑 runSuite → SuiteResult[]。
 * compare(results):markdown 对比表(列:config name | completionRate | totalCost | avgWallClockMs)。
 *
 * 单变量 diff(D5):两 config 仅 model 不同(mock 注入 streamFn 避开真实 LLM)。
 */

/** 构造带 usage 的合法 AssistantMessage(同 runner.test.ts mock 模式)。 */
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

/** mock streamFn:产 start + done,done 携带 usage。 */
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

/** 构造一个通过 task:setup 写 a.ts,acceptance file-contains "// edited"。 */
function makePassingTask(id: string): Task {
	return {
		id,
		prompt: `p-${id}`,
		acceptanceChecks: [{ kind: "file-contains", path: "a.ts", contains: "// edited" }],
		setup: async (s: string) => {
			fs.writeFileSync(path.join(s, "a.ts"), "// edited\n");
		},
	};
}

const configA: EvalConfig = {
	name: "config-a",
	provider: "anthropic",
	model: "claude-sonnet-4-5",
	systemPrompt: "you are a",
};

const configB: EvalConfig = {
	name: "config-b",
	provider: "anthropic",
	model: "claude-haiku-4-5", // 单变量 diff:model 不同(D5)
	systemPrompt: "you are a",
};

describe("runHeadToHead", () => {
	let sandbox: string;

	beforeEach(() => {
		sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "eval-h2h-"));
	});

	afterEach(() => {
		fs.rmSync(sandbox, { recursive: true, force: true });
	});

	it("两 config 跑同 tasks → SuiteResult[](长度=configs,各含 metrics)", async () => {
		const tasks: Task[] = [makePassingTask("t1"), makePassingTask("t2")];

		// mock 两次 config 跑不同 usage(可区分)
		// configA: input=20,output=12,costTotal=0.05(2 runs → totalCost 0.1)
		// configB: input=10,output=6,costTotal=0.02(2 runs → totalCost 0.04)
		// runHeadToHead 按 configs 顺序跑:configA 先(2 task×1 rep=2 calls),configB 后(2 calls)。
		// 用计数器区分(避免依赖 streamFn 第一参 model 的具体类型,稳健)。
		const streamFnA = makeMockStreamFn("done-a", { input: 20, output: 12, costTotal: 0.05 });
		const streamFnB = makeMockStreamFn("done-b", { input: 10, output: 6, costTotal: 0.02 });
		let callIdx = 0;
		const tasksLen = tasks.length;

		const results = await runHeadToHead(tasks, [configA, configB], {
			repeats: 1,
			sandboxDir: sandbox,
			streamFn: (..._args: unknown[]) => {
				// 前 tasksLen 次 call 属于 configA,之后 configB
				const inner = callIdx < tasksLen ? streamFnA : streamFnB;
				callIdx++;
				return inner();
			},
		});

		// 两 config → SuiteResult[] 长度 2
		expect(results).toHaveLength(2);
		expect(results[0].config).toBe(configA);
		expect(results[1].config).toBe(configB);

		// 各含 2 task × 1 repeat = 2 results
		expect(results[0].results).toHaveLength(2);
		expect(results[1].results).toHaveLength(2);

		// 两 config 均 100% 通过(completionRate 1.0)
		expect(results[0].metrics.completionRate).toBe(1.0);
		expect(results[1].metrics.completionRate).toBe(1.0);

		// totalCost 区分:configA 2*0.05=0.1,configB 2*0.02=0.04
		expect(results[0].metrics.totalCost).toBeCloseTo(0.1, 6);
		expect(results[1].metrics.totalCost).toBeCloseTo(0.04, 6);

		// totalTokens 区分:configA (20+12)*2=64,configB (10+6)*2=32
		expect(results[0].metrics.totalTokens).toBe(64);
		expect(results[1].metrics.totalTokens).toBe(32);
	});

	it("空 configs → 空 SuiteResult[]", async () => {
		const results = await runHeadToHead([makePassingTask("t1")], [], {
			sandboxDir: sandbox,
		});
		expect(results).toEqual([]);
	});

	it("单 config → 单 SuiteResult(等价 runSuite)", async () => {
		const tasks: Task[] = [makePassingTask("t1")];
		const results = await runHeadToHead(tasks, [configA], {
			repeats: 1,
			sandboxDir: sandbox,
			streamFn: () => makeMockStreamFn("done", { input: 5, output: 5, costTotal: 0.1 })(),
		});

		expect(results).toHaveLength(1);
		expect(results[0].config).toBe(configA);
		expect(results[0].metrics.totalCost).toBeCloseTo(0.1, 6);
	});
});

describe("compare", () => {
	/** 构造一个 SuiteResult(免跑 runSuite,直接 mock 结果)。 */
	function makeSuiteResult(
		name: string,
		metrics: Partial<Metrics>,
	): SuiteResult {
		const full: Metrics = {
			completionRate: metrics.completionRate ?? 0,
			pass1: metrics.pass1 ?? 0,
			totalTokens: metrics.totalTokens ?? 0,
			totalCost: metrics.totalCost ?? 0,
			avgWallClockMs: metrics.avgWallClockMs ?? 0,
			...metrics,
		};
		const config: EvalConfig = {
			name,
			provider: "anthropic",
			model: "claude-sonnet-4-5",
		};
		const results: TaskResult[] = [];
		return { config, results, metrics: full };
	}

	it("返回 markdown 表:列 config name | completionRate | totalCost | avgWallClockMs", () => {
		const results: SuiteResult[] = [
			makeSuiteResult("config-a", {
				completionRate: 1.0,
				totalCost: 0.1,
				avgWallClockMs: 500,
			}),
			makeSuiteResult("config-b", {
				completionRate: 0.5,
				totalCost: 0.04,
				avgWallClockMs: 300,
			}),
		];

		const md = compare(results);

		// markdown 表头
		expect(md).toContain("config");
		expect(md).toContain("completionRate");
		expect(md).toContain("totalCost");
		expect(md).toContain("avgWallClockMs");
		// 两 config name 都在表里
		expect(md).toContain("config-a");
		expect(md).toContain("config-b");
		// completionRate 值(1 / 0.5)
		expect(md).toContain("1");
		expect(md).toContain("0.5");
		// totalCost 值
		expect(md).toContain("0.1");
		expect(md).toContain("0.04");
		// markdown 表格分隔符
		expect(md).toContain("|");
		expect(md).toContain("---");
	});

	it("空 results → 仍返表头(无数据行)", () => {
		const md = compare([]);
		expect(md).toContain("config");
		expect(md).toContain("completionRate");
		expect(md).toContain("|");
	});

	it("含 pass3(repeats≥3)时也渲染(可选列)", () => {
		const results: SuiteResult[] = [
			makeSuiteResult("config-a", {
				completionRate: 1.0,
				pass3: 1.0,
				totalCost: 0.1,
				avgWallClockMs: 100,
			}),
		];
		const md = compare(results);
		// pass3 出现即接受(可选列,任一 result 有 pass3 时渲染)
		expect(md).toContain("config-a");
		expect(md).toContain("0.1");
	});
});
