// packages/cli/src/loop/agent-deps.test.ts
import { describe, it, expect } from "vitest";
import { createLoopAgentDeps } from "./agent-deps.js";

describe("createLoopAgentDeps", () => {
	it("返回 6 个工具(read/bash/edit/write/grep/glob)", () => {
		const { tools } = createLoopAgentDeps();
		expect(tools).toHaveLength(6);
		const names = tools.map((t: any) => t.name);
		expect(names).toEqual(
			expect.arrayContaining(["read", "bash", "edit", "write", "grep", "glob"]),
		);
		expect(new Set(names).size).toBe(6);
	});

	it("返回非空 systemPrompt", () => {
		const { systemPrompt } = createLoopAgentDeps();
		expect(systemPrompt.length).toBeGreaterThan(0);
	});

	it("返回 safety guard(有 check 方法)", () => {
		const { safety } = createLoopAgentDeps();
		expect(safety).toBeTruthy();
		expect(typeof safety.check).toBe("function");
	});
});
