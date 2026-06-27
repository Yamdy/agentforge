import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface MergeResult {
	ok: boolean;
	conflict?: string;
}

export interface GitOps {
	createBranch(name: string): Promise<void>;
	checkout(name: string): Promise<void>;
	commit(message: string): Promise<boolean>;
	merge(branch: string): Promise<MergeResult>;
	currentBranch(): Promise<string>;
	hasChanges(): Promise<boolean>;
	deleteBranch(name: string): Promise<void>;
	diff(): Promise<string>;
	tag(name: string): Promise<void>;
	isClean(): Promise<boolean>;
}

export interface DryRunGitOpsOptions {
	cwd: string;
}

/**
 * DryRunGitOps:名「DryRun」实指「不 push/不开 PR」(dry-run 自举),**本地 git 操作全真执行**
 * (checkout -B/createBranch、add+commit、merge、tag、branch -D 均真跑)。命名遗留,非阻塞;
 * 未来真 GitHub adapter 替代后可重命名 LocalGitOps。spec §1 自举 dry-run。
 */
export class DryRunGitOps implements GitOps {
	private readonly cwd: string;

	constructor(opts: DryRunGitOpsOptions) {
		this.cwd = opts.cwd;
	}

	private async run(args: string): Promise<string> {
		const { stdout } = await execAsync(`git ${args}`, { cwd: this.cwd });
		return stdout.toString().trim();
	}

	async createBranch(name: string): Promise<void> {
		// -B:若分支存在(上轮 loop 残留 iter 分支)则重建,不抛 already exists(问题④)。
		await this.run(`checkout -B ${name}`);
	}

	async checkout(name: string): Promise<void> {
		await this.run(`checkout ${name}`);
	}

	async commit(message: string): Promise<boolean> {
		if (!(await this.hasChanges())) return false;
		await this.run(`add -A`);
		await this.run(`commit -m ${shellQuote(message)}`);
		return true;
	}

	async merge(branch: string): Promise<MergeResult> {
		try {
			await this.run(`merge --no-edit ${branch}`);
			return { ok: true };
		} catch (e) {
			const stderr = e instanceof Error ? e.message : String(e);
			let conflict = "merge conflict";
			try {
				const files = await this.run(`diff --name-only --diff-filter=U`);
				if (files) conflict = `conflict in: ${files}`;
				else conflict = stderr;
			} catch {
				conflict = stderr;
			}
			// abort 恢复 main 到合并前干净状态(防 conflict 状态污染下轮)。
			try {
				await this.run(`merge --abort`);
			} catch {
				// 可能已无 in-progress merge,忽略。
			}
			return { ok: false, conflict };
		}
	}

	async currentBranch(): Promise<string> {
		return this.run(`rev-parse --abbrev-ref HEAD`);
	}

	async hasChanges(): Promise<boolean> {
		const status = await this.run(`status --porcelain`);
		return status.length > 0;
	}

	async deleteBranch(name: string): Promise<void> {
		await this.run(`branch -D ${name}`);
	}

	async diff(): Promise<string> {
		const tracked = await this.run(`diff HEAD`);
		const untracked = await this.run(`ls-files --others --exclude-standard`);
		return tracked + (untracked ? `\n[untracked]\n${untracked}` : "");
	}

	async tag(name: string): Promise<void> {
		await this.run(`tag ${name}`);
	}

	async isClean(): Promise<boolean> {
		return !(await this.hasChanges());
	}
}

/** 简单双引号转义(本 slice commit message 单行够用)。 */
function shellQuote(s: string): string {
	return `"${s.replace(/"/g, '\\"')}"`;
}
