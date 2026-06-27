// packages/cli/src/rfc-dag/worktree-pool.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface WorktreeOps {
	/** git worktree add --force <path> -B <branch>(--force 清路径残留,-B 重建 branch 残留)。 */
	addWorktree(path: string, branch: string): Promise<void>;
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

export class DryRunWorktreeOps implements WorktreeOps {
	constructor(private opts: DryRunWorktreeOpsOpts) {}

	async addWorktree(path: string, branch: string): Promise<void> {
		const cwd = shq(this.opts.cwd);
		const cmd = `git -C ${cwd} worktree add --force -B ${shq(branch)} ${shq(path)}`;
		try {
			await execAsync(cmd);
		} catch {
			// 残留:活跃 worktree 占用 branch(prune 不清活跃目录)→ remove --force 先释放;
			//       残留 .git/worktrees 注册 → prune 清。两者 best-effort 后重试。
			await execAsync(`git -C ${cwd} worktree remove --force ${shq(path)}`).catch(() => {});
			await execAsync(`git -C ${cwd} worktree prune`).catch(() => {});
			await execAsync(cmd);
		}
	}

	async removeWorktree(path: string): Promise<void> {
		try {
			await execAsync(`git -C ${shq(this.opts.cwd)} worktree remove --force ${shq(path)}`);
		} catch {
			// non-fatal(残留下轮 addWorktree --force 清)
		}
	}
}
