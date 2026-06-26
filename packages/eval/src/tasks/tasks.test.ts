import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAcceptance } from "../acceptance.js";
import { readFileTask, editAddCommentTask, runTestTask } from "./index.js";

/**
 * Slice 7 eval 示例 task 测试(spec §4.4 / plan Task 6)。
 *
 * 验证逻辑(不跑真实 LLM):每个 task 的 setup(sandbox)写好前置文件后,
 * 其 acceptanceChecks 经 runAcceptance 应全过(passed=true)。
 * 这验 task 自洽性——setup 产物满足 acceptance(spec §4.4 三示例的声明式 check)。
 *
 * 注意:runTestTask 的 exit-zero 用 `node -e 0`(跨平台稳,不依赖 pnpm 在 sandbox)。
 */
describe("示例 task 自洽性(setup → acceptance 全过)", () => {
	let sandbox: string;

	beforeEach(() => {
		sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "eval-tasks-"));
	});

	afterEach(() => {
		fs.rmSync(sandbox, { recursive: true, force: true });
	});

	describe("readFileTask", () => {
		it("setup 写 package.json 后,acceptance file-contains name 通过", async () => {
			if (!readFileTask.setup) throw new Error("readFileTask.setup 缺失");
			await readFileTask.setup(sandbox);
			expect(
				runAcceptance(readFileTask.acceptanceChecks, sandbox, ""),
			).toBe(true);
		});

		it("id 为 read-file-name", () => {
			expect(readFileTask.id).toBe("read-file-name");
		});

		it("prompt 含 sandbox 占位(由 runner/CLI 替换)", () => {
			expect(readFileTask.prompt).toMatch(/sandbox|package\.json/);
		});
	});

	describe("editAddCommentTask", () => {
		it("setup 写 a.ts 后,acceptance file-contains // edited 通过", async () => {
			if (!editAddCommentTask.setup) throw new Error("editAddCommentTask.setup 缺失");
			await editAddCommentTask.setup(sandbox);
			expect(
				runAcceptance(editAddCommentTask.acceptanceChecks, sandbox, ""),
			).toBe(true);
		});

		it("id 为 edit-add-comment", () => {
			expect(editAddCommentTask.id).toBe("edit-add-comment");
		});
	});

	describe("runTestTask", () => {
		it("setup 后,acceptance exit-zero 通过", async () => {
			if (!runTestTask.setup) throw new Error("runTestTask.setup 缺失");
			await runTestTask.setup(sandbox);
			expect(
				runAcceptance(runTestTask.acceptanceChecks, sandbox, ""),
			).toBe(true);
		});

		it("id 为 run-test", () => {
			expect(runTestTask.id).toBe("run-test");
		});
	});
});
