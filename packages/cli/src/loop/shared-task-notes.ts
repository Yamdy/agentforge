// packages/cli/src/loop/shared-task-notes.ts
/**
 * 跨迭代上下文桥(spec §4.4)。SHARED_TASK_NOTES.md 记每轮 Progress + Next Steps,
 * 下轮 agent prompt 注入 read() 内容,实现跨迭代记忆(anti-pattern 2)。
 *
 * 文件落在传入 dir(调用方用 .agentforge/loop/,spec D12,不污染 repo、不被 git 追踪)。
 * maxEntries 截断轮转:red-team 🟡5b,防 notes 无界增长撑爆 agent prompt。
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface IterationProgress {
	iteration: number;
	replySummary: string;
	gatePassed: boolean;
	gateOutput?: string;
	reviewVerdict?: "nice" | "naughty";
	reviewIssues?: string[];
	merged: boolean;
	error?: string;
	nextSteps?: string;
}

export interface SharedTaskNotes {
	/** 读 SHARED_TASK_NOTES.md(不存在 → "")。 */
	read(): string;
	/** 追加一条 Progress 段;超 maxEntries 保留最近 N 条。 */
	write(progress: IterationProgress): void;
	/** 清空 notes:删除文件,下次 read 返 ""。每次 loop 运行开始重置(spec §4.4)。 */
	reset(): void;
}

export interface FileSharedTaskNotesOptions {
	dir: string;
	/** 保留最近多少条 Progress 段。默认 20。 */
	maxEntries?: number;
}

const FILENAME = "SHARED_TASK_NOTES.md";

export class FileSharedTaskNotes implements SharedTaskNotes {
	private readonly filePath: string;
	private readonly maxEntries: number;

	constructor(opts: FileSharedTaskNotesOptions) {
		this.filePath = join(opts.dir, FILENAME);
		this.maxEntries = opts.maxEntries ?? 20;
	}

	read(): string {
		if (!existsSync(this.filePath)) return "";
		return readFileSync(this.filePath, "utf8");
	}

	write(progress: IterationProgress): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const existing = this.read();
		const updated = existing + formatProgress(progress);
		const trimmed = trimToMaxEntries(updated, this.maxEntries);
		writeFileSync(this.filePath, trimmed, "utf8");
	}

	reset(): void {
		if (existsSync(this.filePath)) {
			unlinkSync(this.filePath);
		}
	}
}

/** Progress → markdown 段。 */
function formatProgress(p: IterationProgress): string {
	const lines: string[] = [`## Iteration ${p.iteration}`];
	lines.push(`- Reply: ${p.replySummary}`);
	lines.push(
		`- Gate: ${p.gatePassed ? "passed" : "failed"}${p.gateOutput ? ` | ${truncate(p.gateOutput, 500)}` : ""}`,
	);
	if (p.reviewVerdict) {
		lines.push(
			`- Review: ${p.reviewVerdict}${p.reviewIssues?.length ? ` | ${p.reviewIssues.join("; ")}` : ""}`,
		);
	}
	lines.push(`- Merged: ${p.merged}`);
	if (p.error) lines.push(`- Error: ${truncate(p.error, 500)}`);
	if (p.nextSteps) lines.push(`- Next Steps: ${p.nextSteps}`);
	lines.push("");
	return lines.join("\n") + "\n";
}

/** 按 "## Iteration " 分段,保留最近 maxEntries 条(删最旧)。 */
function trimToMaxEntries(content: string, maxEntries: number): string {
	const parts = content.split(/^## Iteration /m);
	const header = parts[0] ?? "";
	const segments = parts.slice(1);
	if (segments.length <= maxEntries) return content;
	const kept = segments.slice(segments.length - maxEntries);
	return header + "## Iteration " + kept.join("## Iteration ");
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) + "…" : s;
}
