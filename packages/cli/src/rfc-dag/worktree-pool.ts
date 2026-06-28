// packages/cli/src/rfc-dag/worktree-pool.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fsPromises from "node:fs/promises";
import { existsSync } from "node:fs";

const execAsync = promisify(exec);

export interface WorktreeOps {
	/** git worktree add --force <path> -B <branch>(--force 清路径残留,-B 重建 branch 残留)。 */
	addWorktree(path: string, branch: string): Promise<void>;
	/** 在 worktree 跑 `pnpm install`(git worktree add 只 checkout 源文件,无 node_modules → gate typecheck/test 会因缺依赖失败)。 */
	installDeps(path: string): Promise<void>;
	/** git worktree remove --force <path>(失败 non-fatal)。 */
	removeWorktree(path: string): Promise<void>;
}

export interface DryRunWorktreeOpsOpts {
	cwd: string;
}

/** 简单 shell quote(路径/分支含空格)。 */
function shq(s: string): string {
	return `"${s.replace(/"/g, '\\"')}"`;
}

/** Windows 句柄延迟释放时会抛的 errno(瞬态,退避重试可解)。 */
const TRANSIENT_ERRNOS = new Set(["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"]);

/** 可被 AbortSignal 中断的 sleep(run 被 abort 时不浪费退避预算)。 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new Error("aborted"));
		const onAbort = () => { clearTimeout(t); reject(new Error("aborted")); };
		const t = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** 护栏:仅对 <repoCwd>/.agentforge/worktrees/ 下的路径调 fs.rm,防误删源码/仓库根。
 *  非 worktrees 路径 skip fs.rm,只靠 git 清理。 */
function isWorktreePath(path: string, repoCwd: string): boolean {
	const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
	return norm(path).includes("/.agentforge/worktrees/") && norm(path) !== norm(repoCwd);
}

/**
 * rmWithBackoff:fs.rm + 指数退避(50/100/200/400/800ms),攻击 Windows 句柄延迟释放这一 EBUSY 真因。
 * 仅对瞬态 errno(EBUSY/ENOTEMPTY/EPERM/EACCES)重试;非瞬态(ENOTDIR 等)立即 throw 不滥重试。
 * 护栏:非 worktrees 路径直接 return(不调 fs.rm)。
 *
 * 定位(诚实):显著缓解瞬态 EBUSY(崩溃恢复 + 短暂句柄释放竞争),非"根治"——
 *  永久句柄锁(zombie 进程/杀毒/索引器持锁)退避耗尽仍会 throw,由调用方 non-fatal 吞或逃生通道兜。
 */
export async function rmWithBackoff(
	path: string,
	opts: { tries?: number; baseDelayMs?: number; signal?: AbortSignal; repoCwd?: string } = {},
): Promise<void> {
	const tries = opts.tries ?? 5;
	const base = opts.baseDelayMs ?? 50;
	if (opts.repoCwd && !isWorktreePath(path, opts.repoCwd)) return;   // 护栏
	let lastErr: unknown;
	for (let i = 0; i < tries; i++) {
		try {
			await fsPromises.rm(path, { recursive: true, force: true });
			return;
		} catch (err) {
			lastErr = err;
			const code = (err as NodeJS.ErrnoException)?.code;
			const transient = code ? TRANSIENT_ERRNOS.has(code) : false;
			if (!transient || i === tries - 1) throw err;
			await sleep(base * 2 ** i, opts.signal);
		}
	}
	throw lastErr;
}

export class DryRunWorktreeOps implements WorktreeOps {
	constructor(private opts: DryRunWorktreeOpsOpts) {}

	async addWorktree(path: string, branch: string): Promise<void> {
		const cwd = shq(this.opts.cwd);
		const cmd = `git -C ${cwd} worktree add --force -B ${shq(branch)} ${shq(path)}`;
		// PRE-CLEAN(防御):首次 add 前主动清物理残留 + 注册。覆盖崩溃恢复场景——
		//   上次进程被杀,removeWorktree 从未对该残留调用,robust-remove 的源头止血管不到,
		//   pre-clean 的首次 add 前 rm 兜住。用 rmWithBackoff(非裸 rm):句柄正释放窗口内退避重试,
		//   崩溃恢复场景(句柄已释放)首次 rm 即成功不增延迟。
		if (existsSync(path)) {
			await rmWithBackoff(path, { repoCwd: this.opts.cwd }).catch(() => {});
			await execAsync(`git -C ${cwd} worktree prune`).catch(() => {});
		}
		try {
			await execAsync(cmd);
			return;
		} catch {
			// reactive 恢复:活跃 worktree 占用 branch(remove --force 先释放)+
			//   残留 .git/worktrees 注册(prune 清)+ EBUSY 物理残留(rmWithBackoff 退避清,
			//   git remove 清不掉被句柄占用的目录,fs.rm 是唯一能清的原语)+ 逃生通道(永久锁时重命名)。
			await execAsync(`git -C ${cwd} worktree remove --force ${shq(path)}`).catch(() => {});
			await execAsync(`git -C ${cwd} worktree prune`).catch(() => {});
			let rmErr: unknown = null;
			if (existsSync(path)) {
				rmErr = await rmWithBackoff(path, { repoCwd: this.opts.cwd }).catch((e: unknown) => e);
			}
			if (existsSync(path)) {
				// 逃生通道:永久句柄锁(zombie 进程)→ fs.rm 退避耗尽仍失败。重命名残留目录让 add 用原路径
				//   成功(stale 目录留待下次 pre-clean 异步清理)。把 fatal 降级为可继续。
				await fsPromises.rename(path, `${path}.stale-${Date.now()}`).catch(() => {});
				await execAsync(`git -C ${cwd} worktree prune`).catch(() => {});
			}
			try {
				await execAsync(cmd);
				return;
			} catch (retryErr) {
				// 诊断:把 rm 最后错误 + 句柄锁提示拼进 throw,让 runner lastError 能区分
				//   "EBUSY 退避耗尽" vs "其他系统性问题"(EACCES/路径配错),避免误诊反复重试。
				const rmCode = rmErr instanceof Error
					? `; cleanup rm: ${(rmErr as NodeJS.ErrnoException).code ?? rmErr.message}`
					: "";
				const lockHint = existsSync(path)
					? "; handle-lock suspected (kill zombie node/AV/indexer procs or rm -rf the dir manually)"
					: "";
				throw new Error(`${(retryErr as Error).message}${rmCode}${lockHint}`);
			}
		}
	}

	async installDeps(path: string): Promise<void> {
		try {
			await execAsync("pnpm install", { cwd: path });
			// build workspace 包 dist:tsc 走 dist(types condition),worktree 无 packages/*/dist(gitignore)→ typecheck 会因找不到 @agentforge/* 失败。
			await execAsync("pnpm -r build", { cwd: path });
		} catch {
			// best-effort:install/build 失败(无 package.json/lockfile 等)不阻塞——gate 会因缺依赖/dist 失败驱动 retry。
		}
	}

	async removeWorktree(path: string): Promise<void> {
		const cwd = shq(this.opts.cwd);
		// 顺序(锁住场景的正确顺序,红队修正:prune 必须在 fs.rm 成功之后才有意义——
		//   prune 语义是"删目录已不存在的 worktree 注册",目录还在时 prune 是 no-op):
		//   ① git worktree remove --force(注销 .git/worktrees,catch)→
		//   ② fs.rm 物理目录(rmWithBackoff 退避,catch;git remove 失败时这是清 EBUSY 残留的关键)→
		//   ③ git worktree prune(catch;② 成功则 prune 能清残留注册)→
		//   ④ 收尾扫描:仍存在则再 rm + prune(catch)。
		// 整体 non-fatal:任一步失败不 throw(残留下轮 addWorktree pre-clean 兜)。
		await execAsync(`git -C ${cwd} worktree remove --force ${shq(path)}`).catch(() => {});
		if (existsSync(path)) {
			await rmWithBackoff(path, { repoCwd: this.opts.cwd }).catch(() => {});
		}
		await execAsync(`git -C ${cwd} worktree prune`).catch(() => {});
		if (existsSync(path)) {
			await rmWithBackoff(path, { repoCwd: this.opts.cwd }).catch(() => {});
			await execAsync(`git -C ${cwd} worktree prune`).catch(() => {});
		}
	}
}
