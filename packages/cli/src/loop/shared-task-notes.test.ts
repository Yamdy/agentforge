// packages/cli/src/loop/shared-task-notes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSharedTaskNotes } from "./shared-task-notes.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "notes-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("FileSharedTaskNotes", () => {
	it("read 首次(文件不存在)→ 空串", () => {
		const notes = new FileSharedTaskNotes({ dir });
		expect(notes.read()).toBe("");
	});

	it("write 追加一条 Progress 段 → read 含该段", () => {
		const notes = new FileSharedTaskNotes({ dir });
		notes.write({
			iteration: 1,
			replySummary: "added a test",
			gatePassed: true,
			merged: true,
		});
		const content = notes.read();
		expect(content).toContain("Iteration 1");
		expect(content).toContain("added a test");
		expect(content).toContain("Merged: true");
	});

	it("write 多条 → read 含全部", () => {
		const notes = new FileSharedTaskNotes({ dir });
		notes.write({ iteration: 1, replySummary: "a", gatePassed: true, merged: true });
		notes.write({
			iteration: 2, replySummary: "b", gatePassed: false, merged: false, gateOutput: "test fail",
		});
		const content = notes.read();
		expect(content).toContain("Iteration 1");
		expect(content).toContain("Iteration 2");
		expect(content).toContain("test fail");
	});

	it("maxEntries 截断:超 2 条保留最近 2 条", () => {
		const notes = new FileSharedTaskNotes({ dir, maxEntries: 2 });
		notes.write({ iteration: 1, replySummary: "a", gatePassed: true, merged: true });
		notes.write({ iteration: 2, replySummary: "b", gatePassed: true, merged: true });
		notes.write({ iteration: 3, replySummary: "c", gatePassed: true, merged: true });
		const content = notes.read();
		expect(content).not.toContain("Iteration 1");
		expect(content).toContain("Iteration 2");
		expect(content).toContain("Iteration 3");
	});

	it("reviewVerdict/reviewIssues/error 字段写入", () => {
		const notes = new FileSharedTaskNotes({ dir });
		notes.write({
			iteration: 1,
			replySummary: "x",
			gatePassed: false,
			merged: false,
			reviewVerdict: "naughty",
			reviewIssues: ["slop", "missing test"],
			error: "merge conflict",
		});
		const content = notes.read();
		expect(content).toContain("naughty");
		expect(content).toContain("slop");
		expect(content).toContain("merge conflict");
	});

	it("文件落在 dir/SHARED_TASK_NOTES.md", () => {
		const notes = new FileSharedTaskNotes({ dir });
		notes.write({ iteration: 1, replySummary: "a", gatePassed: true, merged: true });
		expect(existsSync(join(dir, "SHARED_TASK_NOTES.md"))).toBe(true);
	});

	it("dir 不存在时 write 自动创建", () => {
		const notes = new FileSharedTaskNotes({ dir: join(dir, "sub") });
		notes.write({ iteration: 1, replySummary: "a", gatePassed: true, merged: true });
		expect(notes.read()).toContain("Iteration 1");
	});
});
