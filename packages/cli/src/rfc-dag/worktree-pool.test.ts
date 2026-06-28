// packages/cli/src/rfc-dag/worktree-pool.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// vi.mock 必须在 import SUT 之前(提升)。用模块级 stub holder 让每个测试按需注入 rm/rename 行为,
// 默认透传真实实现。ESM namespace 不可配置,vi.spyOn 会失败(红队指出),故用 vi.mock。
type RmImpl = (path: fsPromises.PathLike, opts?: fsPromises.RmOptions) => Promise<void>;
type RenameImpl = (oldPath: fsPromises.PathLike, newPath: fsPromises.PathLike) => Promise<void>;
let rmImpl: RmImpl | null = null;
let renameImpl: RenameImpl | null = null;
// vi.importActual 绕过 vi.mock 拿真实 fs/promises(mock 内外都用同一份 actual.rm,避免代理递归)。
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		rm: ((p: fsPromises.PathLike, o?: fsPromises.RmOptions) =>
			(rmImpl ?? actual.rm)(p, o)) as RmImpl,
		rename: ((o: fsPromises.PathLike, n: fsPromises.PathLike) =>
			(renameImpl ?? actual.rename)(o, n)) as RenameImpl,
	};
});

import * as fsPromises from "node:fs/promises";
import { DryRunWorktreeOps, rmWithBackoff } from "./worktree-pool.js";

function mkRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "wt-"));
	execSync("git init -b main", { cwd: dir, stdio: "ignore" });
	execSync('git config user.email t@t.t && git config user.name t', { cwd: dir, shell: true });
	writeFileSync(join(dir, "a.txt"), "a");
	execSync("git add a.txt && git commit -m init", { cwd: dir, shell: true, stdio: "ignore" });
	return dir;
}

function ebusy(): NodeJS.ErrnoException {
	const e = new Error("EBUSY") as NodeJS.ErrnoException;
	e.code = "EBUSY";
	return e;
}

describe("DryRunWorktreeOps", () => {
	let repo: string;
	beforeEach(() => { repo = mkRepo(); rmImpl = null; renameImpl = null; });
	afterEach(() => { vi.restoreAllMocks(); rmImpl = null; renameImpl = null; rmSync(repo, { recursive: true, force: true }); });

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

	// --- 问题 C 修复(rfc-dag worktree EBUSY → already exists)---
	// 以下用例覆盖 pre-clean + robust-remove(rmWithBackoff 退避)+ 逃生通道 + 诊断 throw。
	// 注:Windows 真实句柄锁无法在非 Windows CI 复现,这里用 vi.mock 注入 EBUSY errno 跨平台模拟
	//     瞬态句柄占用,以及手构物理残留/伪造注册复现 already exists 链路。ESM namespace 不可配置,
	//     故用 vi.mock(而非 vi.spyOn)替换 fsPromises.rm——红队指出的假绿陷阱。

	it("rmWithBackoff:瞬态 EBUSY 指数退避重试直至成功", async () => {
		const wt = join(repo, ".agentforge", "worktrees", "retry");
		mkdirSync(wt, { recursive: true });
		const orig = realFs.rm.bind(realFs);
		let calls = 0;
		rmImpl = async (p, o) => {
			calls++;
			if (calls <= 2) throw ebusy();
			return orig(p, o);
		};
		await rmWithBackoff(wt, { repoCwd: repo, tries: 5, baseDelayMs: 1 });
		expect(calls).toBeGreaterThanOrEqual(3);  // 退避重试生效(spy 拦截 + 重试)
		expect(existsSync(wt)).toBe(false);
	});

	it("rmWithBackoff:非 transient errno(ENOTDIR)立即 throw 不重试", async () => {
		const wt = join(repo, ".agentforge", "worktrees", "notransient");
		let calls = 0;
		rmImpl = async () => {
			calls++;
			const e = new Error("ENOTDIR") as NodeJS.ErrnoException;
			e.code = "ENOTDIR";
			throw e;
		};
		await expect(rmWithBackoff(wt, { repoCwd: repo, tries: 5, baseDelayMs: 1 })).rejects.toThrow();
		expect(calls).toBe(1);   // 不滥重试
	});

	it("rmWithBackoff:护栏跳过非 worktrees 路径(不调 fs.rm)", async () => {
		let called = false;
		rmImpl = async () => { called = true; };
		// 仓库根路径 → 护栏 skip,不删源码。
		await rmWithBackoff(repo, { repoCwd: repo, tries: 3, baseDelayMs: 1 });
		expect(called).toBe(false);
		expect(existsSync(join(repo, "a.txt"))).toBe(true);  // 源码未动
	});

	it("removeWorktree:fs.rm 抛 EBUSY 时退避重试直至成功(non-fatal)", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		mkdirSync(wt, { recursive: true });   // 物理目录(无 git 注册)→ git remove 失败 → 走 rmWithBackoff
		const orig = realFs.rm.bind(realFs);
		let calls = 0;
		rmImpl = async (p, o) => {
			calls++;
			if (calls <= 2) throw ebusy();
			return orig(p, o);
		};
		await expect(ops.removeWorktree(wt)).resolves.not.toThrow();
		expect(calls).toBeGreaterThanOrEqual(3);
		expect(existsSync(wt)).toBe(false);
	});

	it("removeWorktree:持续 EBUSY 退避耗尽仍 non-fatal", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		mkdirSync(wt, { recursive: true });
		let calls = 0;
		rmImpl = async () => { calls++; throw ebusy(); };
		await expect(ops.removeWorktree(wt)).resolves.not.toThrow();
		// 退避跑满(removeWorktree 两处 rmWithBackoff,各 tries=5 次)。
		expect(calls).toBeGreaterThanOrEqual(5);
	});

	it("addWorktree:物理目录残留(git 不知)→ pre-clean 后 add 成功[T2 already exists 易路径复现]", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		// 先正常建一个 worktree,再用 git remove --force 仅清注册+目录,模拟上次正常清理。
		await ops.addWorktree(wt, "rfc-dag/u1");
		execSync(`git -C ${JSON.stringify(repo)} worktree remove --force ${JSON.stringify(wt)}`, { stdio: "ignore" });
		// 手构 EBUSY 半删物理残留(目录回来但 git 不知)。
		mkdirSync(wt, { recursive: true });
		writeFileSync(join(wt, "stale.txt"), "x");
		// pre-clean 应清残留后 add 成功。
		await expect(ops.addWorktree(wt, "rfc-dag/u1")).resolves.not.toThrow();
		expect(existsSync(join(wt, "a.txt"))).toBe(true);
		expect(existsSync(join(wt, "stale.txt"))).toBe(false);
	});

	it("addWorktree:注册+物理目录双残留(伪造 .git/worktrees 注册)→ pre-clean 清两者后 add 成功[T2 真实链路跨平台复现]", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		await ops.addWorktree(wt, "rfc-dag/u1");
		// 先用 git 正常 remove(清注册+目录),再重建物理残留 + 伪造 .git/worktrees 注册(指向残留目录)。
		execSync(`git -C ${JSON.stringify(repo)} worktree remove --force ${JSON.stringify(wt)}`, { stdio: "ignore" });
		mkdirSync(wt, { recursive: true });
		writeFileSync(join(wt, "stale.txt"), "x");
		const adminDir = join(repo, ".git", "worktrees", "u1");
		mkdirSync(adminDir, { recursive: true });
		// 伪造完整注册(gitdir 带 .git 后缀 + commondir + HEAD,git prune 才认)。
		writeFileSync(join(adminDir, "gitdir"), join(wt, ".git"));
		writeFileSync(join(adminDir, "commondir"), "../..");
		writeFileSync(join(adminDir, "HEAD"), "ref: refs/heads/rfc-dag/u1");
		// pre-clean:rmWithBackoff 清物理残留 → prune 清伪造注册 → add 成功(重建真实注册)。
		// 注:add 成功后 git 会重建 .git/worktrees/u1 真实注册,故 adminDir 重新存在是预期;
		//     关键断言是 add 不 throw + a.txt 存在 + stale 残留被清。
		await expect(ops.addWorktree(wt, "rfc-dag/u1")).resolves.not.toThrow();
		expect(existsSync(join(wt, "a.txt"))).toBe(true);
		expect(existsSync(join(wt, "stale.txt"))).toBe(false);  // 物理残留被 pre-clean 清
	});

	it("addWorktree:最终失败时 throw 含 rm 诊断(区分 EBUSY 退避耗尽 vs 其他)", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		// 物理残留 + rm 永远 EBUSY(模拟永久句柄锁)+ rename 也失败 → 重试 add 仍 already exists。
		mkdirSync(wt, { recursive: true });
		writeFileSync(join(wt, "stale.txt"), "x");
		rmImpl = async () => { throw ebusy(); };
		renameImpl = async () => { throw new Error("rename failed"); };
		let err: unknown;
		try { await ops.addWorktree(wt, "rfc-dag/u1"); } catch (e) { err = e; }
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toMatch(/already exists|worktree/i);
		expect((err as Error).message).toMatch(/EBUSY|handle-lock|cleanup rm/i);  // 诊断附加
	});

	it("addWorktree:永久句柄锁 → 逃生通道 rename 后 add 成功(fatal 降级为可继续)", async () => {
		const ops = new DryRunWorktreeOps({ cwd: repo });
		const wt = join(repo, ".agentforge", "worktrees", "u1");
		// 先建一个真实 worktree(占住 rfc-dag/u1 branch + .git/worktrees 注册)。
		await ops.addWorktree(wt, "rfc-dag/u1");
		// 物理目录残留 + rm 永远 EBUSY,但 rename 成功(逃生通道放行)。
		rmImpl = async () => { throw ebusy(); };
		// 真实 rename 把残留挪走,add 用原路径成功。
		const origRename = realFs.rename.bind(realFs);
		renameImpl = async (o, n) => origRename(o, n);
		// 此时 wt 已存在(真实 worktree),pre-clean rm EBUSY 失败 → 首次 add 报 already exists →
		// catch:remove --force(可能失败)+ prune + rm EBUSY 失败 → 逃生 rename 挪走 wt → 重试 add 成功。
		await expect(ops.addWorktree(wt, "rfc-dag/u1")).resolves.not.toThrow();
		expect(existsSync(join(wt, "a.txt"))).toBe(true);
	});
});
