import { describe, it, expect, vi } from "vitest";
import { LoopRunner } from "./loop-runner.js";
import type { LoopDeps } from "./loop-runner.js";

/** 构造全 mock 的 LoopDeps。各方法默认 happy-path,测试里按需 override。 */
function makeMocks() {
	const gitOps = {
		isClean: vi.fn().mockResolvedValue(true),
		currentBranch: vi.fn().mockResolvedValue("main"),
		tag: vi.fn().mockResolvedValue(undefined),
		createBranch: vi.fn().mockResolvedValue(undefined),
		checkout: vi.fn().mockResolvedValue(undefined),
		commit: vi.fn().mockResolvedValue(true),
		merge: vi.fn().mockResolvedValue({ ok: true }),
		deleteBranch: vi.fn().mockResolvedValue(undefined),
		diff: vi.fn().mockResolvedValue(""),
		hasChanges: vi.fn().mockResolvedValue(true),
	};
	const gate = {
		run: vi.fn().mockResolvedValue({ passed: true, output: "ok" }),
	};
	const agentRunner = {
		run: vi.fn().mockResolvedValue({ reply: "done", cost: 0.01, tokensIn: 1, tokensOut: 1 }),
	};
	const notes = {
		read: vi.fn().mockReturnValue(""),
		write: vi.fn(),
	};
	return { gitOps, gate, agentRunner, notes };
}

describe("LoopRunner", () => {
	it("正常 1 轮:pass→merge→maxRuns=1 停", async () => {
		const m = makeMocks();
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 1 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.totalRuns).toBe(1);
		expect(result.stopReason).toBe("max-runs");
		expect(result.iterations).toHaveLength(1);
		expect(result.iterations[0].merged).toBe(true);
		expect(result.iterations[0].gatePassed).toBe(true);
		expect(m.gitOps.merge).toHaveBeenCalled();
		expect(result.rollbackTag).toMatch(/^loop-rollback-/);
	});

	it("gate 失败:不 merge,notes 写 gateOutput,maxRuns=2 跑 2 轮", async () => {
		const m = makeMocks();
		m.gate.run.mockResolvedValue({ passed: false, output: "test failed: x" });
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 2 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.totalRuns).toBe(2);
		expect(m.gitOps.merge).not.toHaveBeenCalled();
		expect(m.notes.write).toHaveBeenCalledWith(
			expect.objectContaining({ gatePassed: false, gateOutput: "test failed: x" }),
		);
		expect(result.iterations.every((i) => !i.merged)).toBe(true);
	});

	it("迭代崩溃:agentRunner throw → iterResult.error,继续下轮", async () => {
		const m = makeMocks();
		m.agentRunner.run.mockRejectedValue(new Error("agent boom"));
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 2 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.totalRuns).toBe(2);
		expect(result.iterations.every((i) => i.error === "agent boom")).toBe(true);
		expect(m.notes.write).toHaveBeenCalledWith(
			expect.objectContaining({ error: "agent boom" }),
		);
	});

	it("completion signal:reply 含 phrase→threshold=1 停", async () => {
		const m = makeMocks();
		m.agentRunner.run.mockResolvedValue({
			reply: "all done COMPLETED", cost: 0.01, tokensIn: 1, tokensOut: 1,
		});
		const runner = new LoopRunner(
			{
				prompt: "p",
				exit: { completionSignal: "COMPLETED", completionThreshold: 1 },
				cwd: process.cwd(),
			},
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.stopReason).toBe("completion-signal");
		expect(result.totalRuns).toBe(1);
	});

	it("maxCost 停", async () => {
		const m = makeMocks();
		m.agentRunner.run.mockResolvedValue({
			reply: "done", cost: 0.5, tokensIn: 1, tokensOut: 1,
		});
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 10, maxCost: 0.5 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.stopReason).toBe("max-cost");
		expect(result.totalRuns).toBe(1);
	});

	it("review naughty:不 commit/merge,notes 写 issues", async () => {
		const m = makeMocks();
		const verifier = {
			review: vi.fn().mockResolvedValue({
				verdict: "naughty",
				issues: [{ severity: "high", description: "slop" }],
				reviews: [],
			}),
		};
		const runner = new LoopRunner(
			{
				prompt: "p",
				exit: { maxRuns: 1 },
				cwd: process.cwd(),
				review: { rubric: { criteria: ["c"] }, verifier: verifier as any },
			},
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(m.gitOps.commit).not.toHaveBeenCalled();
		expect(m.gitOps.merge).not.toHaveBeenCalled();
		expect(result.iterations[0].reviewVerdict).toBe("naughty");
		expect(result.iterations[0].merged).toBe(false);
		expect(m.notes.write).toHaveBeenCalledWith(
			expect.objectContaining({ reviewVerdict: "naughty", reviewIssues: ["slop"] }),
		);
	});

	it("merge 冲突:不 merge,notes 写 conflict", async () => {
		const m = makeMocks();
		m.gitOps.merge.mockResolvedValue({ ok: false, conflict: "conflict in: f.ts" });
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 1 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const result = await runner.run();
		expect(result.iterations[0].merged).toBe(false);
		expect(result.iterations[0].error).toBe("conflict in: f.ts");
		expect(m.notes.write).toHaveBeenCalledWith(
			expect.objectContaining({ error: "conflict in: f.ts" }),
		);
	});

	it("isClean 失败 → throw 不开始", async () => {
		const m = makeMocks();
		m.gitOps.isClean.mockResolvedValue(false);
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 1 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		await expect(runner.run()).rejects.toThrow("working tree not clean");
	});

	it("abort:signal 已 aborted → stopReason aborted,不跑迭代", async () => {
		const m = makeMocks();
		const runner = new LoopRunner(
			{ prompt: "p", exit: { maxRuns: 5 }, cwd: process.cwd() },
			m as unknown as LoopDeps,
		);
		const ac = new AbortController();
		ac.abort();
		const result = await runner.run(ac.signal);
		expect(result.stopReason).toBe("aborted");
		expect(result.totalRuns).toBe(0);
		expect(m.agentRunner.run).not.toHaveBeenCalled();
	});
});
