/**
 * loop-mode:argv 解析 + 构造默认 LoopDeps + 接 santa + 跑 LoopRunner(spec §4.8)。
 *
 * runLoopMode(argv, opts):parseLoopArgs → 强制至少一个退出条件(默认 maxRuns=1,
 * 防 anti-pattern 1)→ 构造 DryRunGitOps/LocalBuildGate/InProcessAgentRunner/
 * FileSharedTaskNotes [+ createSantaVerifier if --review] → LoopRunner.run → 返 LoopResult。
 *
 * tools 由调用方(index.ts)注入,复用 cli 现有 tools 构造(见 print-mode.ts);
 * 默认 [](reply-only,验骨架)。safety 同理(默认不注入,ask 降级 deny)。
 */
import { join } from "node:path";
import { DryRunGitOps } from "./git-ops.js";
import { LocalBuildGate } from "./gate.js";
import { InProcessAgentRunner } from "./agent-runner.js";
import { FileSharedTaskNotes } from "./shared-task-notes.js";
import { LoopRunner } from "./loop-runner.js";
import type { ReviewGate } from "./loop-runner.js";
import type { ExitConditionConfig } from "./exit-condition.js";
import type { LoopResult } from "./loop-runner.js";
import { createSantaVerifier } from "@agentforge/harness";
import type { Rubric } from "@agentforge/harness";

export interface LoopModeOptions {
	prompt?: string;
	getApiKey: (provider: string) => string | Promise<string | undefined>;
	provider: string;
	model: string;
	cwd?: string;
	streamFn?: any;
	tools?: any[];
	safety?: any;
	systemPrompt?: string;
}

export interface ParsedLoopArgs {
	prompt?: string;
	maxRuns?: number;
	maxCost?: number;
	maxDurationMs?: number;
	completionSignal?: string;
	completionThreshold?: number;
	review?: boolean;
	gateCommands?: string[];
	provider?: string;
	model?: string;
}

export function parseLoopArgs(argv: string[]): ParsedLoopArgs {
	const r: ParsedLoopArgs = {};
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--prompt": r.prompt = argv[++i]; break;
			case "--max-runs": r.maxRuns = Number(argv[++i]); break;
			case "--max-cost": r.maxCost = Number(argv[++i]); break;
			case "--max-duration": r.maxDurationMs = Number(argv[++i]); break;
			case "--completion-signal": r.completionSignal = argv[++i]; break;
			case "--completion-threshold": r.completionThreshold = Number(argv[++i]); break;
			case "--review": r.review = true; break;
			case "--gate-commands": r.gateCommands = argv[++i]?.split(","); break;
			case "--provider": r.provider = argv[++i]; break;
			case "--model": r.model = argv[++i]; break;
		}
	}
	return r;
}

const DEFAULT_REVIEW_RUBRIC: Rubric = {
	criteria: [
		"改动符合 prompt 意图",
		"不破坏现有测试/类型",
		"无明显 slop(无用类型测试/过度防御)",
	],
};

export async function runLoopMode(argv: string[], opts: LoopModeOptions): Promise<LoopResult> {
	const parsed = parseLoopArgs(argv);
	const cwd = opts.cwd ?? process.cwd();
	const prompt = parsed.prompt ?? opts.prompt;
	if (!prompt) throw new Error("loop mode requires --prompt");

	const provider = parsed.provider ?? opts.provider;
	const model = parsed.model ?? opts.model;

	const exit: ExitConditionConfig = {
		maxRuns: parsed.maxRuns,
		maxCost: parsed.maxCost,
		maxDurationMs: parsed.maxDurationMs,
		completionSignal: parsed.completionSignal,
		completionThreshold: parsed.completionThreshold,
	};
	// 强制至少一个退出条件(默认 maxRuns=1,防 anti-pattern 1)。
	const hasExit =
		exit.maxRuns != null ||
		exit.maxCost != null ||
		exit.maxDurationMs != null ||
		exit.completionSignal != null;
	if (!hasExit) exit.maxRuns = 1;

	const gitOps = new DryRunGitOps({ cwd });
	const gate = new LocalBuildGate({ cwd, commands: parsed.gateCommands });
	const agentRunner = new InProcessAgentRunner({
		provider,
		model,
		getApiKey: opts.getApiKey,
		tools: opts.tools ?? [],
		systemPrompt: opts.systemPrompt ?? "",
		streamFn: opts.streamFn,
		safety: opts.safety,
		cwd,
	});
	const notes = new FileSharedTaskNotes({ dir: join(cwd, ".agentforge", "loop") });

	let review: ReviewGate | undefined;
	if (parsed.review) {
		const verifier = createSantaVerifier({
			provider,
			model,
			getApiKey: opts.getApiKey,
			streamFn: opts.streamFn,
			cwd,
		});
		review = { rubric: DEFAULT_REVIEW_RUBRIC, verifier };
	}

	const runner = new LoopRunner({ prompt, exit, review, cwd }, { gitOps, gate, agentRunner, notes });
	return runner.run();
}
