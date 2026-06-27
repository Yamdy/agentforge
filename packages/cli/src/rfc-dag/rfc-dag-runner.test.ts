// packages/cli/src/rfc-dag/rfc-dag-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { RfcDagRunner } from "./rfc-dag-runner.js";
import type { RfcDagConfig, RfcDagDeps } from "./rfc-dag-runner.js";
import type { Dag } from "./dag-decomposer.js";
import type { GitOps, MergeResult } from "../loop/git-ops.js";
import type { Gate, GateResult } from "../loop/gate.js";
import type { AgentRunner } from "../loop/agent-runner.js";
import type { WorktreeOps } from "./worktree-pool.js";
import type { RfcDagState, RfcDagStateData } from "./rfc-dag-state.js";
import type { DagDecomposer } from "./dag-decomposer.js";

const dag: Dag = { units: [
	{ id: "u1", dependsOn: [], scope: "s1", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
	{ id: "u2", dependsOn: ["u1"], scope: "s2", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
]};

function mockGitOps(o: { clean?: boolean; branch?: string; mergeOk?: boolean } = {}): GitOps {
	return {
		isClean: vi.fn(async () => o.clean ?? true),
		currentBranch: vi.fn(async () => o.branch ?? "main"),
		tag: vi.fn(async () => {}),
		createBranch: vi.fn(async () => {}),
		checkout: vi.fn(async () => {}),
		commit: vi.fn(async () => true),
		merge: vi.fn(async (): Promise<MergeResult> => (o.mergeOk ?? true) ? { ok: true } : { ok: false, conflict: "CONFLICT" }),
		hasChanges: vi.fn(async () => true),
		deleteBranch: vi.fn(async () => {}),
		diff: vi.fn(async () => "diff"),
	};
}
function mockGate(seq: boolean[]): Gate {
	let i = 0;
	return { run: vi.fn(async (): Promise<GateResult> => {
		const p = seq[Math.min(i, seq.length - 1)]; i++;
		return { passed: p, output: p ? "ok" : "FAIL" };
	})};
}
function mockState(data: RfcDagStateData): RfcDagState {
	return { data, load: vi.fn(() => null), save: vi.fn(), reset: vi.fn(),
		markUnit: vi.fn((id, status, attempts, ctx) => { const u = data.units[id]; if (u) { u.status = status; if (attempts != null) u.attempts = attempts; if (ctx?.lastError != null) u.lastError = ctx.lastError; if (ctx?.lastGateOutput != null) u.lastGateOutput = ctx.lastGateOutput; if (ctx?.lastReviewIssues != null) u.lastReviewIssues = ctx.lastReviewIssues; } }) };
}
function mkDeps(over: Partial<RfcDagDeps> & { dag?: Dag; existing?: RfcDagStateData | null } = {}): RfcDagDeps {
	const data: RfcDagStateData = { dag: over.dag ?? dag, units: {
		u1: { id: "u1", status: "pending", attempts: 0 },
		u2: { id: "u2", status: "pending", attempts: 0 },
	}, rollbackTag: "" };
	const state = mockState(data);
	state.load = vi.fn(() => over.existing ?? null);
	return {
		gitOpsFactory: vi.fn(() => mockGitOps()),
		worktreeOps: { addWorktree: vi.fn(async () => {}), removeWorktree: vi.fn(async () => {}) },
		gateFactory: vi.fn(() => mockGate([true, true, true])),
		agentRunner: { run: vi.fn(async () => ({ reply: "done DONE", cost: 0.05, tokensIn: 10, tokensOut: 20 })) },
		decomposer: { decompose: vi.fn(async () => over.dag ?? dag) } as DagDecomposer,
		state,
		...over,
	};
}
function mkConfig(over: Partial<RfcDagConfig> = {}): RfcDagConfig {
	return { rfc: "RFC", exit: { maxRuns: 10 }, maxUnitRetries: 1, baseBranch: "main", ...over };
}

describe("RfcDagRunner", () => {
	it("正常 DAG 2 unit 全 merge + all-done", async () => {
		const r = new RfcDagRunner(mkConfig(), mkDeps());
		const res = await r.run();
		expect(res.units.filter(u => u.status === "merged")).toHaveLength(2);
		expect(res.stopReason).toBe("all-done");
	});

	it("decompose 失败 → throw(回滚 tag 已打)", async () => {
		const deps = mkDeps();
		(deps.decomposer.decompose as any) = vi.fn(async () => { throw new Error("bad dag"); });
		await expect(new RfcDagRunner(mkConfig(), deps).run()).rejects.toThrow(/bad dag/);
		expect(deps.gitOpsFactory).toHaveBeenCalled();   // repoGitOps 建了(tag 已打)
	});

	it("gate 永失败 retry 达上限 → u1 failed + u2 skipped", async () => {
		const deps = mkDeps({ gateFactory: vi.fn(() => mockGate([false])) });
		const res = await new RfcDagRunner(mkConfig({ maxUnitRetries: 1 }), deps).run();
		expect(res.units.find(u => u.unitId === "u1")?.status).toBe("failed");
		expect(res.units.find(u => u.unitId === "u2")?.status).toBe("skipped");
	});

	it("gate 失败 1 次后 retry pass → merged", async () => {
		const deps = mkDeps({ gateFactory: vi.fn(() => mockGate([false, true, true])) });
		const res = await new RfcDagRunner(mkConfig({ maxUnitRetries: 2 }), deps).run();
		expect(res.units.find(u => u.unitId === "u1")?.status).toBe("merged");
	});

	it("isClean 失败 → throw 不开始(不 decompose)", async () => {
		const deps = mkDeps({ gitOpsFactory: vi.fn(() => mockGitOps({ clean: false })) });
		await expect(new RfcDagRunner(mkConfig(), deps).run()).rejects.toThrow(/clean/);
		expect(deps.decomposer.decompose).not.toHaveBeenCalled();
	});

	it("merge 冲突 retry 达上限 → failed", async () => {
		const deps = mkDeps({ gitOpsFactory: vi.fn(() => mockGitOps({ mergeOk: false })) });
		const res = await new RfcDagRunner(mkConfig({ maxUnitRetries: 1 }), deps).run();
		expect(res.units.find(u => u.unitId === "u1")?.status).toBe("failed");
	});

	it("resumable:state 已 merged u1 → 跳过 u1 只跑 u2", async () => {
		const existing: RfcDagStateData = { dag, units: {
			u1: { id: "u1", status: "merged", attempts: 0 },
			u2: { id: "u2", status: "pending", attempts: 0 },
		}, rollbackTag: "tag-x" };
		const deps = mkDeps({ existing });
		const res = await new RfcDagRunner(mkConfig(), deps).run();
		expect(deps.decomposer.decompose).not.toHaveBeenCalled();   // 恢复 run 不 decompose
		expect(res.units.find(u => u.unitId === "u2")?.status).toBe("merged");
		expect(res.rollbackTag).toBe("tag-x");
	});

	it("回滚 tag 在结果中 + console 输出 reset 提示", async () => {
		const deps = mkDeps();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const res = await new RfcDagRunner(mkConfig(), deps).run();
		expect(res.rollbackTag).toMatch(/rfc-dag-rollback-/);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("git reset --hard"));
		logSpy.mockRestore();
	});
});
