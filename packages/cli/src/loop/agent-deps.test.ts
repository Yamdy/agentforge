// packages/cli/src/loop/agent-deps.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

	it("passes cwd through to tools (worktree isolation)", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "deps-cwd-"));
		const deps = createLoopAgentDeps(tmp);
		const bash = deps.tools.find((t) => t.name === "bash");
		expect(bash).toBeDefined();
		const result = await bash!.execute("c", {
			command: 'node -e "process.stdout.write(process.cwd())"',
		});
		expect((result.content[0] as { text: string }).text).toBe(tmp);
	});
});
