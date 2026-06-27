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
		this.data = JSON.parse(readFileSync(this.path, "utf-8"));
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
