import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-agent-core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parseRfcDagArgs, runRfcDagMode } from "./rfc-dag-mode.js";

/**
 * Mock streamFn：类比 loop-mode.test.ts makeMockStreamFn，但需按 prompt 内容区分
 * decompose 调用(返合法 unit-DAG JSON 数组)与 runUnit 调用(返 "DONE")。
 *
 * InProcessAgentRunner.run(prompt) → harness.prompt(prompt) → streamFn(model, llmContext, options),
 * prompt 经 llmContext.messages 透传。decompose prompt 含 "架构分解"/"JSON 数组";
 * runUnit prompt 含 "你的工作单元"。据此分支返回不同 text。
 */
function makeDiscriminatingStreamFn() {
	return (_model: unknown, llmContext: { messages: Array<{ role: string; content: unknown }> }) => {
		const lastUser = [...llmContext.messages].reverse().find(m => m.role === "user");
		const contentText = lastUser
			? typeof lastUser.content === "string"
				? lastUser.content
				: Array.isArray(lastUser.content)
					? lastUser.content
							.map((b: { type?: string; text?: string }) => (b?.type === "text" ? b.text ?? "" : ""))
							.join("")
					: ""
			: "";
		const isDecompose = contentText.includes("架构分解") || contentText.includes("JSON 数组");
		const text = isDecompose
			? JSON.stringify([
					{
						id: "u1",
						dependsOn: [],
						scope: "add hello feature",
						acceptanceTests: ["echo hello prints hello"],
						riskLevel: 1,
						rollbackPlan: "revert the commit",
					},
				])
			: "DONE";
		const stream = new AssistantMessageEventStream();
		const message: AssistantMessage = {
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
	const dir = mkdtempSync(join(tmpdir(), "rfcdagmode-"));
	execSync(`git init -b ${branch}`, { cwd: dir });
	execSync('git config user.email "t@t"', { cwd: dir });
	execSync('git config user.name "t"', { cwd: dir });
	writeFileSync(join(dir, "README.md"), "init");
	execSync("git add -A && git commit -m init", { cwd: dir });
	return dir;
}

describe("parseRfcDagArgs", () => {
	it("解析 --rfc 文件 + --base-branch + --max-unit-retries", () => {
		const a = parseRfcDagArgs(["--rfc", "rfc.md", "--base-branch", "pi", "--max-unit-retries", "3", "--max-runs", "5"]);
		expect(a).toMatchObject({ rfc: "rfc.md", baseBranch: "pi", maxUnitRetries: 3, maxRuns: 5 });
	});

	it("--rfc - 从 stdin(标记)", () => {
		const a = parseRfcDagArgs(["--rfc", "-"]);
		expect(a.rfc).toBe("-");
	});

	it("--review flag", () => {
		expect(parseRfcDagArgs(["--rfc", "x", "--review"]).review).toBe(true);
	});

	it("缺 --rfc → throw", () => {
		expect(() => parseRfcDagArgs([])).toThrow(/rfc/);
	});
});

describe("runRfcDagMode wiring", () => {
	let dir: string;
	beforeEach(() => {
		dir = makeTempRepo("main");
		// 写一份 RFC 文件到临时 repo(不用 stdin)并提交,保持 working tree clean(RfcDagRunner 入口校验)。
		writeFileSync(
			join(dir, "rfc.md"),
			"# RFC: hello feature\n\n加一个 hello 输出。\n\n## acceptanceTests\n- echo hello prints hello",
		);
		execSync("git add -A && git commit -m rfc", { cwd: dir });
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("构造 RfcDagRunner + 跑 + 返 RfcDagResult(mock streamFn 区分 decompose/runUnit)", async () => {
		const result = await runRfcDagMode(
			[
				"--rfc",
				"rfc.md",
				"--max-runs",
				"5",
				"--base-branch",
				"main",
				"--gate-commands",
				'node -e "process.exit(0)"',
			],
			{
				getApiKey: async () => "k",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				cwd: dir,
				streamFn: makeDiscriminatingStreamFn() as any,
			},
		);
		expect(result.stopReason).toBe("all-done");
		// decompose 返 1 unit(u1),runUnit 应 merge 成功 → 1/1 merged
		expect(result.units.filter(u => u.status === "merged").length).toBe(1);
		expect(result.units.length).toBeGreaterThanOrEqual(1);
	});
});
