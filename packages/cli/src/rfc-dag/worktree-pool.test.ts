// packages/cli/src/rfc-dag/worktree-pool.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DryRunWorktreeOps } from "./worktree-pool.js";

function mkRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "wt-"));
	execSync("git init -b main", { cwd: dir, stdio: "ignore" });
	execSync('git config user.email t@t.t && git config user.name t', { cwd: dir, shell: true });
	writeFileSync(join(dir, "a.txt"), "a");
	execSync("git add a.txt && git commit -m init", { cwd: dir, shell: true, stdio: "ignore" });
	return dir;
}

describe("DryRunWorktreeOps", () => {
	let repo: string;
	beforeEach(() => { repo = mkRepo(); });
	afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

	it("addWorktree 创建 worktree + branch(含初始文件)", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		expect(existsSync(join(wt, "a.txt"))).toBe(true);
		expect(execSync("git -C " + JSON.stringify(repo) + " branch --list", { encoding: "utf8" })).toContain("rfc-dag/u1");
	});

	it("removeWorktree 删除 worktree 目录", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		await ops.removeWorktree(wt);
		expect(existsSync(wt)).toBe(false);
	});

	it("addWorktree 残留路径(未 remove 再 add 同路径)→ --force 重建不 throw", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		await expect(ops.addWorktree(wt, "rfc-dag/u1")).resolves.not.toThrow();
	});

	it("addWorktree 残留 branch(remove 后 branch 留,再 add 同 branch)→ -B 重建不 throw", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		await ops.removeWorktree(wt);
		await expect(ops.addWorktree(wt, "rfc-dag/u1")).resolves.not.toThrow();
	});

	it("removeWorktree 不存在路径 → non-fatal 不 throw", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		await expect(ops.removeWorktree(join(repo, "nope"))).resolves.not.toThrow();
	});
});
