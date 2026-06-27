// packages/cli/src/rfc-dag/rfc-dag-runner.ts
import type { GitOps } from "../loop/git-ops.js";
import type { Gate } from "../loop/gate.js";
import type { AgentRunner } from "../loop/agent-runner.js";
import type { LoopState, ExitConditionConfig, ExitDecision } from "../loop/exit-condition.js";
import { checkExit } from "../loop/exit-condition.js";
import type { ReviewGate } from "../loop/loop-runner.js";
import type { DagDecomposer, Dag, WorkUnit } from "./dag-decomposer.js";
import { DagScheduler } from "./dag-scheduler.js";
import type { UnitStatus } from "./dag-scheduler.js";
import type { WorktreeOps } from "./worktree-pool.js";
import type { RfcDagState, RfcDagStateData } from "./rfc-dag-state.js";

export interface RfcDagConfig {
	rfc: string;
	exit: ExitConditionConfig;
	review?: ReviewGate;
	maxUnitRetries?: number;   // 默认 2
	baseBranch?: string;       // 默认 main
	branchPrefix?: string;     // 默认 rfc-dag
	cwd?: string;
}
export interface RfcDagDeps {
	gitOpsFactory: (cwd: string) => GitOps;
	worktreeOps: WorktreeOps;
	gateFactory: (cwd: string) => Gate;
	agentRunner: AgentRunner;
	decomposer: DagDecomposer;
	state: RfcDagState;
}
export interface UnitResult {
	unitId: string; status: UnitStatus; attempts: number;
	reply?: string; cost: number; gatePassed: boolean;
	reviewVerdict?: "nice" | "naughty"; error?: string;
}
export interface RfcDagResult {
	units: UnitResult[]; totalCost: number; stopReason: string; rollbackTag: string;
}

const DEFAULT_MAX_UNIT_RETRIES = 2;
const DEFAULT_BASE_BRANCH = "main";
const DEFAULT_BRANCH_PREFIX = "rfc-dag";

export class RfcDagRunner {
	constructor(private config: RfcDagConfig, private deps: RfcDagDeps) {}

	async run(signal?: AbortSignal): Promise<RfcDagResult> {
		const repoCwd = this.config.cwd ?? process.cwd();
		const worktreesDir = `${repoCwd}/.agentforge/worktrees`;
		const repoGitOps = this.deps.gitOpsFactory(repoCwd);
		const maxRetries = this.config.maxUnitRetries ?? DEFAULT_MAX_UNIT_RETRIES;
		const baseBranch = this.config.baseBranch ?? DEFAULT_BASE_BRANCH;
		const prefix = this.config.branchPrefix ?? DEFAULT_BRANCH_PREFIX;

		if (!(await repoGitOps.isClean())) throw new Error("RFC-DAG:working tree 不 clean(不干净),清理后再开始");
		if ((await repoGitOps.currentBranch()) !== baseBranch) throw new Error(`RFC-DAG:须在 ${baseBranch} 分支开始`);

		// 新 run vs 恢复 run(spec §5 细化)。
		// 注意:原位 mutate state.data 的属性(不整体 reassign),使 markUnit(写 state.data.units[id])
		// 与 scheduler(持 state.data.units 引用)始终指向同一 units 对象——避免 mock/真实 state
		// 闭包捕获旧 data 引用导致的 state 分叉。
		let dag: Dag;
		let rollbackTag: string;
		const existing = this.deps.state.load();
		if (existing && existing.dag.units.length > 0) {
			this.deps.state.data.dag = existing.dag;
			this.deps.state.data.units = existing.units;
			this.deps.state.data.rollbackTag = existing.rollbackTag;
			dag = existing.dag;
			rollbackTag = existing.rollbackTag;
		} else {
			this.deps.state.reset();
			rollbackTag = `rfc-dag-rollback-${Date.now()}`;
			await repoGitOps.tag(rollbackTag);
			dag = await this.deps.decomposer.decompose(this.config.rfc);   // 失败 throw
			this.deps.state.data.dag = dag;
			this.deps.state.data.units = Object.fromEntries(
				dag.units.map(u => [u.id, { id: u.id, status: "pending" as UnitStatus, attempts: 0 }]),
			);
			this.deps.state.data.rollbackTag = rollbackTag;
			this.deps.state.save();
		}

		const scheduler = new DagScheduler({ dag, units: this.deps.state.data.units });
		const state2: LoopState = { runs: 0, cost: 0, durationMs: 0, consecutiveCompletionSignals: 0, consecutiveGateFailures: 0 };
		const results: UnitResult[] = [];
		let stopReason = "all-done";
		let exit: ExitDecision = { stop: false, reason: "" };

		while (true) {
			if (signal?.aborted) { stopReason = "aborted"; break; }
			exit = checkExit(state2, this.config.exit);
			if (exit.stop) { stopReason = exit.reason; break; }
			const unit = scheduler.next();
			if (!unit) break;   // allDone
			scheduler.mark(unit.id, "running");
			const r = await this.runUnit(unit, dag, repoGitOps, worktreesDir, prefix, baseBranch, maxRetries, signal);
			results.push(r);
			state2.runs += r.attempts;
			state2.cost += r.cost;
			this.deps.state.save();
		}

		// 补齐未跑的 unit(因上游 failed/skipped 被 propagateSkipped 标 skipped,从未进 runUnit)
		// 到结果中——保证每个 dag unit 在 RfcDagResult.units 都有条目(spec:u2 skipped 可见)。
		scheduler.allDone();   // 再跑一次传播,确保 skipped 状态已写 state.data.units
		const seen = new Set(results.map(r => r.unitId));
		for (const u of dag.units) {
			if (seen.has(u.id)) continue;
			const st = this.deps.state.data.units[u.id];
			results.push({ unitId: u.id, status: st?.status ?? "skipped", attempts: st?.attempts ?? 0, cost: 0, gatePassed: false });
		}

		// final verify(主 repo,全量集成)
		await repoGitOps.checkout(baseBranch);
		const finalGate = this.deps.gateFactory(this.config.cwd ?? process.cwd());
		const finalRes = await finalGate.run();
		if (!finalRes.passed) {
			results.push({ unitId: "__final__", status: "failed", attempts: 1, cost: 0, gatePassed: false, error: finalRes.output });
		}

		console.log(`RFC-DAG 结束(${stopReason})。回滚 tag: ${rollbackTag}`);
		console.log(`  git reset --hard ${rollbackTag}`);
		return { units: results, totalCost: state2.cost, stopReason, rollbackTag };
	}

	private async runUnit(unit: WorkUnit, dag: Dag, repoGitOps: GitOps, worktreesDir: string, prefix: string, baseBranch: string, maxRetries: number, signal?: AbortSignal): Promise<UnitResult> {
		const wt = `${worktreesDir}/${unit.id}`;
		const branch = `${prefix}/${unit.id}`;
		let attempts = this.deps.state.data.units[unit.id]?.attempts ?? 0;
		const result: UnitResult = { unitId: unit.id, status: "pending", attempts, reply: "", cost: 0, gatePassed: false };
		// gate/wtGitOps 在 retry 间复用同一实例:gate mock 的序列索引需跨 attempt 累积(mockGate 闭包 i),
		// 每次重试新建 gate 会使 i 归零、永远拿 seq[0]。真实 LocalBuildGate 无状态,复用安全。
		const wtGitOps = this.deps.gitOpsFactory(wt);
		const gate = this.deps.gateFactory(wt);

		while (attempts <= maxRetries) {
			result.attempts = attempts;
			try {
				await this.deps.worktreeOps.addWorktree(wt, branch);
				if (signal?.aborted) break;
				const notes = this.buildNotes(unit);
				const mergedDeps = unit.dependsOn.map(id => `${id}: ${dag.units.find(u => u.id === id)?.scope ?? ""}`).join("; ");
				const prompt = this.buildPrompt(unit, notes, mergedDeps);
				const { reply, cost } = await this.deps.agentRunner.run(prompt, { cwd: wt, signal });
				result.reply = reply; result.cost += cost;

				if (this.config.review) {
					const output = reply + "\n" + (await wtGitOps.diff()).slice(0, 4000);
					const rr = await this.config.review.verifier.review(output, this.config.review.rubric);
					result.reviewVerdict = rr.verdict;
					if (rr.verdict === "naughty") {
						attempts++;
						// issues: Issue[] → string[](description),同 loop-runner 模式;lastReviewIssues 字段类型 string[]。
						this.deps.state.markUnit(unit.id, "pending", attempts, { lastReviewIssues: rr.issues?.map(i => i.description) });
						this.deps.state.save();
						await this.deps.worktreeOps.removeWorktree(wt);
						if (attempts > maxRetries) { result.status = "failed"; result.error = rr.issues?.map(i => i.description).join("; "); this.deps.state.markUnit(unit.id, "failed", attempts); return result; }
						continue;
					}
				}
				await wtGitOps.commit(reply.slice(0, 72));
				const gateRes = await gate.run();
				result.gatePassed = gateRes.passed;
				if (gateRes.passed) {
					await repoGitOps.checkout(baseBranch);
					const mergeRes = await repoGitOps.merge(branch);   // 非 --ff-only,冲突 retryable
					if (mergeRes.ok) {
						result.status = "merged";
						this.deps.state.markUnit(unit.id, "merged", attempts);
						this.deps.state.save();
						await this.deps.worktreeOps.removeWorktree(wt);
						return result;
					}
					attempts++;
					this.deps.state.markUnit(unit.id, "pending", attempts, { lastError: mergeRes.conflict });
				} else {
					attempts++;
					this.deps.state.markUnit(unit.id, "pending", attempts, { lastGateOutput: gateRes.output });
				}
			} catch (err) {
				attempts++;
				this.deps.state.markUnit(unit.id, "pending", attempts, { lastError: (err as Error).message });
			}
			this.deps.state.save();
			try { await this.deps.worktreeOps.removeWorktree(wt); } catch { /* non-fatal */ }
			if (attempts > maxRetries) { result.status = "failed"; result.error = result.error ?? this.deps.state.data.units[unit.id]?.lastError; this.deps.state.markUnit(unit.id, "failed", attempts); return result; }
		}
		result.status = "failed";
		return result;
	}

	private buildNotes(unit: WorkUnit): string {
		const st = this.deps.state.data.units[unit.id];
		if (!st) return "";
		const parts: string[] = [];
		if (st.lastError) parts.push(`上次错误: ${st.lastError}`);
		if (st.lastGateOutput) parts.push(`上次 gate 失败: ${st.lastGateOutput}`);
		if (st.lastReviewIssues?.length) parts.push(`上次 review issues: ${st.lastReviewIssues.join("; ")}`);
		parts.push(`已尝试 ${st.attempts} 次`);
		return parts.join("\n");
	}

	private buildPrompt(unit: WorkUnit, notes: string, mergedDeps: string): string {
		return `${this.config.rfc}

--- 你的工作单元 ---
id: ${unit.id}
scope: ${unit.scope}
acceptanceTests: ${unit.acceptanceTests.join("; ")}
riskLevel: ${unit.riskLevel}
rollbackPlan: ${unit.rollbackPlan}
依赖 unit(已完成,代码已在 worktree): ${mergedDeps || "无"}

--- 上下文(retry 时)---
${notes || "首次执行"}

--- 要求 ---
完成本 unit scope。完成后输出 DONE。`;
	}
}
