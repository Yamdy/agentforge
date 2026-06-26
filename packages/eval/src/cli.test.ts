/**
 * Slice 7 eval CLI 测试(spec §4.5 / plan Task 7 Step 2)。
 *
 * 覆盖:
 *  - parseArgs:--suite/--config[]/--repeats/--sandbox 解析
 *  - runCli:parseArgs + runHeadToHead(mock streamFn)→ stdout 含 markdown 表
 *      + JSON 报告写入
 *
 * 设计:runCli(argv, deps?) 注入 streamFn 避开真实 LLM;stdout 经 deps.stdout
 * 注入(可捕获);JSON 报告路径经 deps.reportPath 注入(测试用 tmpdir)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseArgs, runCli } from "./cli.js";
import type { CliDeps } from "./cli.js";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";

/** 构造带 usage 的合法 AssistantMessage(同 head-to-head.test.ts mock 模式)。 */
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

describe("parseArgs", () => {
	it("解析 --suite <dir>", () => {
		const args = parseArgs(["--suite", "/tmp/suite"]);
		expect(args.suite).toBe("/tmp/suite");
	});

	it("解析多个 --config <path>(数组)", () => {
		const args = parseArgs([
			"--suite", "/tmp/suite",
			"--config", "a.json",
			"--config", "b.json",
		]);
		expect(args.configs).toEqual(["a.json", "b.json"]);
	});

	it("解析 --repeats <n>(数字)", () => {
		const args = parseArgs([
			"--suite", "/tmp/suite",
			"--repeats", "3",
		]);
		expect(args.repeats).toBe(3);
	});

	it("解析 --sandbox <dir>", () => {
		const args = parseArgs([
			"--suite", "/tmp/suite",
			"--sandbox", "/tmp/sbx",
		]);
		expect(args.sandbox).toBe("/tmp/sbx");
	});

	it("缺 --suite 抛错", () => {
		expect(() => parseArgs([])).toThrow();
	});

	it("repeats 缺省为 1", () => {
		const args = parseArgs(["--suite", "/tmp/suite"]);
		expect(args.repeats).toBe(1);
	});
});

describe("runCli", () => {
	let sandbox: string;
	let suiteDir: string;
	let reportPath: string;
	let stdoutChunks: string[];
	const stdout = (s: string) => { stdoutChunks.push(s); };

	beforeEach(() => {
		sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cli-sbx-"));
		suiteDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cli-suite-"));
		reportPath = path.join(sandbox, "report.json");
		stdoutChunks = [];

		// suite dir:写一个 .task.cjs(动态 import 模式),导出 Task[]
		// 用 .cjs 避免需要 ts loader;runCli 用 dynamic import 加载
		fs.writeFileSync(
			path.join(suiteDir, "task.cjs"),
			`module.exports = [
				{
					id: "t1",
					prompt: "p-t1",
					acceptanceChecks: [{ kind: "file-contains", path: "a.ts", contains: "// edited" }],
					setup: function(s) {
						const fs = require("fs");
						const p = require("path");
						fs.writeFileSync(p.join(s, "a.ts"), "// edited\\n");
					},
				},
			];`,
		);

		// configs
		fs.writeFileSync(
			path.join(suiteDir, "a.json"),
			JSON.stringify({
				name: "config-a",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
			}),
		);
		fs.writeFileSync(
			path.join(suiteDir, "b.json"),
			JSON.stringify({
				name: "config-b",
				provider: "anthropic",
				model: "claude-haiku-4-5",
			}),
		);
	});

	afterEach(() => {
		fs.rmSync(sandbox, { recursive: true, force: true });
		fs.rmSync(suiteDir, { recursive: true, force: true });
	});

	it("parseArgs + runHeadToHead(mock)→ stdout 含 markdown 表 + 写 JSON 报告", async () => {
		const argv = [
			"--suite", suiteDir,
			"--config", path.join(suiteDir, "a.json"),
			"--config", path.join(suiteDir, "b.json"),
			"--sandbox", sandbox,
		];

		const deps: CliDeps = {
			streamFn: makeMockStreamFn("done", { input: 10, output: 5, costTotal: 0.03 }),
			stdout,
			reportPath,
		};

		await runCli(argv, deps);

		const out = stdoutChunks.join("");
		// stdout 含 markdown 表头
		expect(out).toContain("config");
		expect(out).toContain("completionRate");
		expect(out).toContain("totalCost");
		// 两个 config name 都在表里
		expect(out).toContain("config-a");
		expect(out).toContain("config-b");

		// JSON 报告写入磁盘
		expect(fs.existsSync(reportPath)).toBe(true);
		const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
		expect(Array.isArray(report)).toBe(true);
		expect(report).toHaveLength(2);
		expect(report[0].config.name).toBe("config-a");
		expect(report[1].config.name).toBe("config-b");
		// 每个 SuiteResult 含 metrics
		expect(report[0].metrics).toBeDefined();
		expect(report[0].metrics.completionRate).toBe(1.0);
	});

	it("单 config 也能跑 + 报告长度 1", async () => {
		const argv = [
			"--suite", suiteDir,
			"--config", path.join(suiteDir, "a.json"),
			"--sandbox", sandbox,
		];

		const deps: CliDeps = {
			streamFn: makeMockStreamFn("done", { input: 8, output: 4, costTotal: 0.02 }),
			stdout,
			reportPath,
		};

		await runCli(argv, deps);

		const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
		expect(report).toHaveLength(1);
		expect(report[0].config.name).toBe("config-a");
	});
});
