/**
 * cli systemPrompt 与 skills 注入。见 ARCHITECTURE.md §4.4 / §5。
 *
 * 职责：在构造 AgentForgeHarness 前，从默认 skills 目录（~/.agents/skills +
 * ~/.agentforge/skills + <cwd>/.agentforge/skills）加载 skills，分类（daily/library），把 daily skills
 * 格式化为 <available_skills> 块并拼到 base systemPrompt 之后。
 * 同时加载项目根目录的 AGENTS.md（若存在）注入 systemPrompt，让 LLM 遵循项目开发规范。
 *
 * 抽成可测函数 createSystemPromptWithSkills(basePrompt, dirs, agentsMdPath?)：便于单测注入。
 * repl/print-mode/rpc/loop 调用它替换原本直接传 DEFAULT_SYSTEM_PROMPT 的位置。
 *
 * 无 skills 时（空目录/不存在/全是 library）返回 basePrompt 不变——不污染 systemPrompt。
 * 无 AGENTS.md 时不注入。
 */
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	loadSkills,
	classifySkill,
	formatSkillsForSystemPrompt,
} from "@agentforge/harness";

/**
 * 默认 skills 发现目录：~/.agents/skills + ~/.agentforge/skills + <cwd>/.agentforge/skills。
 * 见 ARCHITECTURE.md §4.4。
 *
 * 优先级（loadSkills 按数组顺序扫描，同名 skill 后出现的覆盖先前的）：
 *  1. ~/.agents/skills      ← 用户全局 skill（兼容旧路径）
 *  2. ~/.agentforge/skills   ← 用户全局 skill（agentforge 原生路径）
 *  3. <cwd>/.agentforge/skills ← 当前项目 skill（项目特定）
 */
export function defaultSkillDirs(): string[] {
	return [
		`${homedir()}/.agents/skills`,
		`${homedir()}/.agentforge/skills`,
		`${process.cwd()}/.agentforge/skills`,
	];
}

/**
 * 默认 AGENTS.md 路径：<cwd>/AGENTS.md。
 */
export function defaultAgentsMdPath(): string {
	return join(process.cwd(), "AGENTS.md");
}

/**
 * 加载 AGENTS.md 内容（若文件存在）。不存在返回空串。
 *
 * @param filePath AGENTS.md 绝对路径。
 * @returns 文件内容或空串。
 */
export function loadAgentsMd(filePath: string): string {
	if (!existsSync(filePath)) return "";
	try {
		return readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

/**
 * 组装完整 systemPrompt：basePrompt + AGENTS.md（若有）+ daily skills 块（若有）。
 *
 * @param basePrompt 原 systemPrompt（如 DEFAULT_SYSTEM_PROMPT）。
 * @param dirs skills 发现目录。
 * @param agentsMdPath AGENTS.md 路径（默认 defaultAgentsMdPath()）。
 * @returns 拼接后的 systemPrompt。
 */
export function createSystemPromptWithSkills(
	basePrompt: string,
	dirs: string[],
	agentsMdPath?: string,
): string {
	let prompt = basePrompt;

	// 注入 AGENTS.md（项目开发规范）。
	const agentsPath = agentsMdPath ?? defaultAgentsMdPath();
	const agentsContent = loadAgentsMd(agentsPath);
	if (agentsContent) {
		prompt = `${prompt}\n\n${agentsContent}`;
	}

	// 注入 daily skills 块。
	// ~/.agents/skills 下的 skill 默认算 daily（用户显式安装的 skill 不需要逐个标记）。
	const agentsSkillsDir = `${homedir()}/.agents/skills`;
	const defaultClassifications: Record<string, "daily" | "library"> = {
		[agentsSkillsDir]: "daily",
	};
	const skills = loadSkills(dirs, defaultClassifications);
	const daily = skills.filter((s) => classifySkill(s) === "daily");
	const block = formatSkillsForSystemPrompt(daily);
	if (block !== "") {
		prompt = `${prompt}\n\n${block}`;
	}

	return prompt;
}
