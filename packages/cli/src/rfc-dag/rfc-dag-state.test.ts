// packages/cli/src/rfc-dag/rfc-dag-state.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRfcDagState } from "./rfc-dag-state.js";
import type { Dag } from "./dag-decomposer.js";

const dag: Dag = { units: [
	{ id: "u1", dependsOn: [], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
	{ id: "u2", dependsOn: ["u1"], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
]};

describe("FileRfcDagState", () => {
	let dir: string;
	beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rfc-st-")); });
	afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

	it("load 不存在 → null", () => {
		expect(new FileRfcDagState({ dir }).load()).toBeNull();
	});

	it("save → 新实例 load 往返一致(dag/units/rollbackTag)", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: {
			u1: { id: "u1", status: "pending", attempts: 0 },
			u2: { id: "u2", status: "pending", attempts: 0 },
		}, rollbackTag: "tag-1" };
		s.save();
		const loaded = new FileRfcDagState({ dir }).load();
		expect(loaded?.rollbackTag).toBe("tag-1");
		expect(loaded?.units.u1.status).toBe("pending");
		expect(loaded?.dag.units).toHaveLength(2);
	});

	it("reset 删文件 → load null", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: {}, rollbackTag: "t" };
		s.save();
		s.reset();
		expect(new FileRfcDagState({ dir }).load()).toBeNull();
	});

	it("markUnit 更新 status + attempts + context", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: { u1: { id: "u1", status: "pending", attempts: 0 } }, rollbackTag: "t" };
		s.markUnit("u1", "pending", 1, { lastError: "gate fail", lastGateOutput: "ERR" });
		expect(s.data.units.u1.attempts).toBe(1);
		expect(s.data.units.u1.lastError).toBe("gate fail");
		expect(s.data.units.u1.lastGateOutput).toBe("ERR");
	});

	it("resumable:已 merged 的 unit load 后仍 merged(恢复跳过)", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: {
			u1: { id: "u1", status: "merged", attempts: 0 },
			u2: { id: "u2", status: "pending", attempts: 0 },
		}, rollbackTag: "t" };
		s.save();
		const loaded = new FileRfcDagState({ dir }).load();
		expect(loaded?.units.u1.status).toBe("merged");
		expect(loaded?.units.u2.status).toBe("pending");
	});

	it("markUnit 不存在 id → no-op 不 throw", () => {
		const s = new FileRfcDagState({ dir });
		s.data = { dag, units: {}, rollbackTag: "t" };
		expect(() => s.markUnit("nope", "failed")).not.toThrow();
	});
});
