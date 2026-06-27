import type { AgentRunner } from "../loop/agent-runner.js";

export interface WorkUnit {
	id: string;
	dependsOn: string[];
	scope: string;
	acceptanceTests: string[];
	riskLevel: 1 | 2 | 3;
	rollbackPlan: string;
}
export interface Dag { units: WorkUnit[]; }

export interface DagDecomposerDeps {
	agentRunner: AgentRunner;
	decomposePrompt?: (rfc: string) => string;
	maxUnits?: number;   // 默认 20
}

const DEFAULT_MAX_UNITS = 20;

const DECOMPOSE_PROMPT = (rfc: string) => `你是架构分解助手。把以下 RFC 分解成可独立验证的工作单元 DAG。
输出 JSON 数组,每个元素:{ id: string, dependsOn: string[], scope: string, acceptanceTests: string[], riskLevel: 1|2|3, rollbackPlan: string }
规则:id 唯一;dependsOn 只引用同数组内 id;无循环依赖;粒度适中(单 unit 单文件级)。
只输出 JSON 数组,不要其他文本。

RFC:
${rfc}`;

/** 剥 ```json...``` 围栏 + brace-fallback 提取首个 JSON 数组(类比 instinct parseInstinctsJson)。 */
function parseUnitsJson(reply: string): unknown[] {
	let s = reply.trim();
	const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) s = fence[1].trim();
	try {
		const parsed = JSON.parse(s);
		if (Array.isArray(parsed)) return parsed;
	} catch { /* fall through to brace-fallback */ }
	const start = s.indexOf("[");
	const end = s.lastIndexOf("]");
	if (start !== -1 && end !== -1 && end > start) {
		const sliced = s.slice(start, end + 1);
		const parsed = JSON.parse(sliced);   // 抛错由调用方 catch
		if (Array.isArray(parsed)) return parsed;
	}
	throw new Error("parse: reply 不含合法 JSON 数组");
}

function validateDag(units: WorkUnit[], maxUnits: number): void {
	if (units.length === 0) throw new Error("DAG 校验失败:至少 1 unit(≥1)");
	if (units.length > maxUnits) throw new Error(`DAG 校验失败:超 max-units(≤${maxUnits}),实际 ${units.length}`);
	const ids = new Set(units.map(u => u.id));
	if (ids.size !== units.length) throw new Error("DAG 校验失败:id 重复");
	// unitId 字符集校验:unitId 来自 AI decompose,会经 shq shell-quoting 进入 git worktree -B <branch>
	// (worktree-pool.ts:28)。仅引号转义不足以防注入——限制为 [a-zA-Z0-9_-] 后,shq 输出恒定安全。
	const ID_CHARSET = /^[a-zA-Z0-9_-]+$/;
	for (const u of units) {
		if (!ID_CHARSET.test(u.id)) throw new Error(`DAG 校验失败:unitId "${u.id}" 含非法字符(仅允许 a-zA-Z0-9_-)`);
	}
	for (const u of units) {
		for (const dep of u.dependsOn) {
			if (!ids.has(dep)) throw new Error(`DAG 校验失败:dependsOn "${dep}" 不存在(unit ${u.id})`);
		}
	}
	// 无环:DFS
	const color = new Map<string, number>();   // 0=未访 1=在栈 2=完成
	const adj = new Map<string, string[]>();
	for (const u of units) adj.set(u.id, u.dependsOn);
	const dfs = (id: string): void => {
		const c = color.get(id) ?? 0;
		if (c === 1) throw new Error(`DAG 校验失败:循环依赖(经 ${id})`);
		if (c === 2) return;
		color.set(id, 1);
		for (const dep of adj.get(id) ?? []) dfs(dep);
		color.set(id, 2);
	};
	for (const u of units) dfs(u.id);
}

function toWorkUnit(raw: unknown): WorkUnit {
	const r = raw as Record<string, unknown>;
	return {
		id: String(r.id),
		dependsOn: Array.isArray(r.dependsOn) ? r.dependsOn.map(String) : [],
		scope: String(r.scope ?? ""),
		acceptanceTests: Array.isArray(r.acceptanceTests) ? r.acceptanceTests.map(String) : [],
		riskLevel: ([1, 2, 3].includes(Number(r.riskLevel)) ? Number(r.riskLevel) : 2) as 1 | 2 | 3,
		rollbackPlan: String(r.rollbackPlan ?? ""),
	};
}

export class DagDecomposer {
	constructor(private deps: DagDecomposerDeps) {}

	async decompose(rfc: string): Promise<Dag> {
		const prompt = (this.deps.decomposePrompt ?? DECOMPOSE_PROMPT)(rfc);
		const { reply } = await this.deps.agentRunner.run(prompt, { cwd: process.cwd() });
		const raw = parseUnitsJson(reply);
		const units = raw.map(toWorkUnit);
		validateDag(units, this.deps.maxUnits ?? DEFAULT_MAX_UNITS);
		return { units };
	}
}
