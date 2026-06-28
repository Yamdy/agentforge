/**
 * cli systemPrompt 与 skills 注入。见 ARCHITECTURE.md §4.4 / §5。
 *
 * 职责：在构造 AgentForgeHarness 前，从默认 skills 目录（~/.agents/skills +
 * ~/.agentforge/skills + <cwd>/.agentforge/skills）加载 skills，分类（daily/library），把 daily skills
 * 格式化为 <available_skills> 块并拼到 base systemPrompt 之后。
 *
 * 抽成可测函数 createSystemPromptWithSkills(basePrompt, dirs)：便于单测注入临时目录。
 * repl/print-mode 调用它替换原本直接传 DEFAULT_SYSTEM_PROMPT 的位置。
 *
 * 无 skills 时（空目录/不存在/全是 library）返回 basePrompt 不变——不污染 systemPrompt。
 */
import { homedir } from "node:os";
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
 * 加载 dirs 下的 skills，分类出 daily，把 daily 块拼到 basePrompt 之后。
 * 无 daily skills 时返回 basePrompt 原值（不拼接空块）。
 *
 * @param basePrompt 原 systemPrompt（如 DEFAULT_SYSTEM_PROMPT）。
 * @param dirs skills 发现目录（如 [~/.agentforge/skills, <cwd>/.agentforge/skills]）。
 * @returns 拼接了 skills 块的 systemPrompt，或原 basePrompt。
 */
export function createSystemPromptWithSkills(
	basePrompt: string,
	dirs: string[],
): string {
	const skills = loadSkills(dirs);
	const daily = skills.filter((s) => classifySkill(s) === "daily");
	const block = formatSkillsForSystemPrompt(daily);
	if (block === "") return basePrompt;
	return `${basePrompt}\n\n${block}`;
}
