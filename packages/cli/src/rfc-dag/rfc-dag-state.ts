// packages/cli/src/rfc-dag/rfc-dag-state.ts
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Dag } from "./dag-decomposer.js";
import type { UnitState, UnitStatus } from "./dag-scheduler.js";

export interface RfcDagStateData {
	dag: Dag;
	units: Record<string, UnitState>;
	rollbackTag: string;
}

export interface RfcDagState {
	data: RfcDagStateData;
	load(): RfcDagStateData | null;
	save(): void;
	reset(): void;
	markUnit(id: string, status: UnitStatus, attempts?: number,
		context?: { lastError?: string; lastGateOutput?: string; lastReviewIssues?: string[] }): void;
}

export interface FileRfcDagStateOpts {
	dir: string;
	filename?: string;   // 默认 state.json
}

export class FileRfcDagState implements RfcDagState {
	data: RfcDagStateData = { dag: { units: [] }, units: {}, rollbackTag: "" };
	private path: string;

	constructor(private opts: FileRfcDagStateOpts) {
		this.path = join(opts.dir, opts.filename ?? "state.json");
	}

	load(): RfcDagStateData | null {
		if (!existsSync(this.path)) return null;
		// corrupt state.json(手改坏/中断写)→ 不抛 opaque 错,warn + 视作新 run(返 null)。
		// 比让整条 rfc-dag run 崩在 load 处更安全;旧进度丢失但可重跑。
		try {
			this.data = JSON.parse(readFileSync(this.path, "utf-8"));
		} catch (err) {
			console.warn(`rfc-dag-state: state.json 解析失败,视作新 run(旧进度丢弃): ${(err as Error).message}`);
			return null;
		}
		return this.data;
	}

	save(): void {
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf-8");
	}

	reset(): void {
		if (existsSync(this.path)) unlinkSync(this.path);
	}

	markUnit(id: string, status: UnitStatus, attempts?: number,
		context?: { lastError?: string; lastGateOutput?: string; lastReviewIssues?: string[] }): void {
		const u = this.data.units[id];
		if (!u) return;
		u.status = status;
		if (attempts != null) u.attempts = attempts;
		if (context?.lastError != null) u.lastError = context.lastError;
		if (context?.lastGateOutput != null) u.lastGateOutput = context.lastGateOutput;
		if (context?.lastReviewIssues != null) u.lastReviewIssues = context.lastReviewIssues;
	}
}
