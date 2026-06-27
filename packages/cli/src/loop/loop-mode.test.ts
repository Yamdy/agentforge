import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-agent-core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parseLoopArgs, runLoopMode } from "./loop-mode.js";

function makeMockStreamFn(text: string) {
	return () => {
		const stream = new AssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "anthropic" as any,
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage: {
				input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
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

function makeTempRepo(branch = "main"): string {
	const dir = mkdtempSync(join(tmpdir(), "loopmode-"));
	execSync(`git init -b ${branch}`, { cwd: dir });
	execSync('git config user.email "t@t"', { cwd: dir });
	execSync('git config user.name "t"', { cwd: dir });
	writeFileSync(join(dir, "README.md"), "init");
	execSync("git add -A && git commit -m init", { cwd: dir });
	return dir;
}

describe("parseLoopArgs", () => {
	it("解析各 flag", () => {
		const r = parseLoopArgs(["--prompt", "do x", "--max-runs", "3", "--max-cost", "0.5", "--review"]);
		expect(r.prompt).toBe("do x");
		expect(r.maxRuns).toBe(3);
		expect(r.maxCost).toBe(0.5);
		expect(r.review).toBe(true);
	});

	it("--gate-commands 逗号分隔多命令", () => {
		const r = parseLoopArgs(["--gate-commands", "pnpm -r typecheck,pnpm -r test"]);
		expect(r.gateCommands).toEqual(["pnpm -r typecheck", "pnpm -r test"]);
	});

	it("--completion-signal + --completion-threshold", () => {
		const r = parseLoopArgs(["--completion-signal", "DONE", "--completion-threshold", "2"]);
		expect(r.completionSignal).toBe("DONE");
		expect(r.completionThreshold).toBe(2);
	});

	it("--base-branch", () => {
		const r = parseLoopArgs(["--base-branch", "pi"]);
		expect(r.baseBranch).toBe("pi");
	});
});

describe("runLoopMode", () => {
	let dir: string;
	beforeEach(() => {
		dir = makeTempRepo();
	});
	afterEach(() => {
		// Windows EBUSY: git/fs 句柄偶发持锁 temp repo,rmSync fail;temp repo 在 tmpdir,OS 清,吞错不 fail test。
		try { rmSync(dir, { recursive: true, force: true }); } catch { /* EBUSY: OS cleans tmpdir */ }
	});

	it("集成:临时 repo + mock streamFn + --max-runs 1 → 1 轮 merge,stopReason max-runs", async () => {
		const result = await runLoopMode(
			["--prompt", "do x", "--max-runs", "1", "--gate-commands", 'node -e "process.exit(0)"'],
			{
				getApiKey: () => "k",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				cwd: dir,
				streamFn: makeMockStreamFn("done"),
			},
		);
		expect(result.totalRuns).toBe(1);
		expect(result.stopReason).toBe("max-runs");
		expect(result.iterations[0].merged).toBe(true);
	});

	it("无退出条件 → 默认 maxRuns=1", async () => {
		const result = await runLoopMode(
			["--prompt", "do x", "--gate-commands", 'node -e "process.exit(0)"'],
			{
				getApiKey: () => "k",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				cwd: dir,
				streamFn: makeMockStreamFn("done"),
			},
		);
		expect(result.stopReason).toBe("max-runs");
		expect(result.totalRuns).toBe(1);
	});

	it("缺 --prompt → throw", async () => {
		await expect(
			runLoopMode(["--max-runs", "1"], {
				getApiKey: () => "k",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				cwd: dir,
			}),
		).rejects.toThrow("requires --prompt");
	});

	it("--base-branch pi:repo 在 pi 分支 → 跑通 1 轮 merge", async () => {
		const piDir = makeTempRepo("pi");
		try {
			const result = await runLoopMode(
				["--prompt", "do x", "--max-runs", "1", "--base-branch", "pi", "--gate-commands", 'node -e "process.exit(0)"'],
				{
					getApiKey: () => "k",
					provider: "anthropic",
					model: "claude-sonnet-4-5",
					cwd: piDir,
					streamFn: makeMockStreamFn("done"),
				},
			);
			expect(result.totalRuns).toBe(1);
			expect(result.iterations[0].merged).toBe(true);
		} finally {
			rmSync(piDir, { recursive: true, force: true });
		}
	});
});
