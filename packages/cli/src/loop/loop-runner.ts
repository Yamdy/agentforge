/**
 * LoopRunner:continuous-PR 循环编排(spec §4.6 / §5)。
 *
 * 每迭代:checkExit → createBranch → checkout → notes.read → agentRunner.run →
 * (review?) → commit → gate → merge? → notes.write → checkout 基准分支。
 * 迭代级 try/catch 兜底(spec D10),error 进 notes 喂下轮(anti-pattern 3)。
 * signal 透传 agentRunner(harness.prompt(signal)→agent.abort);abort 在循环顶部检。
 *
 * 开始前:assert isClean + currentBranch===baseBranch(默认 main) + tag 回滚点(spec 🔴1)。
 * 结束(任何 stopReason):输出回滚 tag + git reset --hard 恢复提示。
 */
import { checkExit } from "./exit-condition.js";
import type { ExitConditionConfig, LoopState } from "./exit-condition.js";
import type { GitOps } from "./git-ops.js";
import type { Gate } from "./gate.js";
import type { AgentRunner } from "./agent-runner.js";
import type { SharedTaskNotes } from "./shared-task-notes.js";
import type { Rubric, SantaVerifier } from "@agentforge/harness";

export interface ReviewGate {
	rubric: Rubric;
	verifier: SantaVerifier;
}

export interface LoopConfig {
	prompt: string;
	exit: ExitConditionConfig;
	review?: ReviewGate;
	/** 默认 "continuous-pr/iter"。 */
	branchPrefix?: string;
	/** 基准分支(iter 从其切出、merge 回其);默认 "main"。单分支 repo 可传 "pi" 等。 */
	baseBranch?: string;
	/** agentRunner.run 的 cwd(plan 补,spec §4.6 漏列)。 */
	cwd: string;
}

export interface LoopDeps {
	gitOps: GitOps;
	gate: Gate;
	agentRunner: AgentRunner;
	notes: SharedTaskNotes;
}

export interface IterationResult {
	iteration: number;
	branch: string;
	reply: string;
	cost: number;
	gatePassed: boolean;
	reviewVerdict?: "nice" | "naughty";
	merged: boolean;
	error?: string;
}

export interface LoopResult {
	iterations: IterationResult[];
	totalCost: number;
	totalRuns: number;
	stopReason: string;
	rollbackTag: string;
}

export class LoopRunner {
	constructor(
		private readonly config: LoopConfig,
		private readonly deps: LoopDeps,
	) {}

	async run(signal?: AbortSignal): Promise<LoopResult> {
		const baseBranch = this.config.baseBranch ?? "main";
		// 开始前断言(spec 🔴1:防污染基准分支 + 记回滚点)。
		if (!(await this.deps.gitOps.isClean())) {
			throw new Error("working tree not clean; commit or stash before loop");
		}
		if ((await this.deps.gitOps.currentBranch()) !== baseBranch) {
			throw new Error(`loop must start on ${baseBranch} branch`);
		}
		// remote 同步断言 defer:GitOps 接口未提供方法,dry-run 无 remote 不触发;
		// future GitHub adapter 加 isMainSyncedOrNoRemote() 后补(spec §5 🟡5e)。
		const rollbackTag = `loop-rollback-${Date.now()}`;
		await this.deps.gitOps.tag(rollbackTag);

		const state: LoopState = {
			runs: 0,
			cost: 0,
			durationMs: 0,
			consecutiveCompletionSignals: 0,
			consecutiveGateFailures: 0,
		};
		const iterations: IterationResult[] = [];
		let stopReason = "";
		const branchPrefix = this.config.branchPrefix ?? "continuous-pr/iter";

		for (let iteration = 1; ; iteration++) {
			// abort 在循环顶部检(checkExit 纯函数不含 abort)。
			if (signal?.aborted) {
				stopReason = "aborted";
				break;
			}
			const exit = checkExit(state, this.config.exit);
			if (exit.stop) {
				stopReason = exit.reason;
				break;
			}

			const branch = `${branchPrefix}-${iteration}`;
			const iterResult: IterationResult = {
				iteration,
				branch,
				reply: "",
				cost: 0,
				gatePassed: false,
				merged: false,
			};
			const t0 = Date.now();
			let skipCommitMerge = false;

			try {
				await this.deps.gitOps.createBranch(branch);
				await this.deps.gitOps.checkout(branch);
				const notesContent = this.deps.notes.read();
				const { reply, cost } = await this.deps.agentRunner.run(
					buildPrompt(this.config.prompt, notesContent),
					{ cwd: this.config.cwd, signal },
				);
				iterResult.reply = reply;
				iterResult.cost = cost;

				// completion signal
				if (
					this.config.exit.completionSignal &&
					reply.includes(this.config.exit.completionSignal)
				) {
					state.consecutiveCompletionSignals++;
				} else {
					state.consecutiveCompletionSignals = 0;
				}

				// optional review gate(spec §4.7)
				if (this.config.review) {
					const diff = await this.deps.gitOps.diff();
					const output = reply + (diff ? `\n\n[diff]\n${diff}` : "");
					const reviewResult = await this.config.review.verifier.review(
						output,
						this.config.review.rubric,
					);
					iterResult.reviewVerdict = reviewResult.verdict;
					if (reviewResult.verdict === "naughty") {
						skipCommitMerge = true;
						this.deps.notes.write({
							iteration,
							replySummary: truncate(reply),
							gatePassed: false,
							merged: false,
							reviewVerdict: "naughty",
							reviewIssues: reviewResult.issues.map((i) => i.description),
						});
					}
				}

				if (!skipCommitMerge) {
					await this.deps.gitOps.commit(truncate(reply));
					const gateResult = await this.deps.gate.run();
					iterResult.gatePassed = gateResult.passed;
					if (gateResult.passed) {
						state.consecutiveGateFailures = 0;
						await this.deps.gitOps.checkout(baseBranch);
						const mergeResult = await this.deps.gitOps.merge(branch);
						if (mergeResult.ok) {
							try {
								await this.deps.gitOps.deleteBranch(branch);
							} catch {
								// non-fatal(spec 🟡5a):分支名带 iteration 不影响下轮
							}
							iterResult.merged = true;
							this.deps.notes.write({
								iteration,
								replySummary: truncate(reply),
								gatePassed: true,
								merged: true,
							});
						} else {
							iterResult.error = mergeResult.conflict;
							this.deps.notes.write({
								iteration,
								replySummary: truncate(reply),
								gatePassed: true,
								merged: false,
								error: mergeResult.conflict,
							});
						}
					} else {
						state.consecutiveGateFailures++;
						this.deps.notes.write({
							iteration,
							replySummary: truncate(reply),
							gatePassed: false,
							merged: false,
							gateOutput: gateResult.output,
						});
					}
				}
			} catch (err) {
				iterResult.error = err instanceof Error ? err.message : String(err);
				this.deps.notes.write({
					iteration,
					replySummary: "",
					gatePassed: false,
					merged: false,
					error: iterResult.error,
				});
			}

			// 回基准分支(为下轮 createBranch from base 准备;best-effort)。
			try {
				await this.deps.gitOps.checkout(baseBranch);
			} catch {
				// 可能在基准分支或 working tree 冲突;忽略,下轮 createBranch 会暴露。
			}

			state.runs++;
			state.cost += iterResult.cost;
			state.durationMs += Date.now() - t0;
			iterations.push(iterResult);
		}

		// 结束输出回滚提示(spec 🔴1)。
		console.log(`循环结束(${stopReason})。回滚点 tag: ${rollbackTag}`);
		console.log(`  如需恢复循环前 ${baseBranch} 状态: git reset --hard ${rollbackTag}`);

		return {
			iterations,
			totalCost: state.cost,
			totalRuns: state.runs,
			stopReason,
			rollbackTag,
		};
	}
}

/** prompt + notes + 指令(anti-pattern 2:跨迭代 context 桥)。 */
function buildPrompt(prompt: string, notes: string): string {
	if (!notes) return prompt;
	return `${prompt}\n\n[Previous iterations notes]\n${notes}\n\n读上方 notes 了解之前迭代的进展与失败,在此基础上继续。产出后由编排器自动记录本轮进度。`;
}

function truncate(s: string, max = 200): string {
	return s.length > max ? s.slice(0, max) + "…" : s;
}
