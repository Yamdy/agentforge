import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DryRunGitOps } from "./git-ops.js";

let dir: string;
let git: DryRunGitOps;

function sh(cmd: string): string {
	return execSync(cmd, { cwd: dir }).toString().trim();
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "gitops-"));
	sh("git init -b main");
	sh('git config user.email "t@t"');
	sh('git config user.name "t"');
	writeFileSync(join(dir, "README.md"), "init");
	sh("git add -A && git commit -m init");
	git = new DryRunGitOps({ cwd: dir });
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("DryRunGitOps", () => {
	it("currentBranch → main", async () => {
		expect(await git.currentBranch()).toBe("main");
	});

	it("isClean(无改动)→ true", async () => {
		expect(await git.isClean()).toBe(true);
	});

	it("hasChanges(无)→ false;(改文件后)→ true", async () => {
		expect(await git.hasChanges()).toBe(false);
		writeFileSync(join(dir, "a.txt"), "a");
		expect(await git.hasChanges()).toBe(true);
	});

	it("createBranch + checkout → currentBranch 切换", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		expect(await git.currentBranch()).toBe("feature");
	});

	it("commit(有改动)→ true 且 working tree 干净 + message 落盘", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "a.txt"), "a");
		const committed = await git.commit("add a");
		expect(committed).toBe(true);
		expect(await git.isClean()).toBe(true);
		expect(sh("git log -1 --pretty=%s")).toBe("add a");
	});

	it("commit(无改动)→ false", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		const committed = await git.commit("nothing");
		expect(committed).toBe(false);
	});

	it("merge feature → main:ok=true", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "a.txt"), "a");
		await git.commit("add a");
		await git.checkout("main");
		const r = await git.merge("feature");
		expect(r.ok).toBe(true);
	});

	it("merge 冲突 → ok=false, conflict truthy, main 恢复干净", async () => {
		writeFileSync(join(dir, "f.txt"), "main\n");
		sh("git add -A && git commit -m base");
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "f.txt"), "feature\n");
		await git.commit("feature-change");
		await git.checkout("main");
		writeFileSync(join(dir, "f.txt"), "main2\n");
		await git.commit("main-change");
		const r = await git.merge("feature");
		expect(r.ok).toBe(false);
		expect(r.conflict).toBeTruthy();
		// merge --abort 后 main 干净,可下轮操作
		expect(await git.isClean()).toBe(true);
	});

	it("diff(有未 commit 改动)→ 含改动文件名", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "a.txt"), "a");
		const d = await git.diff();
		expect(d).toContain("a.txt");
	});

	it("tag → git tag -l 含该 tag", async () => {
		await git.tag("loop-rollback-x");
		expect(sh("git tag -l")).toContain("loop-rollback-x");
	});

	it("deleteBranch → 分支删除", async () => {
		await git.createBranch("feature");
		await git.checkout("feature");
		writeFileSync(join(dir, "a.txt"), "a");
		await git.commit("add a");
		await git.checkout("main");
		await git.deleteBranch("feature");
		expect(sh("git branch -l")).not.toContain("feature");
	});
});
