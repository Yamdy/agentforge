import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalBuildGate } from "./gate.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "gate-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("LocalBuildGate", () => {
	it("全部命令退出 0 → passed=true", async () => {
		const gate = new LocalBuildGate({ cwd: dir, commands: ['node -e "process.exit(0)"'] });
		const r = await gate.run();
		expect(r.passed).toBe(true);
	});

	it("命令退出非 0 → passed=false, output 含 stderr", async () => {
		const gate = new LocalBuildGate({
			cwd: dir,
			commands: ['node -e "console.error(42);process.exit(1)"'],
		});
		const r = await gate.run();
		expect(r.passed).toBe(false);
		expect(r.output).toContain("42");
	});

	it("多命令:第一个失败短路 → passed=false", async () => {
		const gate = new LocalBuildGate({
			cwd: dir,
			commands: ['node -e "process.exit(1)"', 'node -e "process.exit(0)"'],
		});
		const r = await gate.run();
		expect(r.passed).toBe(false);
	});

	it("多命令:全过 → passed=true", async () => {
		const gate = new LocalBuildGate({
			cwd: dir,
			commands: ['node -e "process.exit(0)"', 'node -e "process.exit(0)"'],
		});
		const r = await gate.run();
		expect(r.passed).toBe(true);
	});

	it("默认 commands 构造不 throw(不在测试里真跑 pnpm)", () => {
		const gate = new LocalBuildGate({ cwd: dir });
		expect(gate).toBeInstanceOf(LocalBuildGate);
	});
});
