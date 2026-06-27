// packages/cli/src/rfc-dag/dag-scheduler.test.ts
import { describe, it, expect } from "vitest";
import { DagScheduler } from "./dag-scheduler.js";
import type { UnitState } from "./dag-scheduler.js";
import type { Dag } from "./dag-decomposer.js";

function mkDag(): Dag {
	return { units: [
		{ id: "u1", dependsOn: [], scope: "s1", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		{ id: "u2", dependsOn: ["u1"], scope: "s2", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		{ id: "u3", dependsOn: ["u1"], scope: "s3", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		{ id: "u4", dependsOn: ["u2", "u3"], scope: "s4", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
	]};
}
function pendingState(dag: Dag): Record<string, UnitState> {
	const m: Record<string, UnitState> = {};
	for (const u of dag.units) m[u.id] = { id: u.id, status: "pending", attempts: 0 };
	return m;
}

describe("DagScheduler", () => {
	it("next 返回无依赖的 pending unit(u1)", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		expect(s.next()?.id).toBe("u1");
	});

	it("u1 running 时 next 返 null(串行,不并发选 u2/u3)", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		s.next();
		s.mark("u1", "running");
		expect(s.next()).toBeNull();
	});

	it("u1 merged → next 返回 u2 或 u3(依赖满足)", () => {
		const dag = mkDag();
		const units = pendingState(dag);
		const s = new DagScheduler({ dag, units });
		s.mark("u1", "merged");
		expect(["u2", "u3"]).toContain(s.next()?.id);
	});

	it("u1 failed → 下游 u2/u3/u4 全 skipped", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		s.mark("u1", "failed");
		expect(s.next()).toBeNull();
		expect(s.status("u2").status).toBe("skipped");
		expect(s.status("u3").status).toBe("skipped");
		expect(s.status("u4").status).toBe("skipped");
	});

	it("u2 failed(u1 merged)→ u4 skipped,u3 仍可跑", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		s.mark("u1", "merged");
		s.mark("u2", "failed");
		expect(s.next()?.id).toBe("u3");   // u3 依赖 u1(merged)可跑
		expect(s.status("u4").status).toBe("skipped");   // u4 依赖 u2(failed)
	});

	it("allDone:全 merged → true;有 pending → false", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		expect(s.allDone()).toBe(false);
		s.mark("u1", "merged"); s.mark("u2", "merged"); s.mark("u3", "merged"); s.mark("u4", "merged");
		expect(s.allDone()).toBe(true);
	});

	it("allDone:全 failed/skipped → true", () => {
		const dag = mkDag();
		const s = new DagScheduler({ dag, units: pendingState(dag) });
		s.mark("u1", "failed");   // u2/u3/u4 skipped
		expect(s.allDone()).toBe(true);
	});

	it("attempts 从 state 读取", () => {
		const dag = mkDag();
		const units = pendingState(dag);
		units.u1.attempts = 2;
		const s = new DagScheduler({ dag, units });
		expect(s.status("u1").attempts).toBe(2);
	});
});
