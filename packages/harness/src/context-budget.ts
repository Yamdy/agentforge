/**
 * ContextBudget 模块：上下文 token 预算审计。见 ARCHITECTURE.md §4.3。
 *
 * 职责：审计 system prompt / skills / tools / history 的 token 开销，
 * 给出优化建议（哪个 skill 该降级 LIBRARY、哪个 tool schema 太大、
 * history 是否该 compaction）。pi 无此模块，完全自写。
 *
 * token 估算策略：chars/4 近似（与 compaction.ts 的 estimateTokens 同启发式，
 * pi-ai 未暴露 tokenizer）。history 复用 compaction.estimateTotalTokens，
 * 字符串/块在此模块新增 estimateStringTokens。
 *
 * memory 组件：T6 起由 audit(input.memory) 估 tokens 单独计入 components.memory，
 * 不并入 systemPrompt（避免双重计数）；T7 由 harness 传入 instinctBlock。
 */
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { estimateTotalTokens } from "./compaction.js";
import {
	formatSkillsForSystemPrompt,
	type Skill,
} from "./skills.js";

/**
 * 估算字符串的 token 数：chars/4 向上取整，不足 1 token 计 1。
 * 与 compaction.estimateTokens 同启发式。
 */
export function estimateStringTokens(str: string): number {
	return Math.max(1, Math.ceil(str.length / 4));
}

/** 审计建议：针对某个组件的优化动作。 */
export interface BudgetSuggestion {
	/** 触发建议的组件。 */
	component: "systemPrompt" | "skills" | "tools" | "history";
	/** 建议动作。 */
	action: string;
	/** 触发原因。 */
	reason: string;
}

/** 各组件 token 开销。 */
export interface BudgetComponents {
	systemPrompt: number;
	skills: number;
	tools: number;
	history: number;
	/** memory 组件 tokens（T6 起 audit 填充：input.memory 估 tokens；未传 → undefined）。 */
	memory?: number;
}

/** audit 产物。 */
export interface BudgetReport {
	/** 各组件 token 估算。 */
	components: BudgetComponents;
	/** 总 token 数（各组件之和）。 */
	total: number;
	/** 优化建议（无超阈值时为空数组）。 */
	suggestions: BudgetSuggestion[];
}

/** audit 输入。 */
export interface BudgetAuditInput {
	systemPrompt: string;
	/** daily skills（audit 内部用 formatSkillsForSystemPrompt 生成块再估 tokens）。 */
	skills: Skill[];
	/** 工具列表（各 tool schema JSON.stringify 后 chars/4，总和）。 */
	tools: AgentTool[];
	/** 对话历史（复用 compaction.estimateTotalTokens）。 */
	messages: AgentMessage[];
	/**
	 * memory 块（instinct/memory 文本，独立于 systemPrompt 估 tokens，避免双重计数）。
	 * T6 接通；T7 由 harness 传入 instinctBlock。
	 */
	memory?: string;
	/** 可配置阈值。 */
	thresholds?: BudgetThresholds;
	/** 模型上下文窗口（用于 history 占比建议与 headroom）。 */
	modelContextWindow?: number;
}

/** audit 阈值（可注入，Slice 1 最小版默认值见 DEFAULT_THRESHOLDS）。 */
export interface BudgetThresholds {
	/** skills 块 tokens 超此值 → 建议降级部分 daily skill 到 library。 */
	skillsBlock?: number;
	/** 单个 tool schema tokens 超此值 → 建议精简该 tool schema。 */
	toolSchema?: number;
	/** history tokens 占 modelContextWindow 比例超此值 → 建议触发 compaction。 */
	historyRatio?: number;
}

/** 默认阈值。compendium 每 tool schema ~500 tokens；skills 块 2000 tokens。 */
export const DEFAULT_THRESHOLDS: Required<BudgetThresholds> = {
	skillsBlock: 2000,
	toolSchema: 500,
	historyRatio: 0.8,
};

/** audit 输入。 */
export function audit(input: BudgetAuditInput): BudgetReport {
	const thresholds: Required<BudgetThresholds> = {
		skillsBlock: input.thresholds?.skillsBlock ?? DEFAULT_THRESHOLDS.skillsBlock,
		toolSchema: input.thresholds?.toolSchema ?? DEFAULT_THRESHOLDS.toolSchema,
		historyRatio: input.thresholds?.historyRatio ?? DEFAULT_THRESHOLDS.historyRatio,
	};
	const systemPrompt = estimateStringTokens(input.systemPrompt);
	const skillsBlock = formatSkillsForSystemPrompt(input.skills);
	const skills = skillsBlock === "" ? 0 : estimateStringTokens(skillsBlock);
	const suggestions: BudgetSuggestion[] = [];
	let tools = 0;
	for (const tool of input.tools) {
		const toolTokens = estimateStringTokens(JSON.stringify(tool));
		tools += toolTokens;
		if (toolTokens > thresholds.toolSchema) {
			const toolName =
				(typeof (tool as any).name === "string" && (tool as any).name) ||
				(typeof (tool as any).label === "string" && (tool as any).label) ||
				"unknown";
			suggestions.push({
				component: "tools",
				action: `simplify schema for tool "${toolName}"`,
				reason: `tool "${toolName}" schema ${toolTokens} tokens exceeds ${thresholds.toolSchema} threshold`,
			});
		}
	}
	const history = estimateTotalTokens(input.messages);
	const memory = input.memory ? estimateStringTokens(input.memory) : undefined;
	const components: BudgetComponents = {
		systemPrompt,
		skills,
		tools,
		history,
		memory,
	};
	const total =
		components.systemPrompt +
		components.skills +
		components.tools +
		components.history +
		(memory ?? 0);
	if (skills > thresholds.skillsBlock) {
		const names = input.skills.map((s) => s.name).join(", ");
		suggestions.push({
			component: "skills",
			action: `demote some daily skills (${names}) to library`,
			reason: `skills block ${skills} tokens exceeds ${thresholds.skillsBlock} threshold`,
		});
	}

	if (input.modelContextWindow && input.modelContextWindow > 0) {
		const ratio = history / input.modelContextWindow;
		if (ratio > thresholds.historyRatio) {
			suggestions.push({
				component: "history",
				action: "trigger compaction to summarize old history",
				reason: `history ${history} tokens is ${Math.round(ratio * 100)}% of context window ${input.modelContextWindow}, exceeds ${thresholds.historyRatio * 100}% threshold`,
			});
		}
	}
	return {
		components,
		total,
		suggestions,
	};
}

/**
 * 计算上下文剩余空间：max(0, modelContextWindow - total)。
 * 超出窗口返回 0，不抛（调用方据此判断是否需 compaction）。
 */
export function headroom(total: number, modelContextWindow: number): number {
	return Math.max(0, modelContextWindow - total);
}
