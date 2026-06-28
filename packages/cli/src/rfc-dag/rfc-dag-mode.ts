/**
 * rfc-dag-mode:argv 解析 + 构造默认 RfcDagDeps + 接 santa + 跑 RfcDagRunner(spec §4.9)。
 *
 * runRfcDagMode(argv, opts):parseRfcDagArgs → readRfc(--rfc <file|->)→ 构造
 * InProcessAgentRunner(createLoopAgentDeps 复用 cli tools/systemPrompt/safety)/
 * DagDecomposer/DryRunWorktreeOps/FileRfcDagState/DryRunGitOps/LocalBuildGate
 * [+ createSantaVerifier if --review] → RfcDagRunner.run → 返 RfcDagResult。
 *
 * 类比 loop-mode:provider/model 既可从 argv(--provider/--model,Task 8 真命令路径)
 * 也可从 opts(测试注入)取,argv 优先。
 */
import { readFileSync } from "node:fs";
import { RfcDagRunner } from "./rfc-dag-runner.js";
import type { RfcDagConfig, RfcDagDeps } from "./rfc-dag-runner.js";
import { DagDecomposer } from "./dag-decomposer.js";
import { DryRunWorktreeOps } from "./worktree-pool.js";
import { FileRfcDagState } from "./rfc-dag-state.js";
import { DryRunGitOps } from "../loop/git-ops.js";
import { LocalBuildGate } from "../loop/gate.js";
import { InProcessAgentRunner } from "../loop/agent-runner.js";
import { createLoopAgentDeps } from "../loop/agent-deps.js";
import { createSantaVerifier } from "@agentforge/harness";
import type { Rubric } from "@agentforge/harness";
import type { ReviewGate } from "../loop/loop-runner.js";
import type { ExitConditionConfig } from "../loop/exit-condition.js";
import type { RfcDagResult } from "./rfc-dag-runner.js";

export interface RfcDagModeOptions {
	rfc?: string;               // --rfc <file|->(- 从 stdin);argv 优先
	maxRuns?: number;
	maxCost?: number;
	maxDurationMs?: number;
	review?: boolean;
	maxUnitRetries?: number;
	baseBranch?: string;
	gateCommands?: string[];
	getApiKey: (provider: string) => string | Promise<string | undefined>;
	// provider/model:argv(--provider/--model)优先,opts 为回退默认。index.ts 路由传占位默认
	// (真值来自 argv);测试直接注入真实 provider/model。
	provider: string;
	model: string;
	cwd?: string;
	streamFn?: any;
}

export interface ParsedRfcDagArgs {
	rfc: string;
	maxRuns?: number;
	maxCost?: number;
	maxDurationMs?: number;
	review?: boolean;
	maxUnitRetries?: number;
	baseBranch?: string;
	gateCommands?: string[];
	provider?: string;
	model?: string;
}

export function parseRfcDagArgs(argv: string[]): ParsedRfcDagArgs {
	const out: ParsedRfcDagArgs = { rfc: "" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--rfc": out.rfc = argv[++i]; break;
			case "--max-runs": out.maxRuns = Number(argv[++i]); break;
			case "--max-cost": out.maxCost = Number(argv[++i]); break;
			case "--max-duration": out.maxDurationMs = Number(argv[++i]); break;
			case "--review": out.review = true; break;
			case "--max-unit-retries": out.maxUnitRetries = Number(argv[++i]); break;
			case "--base-branch": out.baseBranch = argv[++i]; break;
			case "--gate-commands": out.gateCommands = argv[++i].split(","); break;
			case "--provider": out.provider = argv[++i]; break;
			case "--model": out.model = argv[++i]; break;
		}
	}
	if (!out.rfc) throw new Error("rfc-dag:--rfc <file|-> 必填");
	return out;
}

function readRfc(rfcArg: string, cwd: string): string {
	if (rfcArg === "-") {
		return readFileSync(0, "utf-8");   // stdin
	}
	return readFileSync(`${cwd}/${rfcArg}`, "utf-8");
}

/** review gate rubric(类比 loop-mode DEFAULT_REVIEW_RUBRIC,scope 改为 unit 语义)。 */
const DEFAULT_RFC_DAG_RUBRIC: Rubric = {
	criteria: [
		"改动符合 scope/acceptanceTests",
		"不破坏现有测试/类型",
		"无明显 slop(无用类型测试/过度防御)",
	],
};

export async function runRfcDagMode(argv: string[], opts: RfcDagModeOptions): Promise<RfcDagResult> {
	const parsed = parseRfcDagArgs(argv);
	const cwd = opts.cwd ?? process.cwd();
	// provider/model:argv 优先(--provider/--model,Task 8 真命令),否则 opts(测试注入)。
	const provider = parsed.provider ?? opts.provider;
	const model = parsed.model ?? opts.model;
	const rfc = readRfc(parsed.rfc, cwd);
	// tools 改由 toolsFactory 按 per-run cwd 重建(rfc-dag unit 执行传 cwd=worktree →
	// worktree tools;decompose 传 cwd=process.cwd() → 主 repo tools)。systemPrompt/safety 不依赖 cwd。
	const { systemPrompt, safety } = createLoopAgentDeps();
	const agentRunner = new InProcessAgentRunner({
		provider,
		model,
		getApiKey: opts.getApiKey,
		toolsFactory: (cwd: string) => createLoopAgentDeps(cwd).tools,
		systemPrompt,
		safety,
		streamFn: opts.streamFn,
	});
	// 退出条件兜底:用户省略所有 --max-* 时 checkExit 永不 stop → runaway。
	// 注入默认 maxRuns(防无界烧预算)。任一 max-* 显式给出则不覆盖(尊重用户意图)。
	const DEFAULT_RFC_DAG_MAX_RUNS = 50;
	const exit: ExitConditionConfig = {
		maxRuns: parsed.maxRuns ?? (parsed.maxCost == null && parsed.maxDurationMs == null ? DEFAULT_RFC_DAG_MAX_RUNS : undefined),
		maxCost: parsed.maxCost,
		maxDurationMs: parsed.maxDurationMs,
	};
	const config: RfcDagConfig = {
		rfc,
		exit,
		maxUnitRetries: parsed.maxUnitRetries,
		baseBranch: parsed.baseBranch,
		cwd,
	};
	if (parsed.review) {
		const review: ReviewGate = {
			rubric: DEFAULT_RFC_DAG_RUBRIC,
			verifier: createSantaVerifier({
				getApiKey: opts.getApiKey,
				provider,
				model,
				streamFn: opts.streamFn,
				cwd,
			}),
		};
		config.review = review;
	}
	const deps: RfcDagDeps = {
		gitOpsFactory: (c: string) => new DryRunGitOps({ cwd: c }),
		worktreeOps: new DryRunWorktreeOps({ cwd }),
		gateFactory: (c: string) =>
			new LocalBuildGate({
				cwd: c,
				commands: parsed.gateCommands ?? ["pnpm -r typecheck", "pnpm -r test"],
			}),
		agentRunner,
		decomposer: new DagDecomposer({ agentRunner }),
		state: new FileRfcDagState({ dir: `${cwd}/.agentforge/rfc-dag` }),
	};
	const runner = new RfcDagRunner(config, deps);
	const result = await runner.run();
	const finalVerifyLine = result.finalVerify
		? `,final-verify ${result.finalVerify.passed ? "PASS" : "FAIL"}`
		: "";
	console.log(
		`RFC-DAG 完成:${result.units.filter(u => u.status === "merged").length}/${result.units.length} unit merged,cost ${result.totalCost},stop ${result.stopReason}${finalVerifyLine}`,
	);
	return result;
}
