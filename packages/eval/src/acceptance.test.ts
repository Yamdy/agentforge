import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAcceptance } from "./acceptance.js";
import type { AcceptanceCheck } from "./types.js";

/**
 * Slice 7 eval 包 acceptance check 测试(spec §4.2 / plan Task 2)。
 *
 * runAcceptance(checks, sandbox, reply):声明式 check 在 sandbox 内跑:
 * - file-exists:path(相对 sandbox)存在 → true
 * - file-contains:文件内容含 contains 子串 → true
 * - exit-zero:在 sandbox cwd 跑 command,退出码 0 → true(非 0 → false)
 * - 全过 → true;任一不过 → false
 *
 * 安全:声明式 check(red-team ⚪ 7:避免任意函数);sandbox 隔离(tmpdir)。
 */
describe("runAcceptance", () => {
	let sandbox: string;

	beforeEach(() => {
		sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "eval-accept-"));
	});

	afterEach(() => {
		fs.rmSync(sandbox, { recursive: true, force: true });
	});

	describe("file-exists", () => {
		it("sandbox 内文件存在 → true", () => {
			fs.writeFileSync(path.join(sandbox, "package.json"), '{"name":"x"}');
			const checks: AcceptanceCheck[] = [
				{ kind: "file-exists", path: "package.json" },
			];
			expect(runAcceptance(checks, sandbox, "")).toBe(true);
		});

		it("文件不存在 → false", () => {
			const checks: AcceptanceCheck[] = [
				{ kind: "file-exists", path: "nope.json" },
			];
			expect(runAcceptance(checks, sandbox, "")).toBe(false);
		});
	});

	describe("file-contains", () => {
		it("文件含 substring → true", () => {
			fs.writeFileSync(path.join(sandbox, "a.ts"), "// edited\ncode\n");
			const checks: AcceptanceCheck[] = [
				{ kind: "file-contains", path: "a.ts", contains: "// edited" },
			];
			expect(runAcceptance(checks, sandbox, "")).toBe(true);
		});

		it("文件不含 substring → false", () => {
			fs.writeFileSync(path.join(sandbox, "a.ts"), "code\n");
			const checks: AcceptanceCheck[] = [
				{ kind: "file-contains", path: "a.ts", contains: "// edited" },
			];
			expect(runAcceptance(checks, sandbox, "")).toBe(false);
		});
	});

	describe("exit-zero", () => {
		it("退出码 0 → true", () => {
			const checks: AcceptanceCheck[] = [
				{ kind: "exit-zero", command: "node -e 0" },
			];
			expect(runAcceptance(checks, sandbox, "")).toBe(true);
		});

		it("退出码 非 0 → false", () => {
			const checks: AcceptanceCheck[] = [
				{ kind: "exit-zero", command: "node -e \"process.exit(1)\"" },
			];
			expect(runAcceptance(checks, sandbox, "")).toBe(false);
		});
	});

	describe("聚合", () => {
		it("全过 → true", () => {
			fs.writeFileSync(path.join(sandbox, "package.json"), '{"name":"agentforge"}');
			fs.writeFileSync(path.join(sandbox, "a.ts"), "// edited\n");
			const checks: AcceptanceCheck[] = [
				{ kind: "file-exists", path: "package.json" },
				{ kind: "file-contains", path: "a.ts", contains: "// edited" },
				{ kind: "exit-zero", command: "node -e 0" },
			];
			expect(runAcceptance(checks, sandbox, "")).toBe(true);
		});

		it("任一不过 → false", () => {
			fs.writeFileSync(path.join(sandbox, "package.json"), '{"name":"agentforge"}');
			const checks: AcceptanceCheck[] = [
				{ kind: "file-exists", path: "package.json" },
				{ kind: "file-contains", path: "a.ts", contains: "// edited" }, // a.ts 不存在
			];
			expect(runAcceptance(checks, sandbox, "")).toBe(false);
		});

		it("空 checks → true(无失败项)", () => {
			expect(runAcceptance([], sandbox, "")).toBe(true);
		});
	});
});
