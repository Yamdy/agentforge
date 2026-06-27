import { describe, it, expect, vi } from "vitest";
import { DagDecomposer } from "./dag-decomposer.js";
import type { AgentRunner, AgentRunResult } from "../loop/agent-runner.js";

/** 构造 mock agentRunner,reply 返回给定 JSON 字符串(可包围栏)。 */
function mockRunner(reply: string): AgentRunner {
	return {
		run: vi.fn(async (): Promise<AgentRunResult> => ({
			reply, cost: 0.01, tokensIn: 100, tokensOut: 200,
		})),
	};
}

const validUnitsJson = JSON.stringify([
	{ id: "u1", dependsOn: [], scope: "补 adr 测试", acceptanceTests: ["adr.test.ts 存在"], riskLevel: 1, rollbackPlan: "删 adr.test.ts" },
	{ id: "u2", dependsOn: ["u1"], scope: "补 audit 测试", acceptanceTests: ["audit.test.ts 存在"], riskLevel: 1, rollbackPlan: "删 audit.test.ts" },
]);

describe("DagDecomposer", () => {
	it("合法 JSON(无围栏)→ parse 成 Dag", async () => {
		const d = new DagDecomposer({ agentRunner: mockRunner(validUnitsJson) });
		const dag = await d.decompose("RFC: 补测试");
		expect(dag.units).toHaveLength(2);
		expect(dag.units[1].dependsOn).toEqual(["u1"]);
	});

	it("围栏包裹的 ```json...``` → 剥围栏 parse", async () => {
		const fenced = "```json\n" + validUnitsJson + "\n```";
		const d = new DagDecomposer({ agentRunner: mockRunner(fenced) });
		const dag = await d.decompose("RFC");
		expect(dag.units).toHaveLength(2);
	});

	it("reply 含噪声文本 + JSON → brace-fallback 提取首个 JSON 数组", async () => {
		const noisy = "好的,以下是分解:\n" + validUnitsJson + "\n以上是 unit。";
		const d = new DagDecomposer({ agentRunner: mockRunner(noisy) });
		const dag = await d.decompose("RFC");
		expect(dag.units).toHaveLength(2);
	});

	it("空数组 → throw(≥1 unit)", async () => {
		const d = new DagDecomposer({ agentRunner: mockRunner("[]") });
		await expect(d.decompose("RFC")).rejects.toThrow(/at least 1 unit|≥1/i);
	});

	it("循环依赖 → throw(无环)", async () => {
		const cyclic = JSON.stringify([
			{ id: "a", dependsOn: ["b"], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
			{ id: "b", dependsOn: ["a"], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		]);
		const d = new DagDecomposer({ agentRunner: mockRunner(cyclic) });
		await expect(d.decompose("RFC")).rejects.toThrow(/cycle|环/i);
	});

	it("dependsOn 引用不存在 id → throw", async () => {
		const bad = JSON.stringify([
			{ id: "u1", dependsOn: ["nope"], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		]);
		const d = new DagDecomposer({ agentRunner: mockRunner(bad) });
		await expect(d.decompose("RFC")).rejects.toThrow(/dependsOn|依赖.*不存在/i);
	});

	it("超 max-units(默认 20)→ throw", async () => {
		const many = JSON.stringify(Array.from({ length: 21 }, (_, i) => ({
			id: `u${i}`, dependsOn: [], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r",
		})));
		const d = new DagDecomposer({ agentRunner: mockRunner(many) });
		await expect(d.decompose("RFC")).rejects.toThrow(/max.*unit|≤20/i);
	});

	it("非法 JSON → throw(parse 失败)", async () => {
		const d = new DagDecomposer({ agentRunner: mockRunner("not json at all") });
		await expect(d.decompose("RFC")).rejects.toThrow(/parse|JSON/i);
	});

	// === Minor #7: unitId 字符集校验(防 shell 注入 via shq)===
	it("unitId 含非法字符(如 $()) → throw(charset)", async () => {
		const bad = JSON.stringify([
			{ id: "u1$(rm -rf x)", dependsOn: [], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		]);
		const d = new DagDecomposer({ agentRunner: mockRunner(bad) });
		await expect(d.decompose("RFC")).rejects.toThrow(/charset|字符集|id.*非法|invalid.*id/i);
	});

	it("unitId 含空格/特殊字符 → throw(charset)", async () => {
		const bad = JSON.stringify([
			{ id: "u 1", dependsOn: [], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		]);
		const d = new DagDecomposer({ agentRunner: mockRunner(bad) });
		await expect(d.decompose("RFC")).rejects.toThrow(/charset|字符集|id.*非法|invalid.*id/i);
	});

	it("unitId 合法字符(a-zA-Z0-9_-)→ 通过", async () => {
		const ok = JSON.stringify([
			{ id: "u_1-OK", dependsOn: [], scope: "s", acceptanceTests: [], riskLevel: 1, rollbackPlan: "r" },
		]);
		const d = new DagDecomposer({ agentRunner: mockRunner(ok) });
		const dag = await d.decompose("RFC");
		expect(dag.units[0].id).toBe("u_1-OK");
	});
});
