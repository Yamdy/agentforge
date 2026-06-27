// packages/cli/src/rfc-dag/dag-scheduler.ts
import type { Dag, WorkUnit } from "./dag-decomposer.js";

export type UnitStatus = "pending" | "running" | "merged" | "failed" | "skipped";
export interface UnitState {
	id: string;
	status: UnitStatus;
	attempts: number;
	lastError?: string;
	lastGateOutput?: string;
	lastReviewIssues?: string[];
}

export interface DagSchedulerDeps {
	dag: Dag;
	units: Record<string, UnitState>;
}

export class DagScheduler {
	constructor(private deps: DagSchedulerDeps) {}

	/** 下一个可跑 unit:pending 且所有 dependsOn merged。先传播 failed→skipped。无则 null。 */
	next(): WorkUnit | null {
		this.propagateSkipped();
		for (const u of this.deps.dag.units) {
			const st = this.deps.units[u.id];
			if (st.status !== "pending") continue;
			const ready = u.dependsOn.every(dep => this.deps.units[dep]?.status === "merged");
			if (ready) return u;
		}
		return null;
	}

	/** pending 且任意 dependsOn 是 failed/skipped → skipped(多轮传播间接依赖)。 */
	private propagateSkipped(): void {
		let changed = true;
		while (changed) {
			changed = false;
			for (const u of this.deps.dag.units) {
				const st = this.deps.units[u.id];
				if (st.status !== "pending") continue;
				const blocked = u.dependsOn.some(dep => {
					const ds = this.deps.units[dep]?.status;
					return ds === "failed" || ds === "skipped";
				});
				if (blocked) { st.status = "skipped"; changed = true; }
			}
		}
	}

	mark(id: string, status: UnitStatus): void {
		const st = this.deps.units[id];
		if (st) st.status = status;
	}

	status(id: string): UnitState {
		return this.deps.units[id];
	}

	allDone(): boolean {
		this.propagateSkipped();   // failed 下游自动 skipped,保证状态读取一致(同 next)
		return this.deps.dag.units.every(u => {
			const s = this.deps.units[u.id].status;
			return s === "merged" || s === "failed" || s === "skipped";
		});
	}
}
