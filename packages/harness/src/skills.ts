/**
 * Skills 模块：按需加载方法论 skill（SKILL.md + frontmatter）。见 ARCHITECTURE.md §4.4。
 *
 * 职责：
 *  - loadSkills(dirs)：扫 dirs 下 SKILL.md（带 frontmatter），递归子目录。
 *    frontmatter 是文件顶部 `---` YAML 块。解析 name/description/classification 等字段。
 *    无 frontmatter 的文件跳过。空目录/不存在目录返回空数组不抛。
 *  - classifySkill(skill, repoEvidence?)：优先 frontmatter.classification 显式字段；
 *    无则用启发式（repoEvidence 关键词与 skill name/description 匹配 → daily，否则 library）。
 *  - formatSkillsForSystemPrompt(daily)：生成 <available_skills> 块（每个 daily skill 的
 *    name + description）。空列表返回空串（不注入）。
 *  - invokeSkill(name, args?)：显式调用。Slice 1 最小版占位（返回 skill content 供 caller
 *    处理），真执行留后续 slice。
 *
 * frontmatter 解析参考 pi 蓝本（pi-agent-core/harness/skills.ts 的 parseFrontmatter），
 * 但不引入重 YAML 库——用最小手写解析只取 name/description/classification 等扁平字符串字段。
 * formatSkillsForSystemPrompt 参考 pi 蓝本（system-prompt.ts 的同名函数）生成 XML 块结构，
 * 但 agentforge 的块只含 name + description（不含 location，因 Slice 1 注入的是描述而非路径）。
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/** skill 分类：daily（常驻 system prompt）vs library（按需/检索）。 */
export type SkillClassification = "daily" | "library";

/** SKILL.md 顶部 frontmatter 的已知字段（其余字段以字符串保留）。 */
export interface SkillFrontmatter {
	/** 显式分类；缺省时由 classifySkill 启发式推断。 */
	classification?: SkillClassification;
	/** 任意其它 frontmatter 字段（字符串值）。 */
	[key: string]: string | undefined;
}

/** 一个已加载的 skill。 */
export interface Skill {
	/** skill 名（frontmatter.name 或父目录名）。 */
	name: string;
	/** skill 描述（frontmatter.description）。 */
	description: string;
	/** SKILL.md body（去掉 frontmatter 后的正文）。 */
	content: string;
	/** 解析出的 frontmatter 字段。 */
	frontmatter: SkillFrontmatter;
	/** SKILL.md 所在目录（skill 引用相对路径的基准）。 */
	sourceDir: string;
	/** SKILL.md 绝对路径。 */
	filePath: string;
}

/** classifySkill 的可注入仓库证据（agent-sort 思想）。Slice 1 简化为关键词数组。 */
export interface RepoEvidence {
	/** 当前仓库的关键词集合（如检测到的技术栈/任务关键词）。 */
	keywords: string[];
}

/**
 * 解析 frontmatter：文件顶部 `---\n...\n---` 块。
 * 无 frontmatter（不以 `---` 开头）或无闭合 `---` → 返回 null（调用方跳过该文件）。
 * 只解析扁平 `key: value` 行为字符串字段，不做完整 YAML（足够 Slice 1 需求）。
 */
export function parseFrontmatter(raw: string): {
	frontmatter: SkillFrontmatter;
	body: string;
} | null {
	const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return null;
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) return null;
	const yamlString = normalized.slice(3, endIndex).replace(/^\n/, "");
	const body = normalized.slice(endIndex + 4).replace(/^\n/, "");
	const frontmatter: SkillFrontmatter = {};
	for (const line of yamlString.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		const colon = trimmed.indexOf(":");
		if (colon === -1) continue;
		const key = trimmed.slice(0, colon).trim();
		const value = trimmed.slice(colon + 1).trim();
		if (key === "") continue;
		frontmatter[key] = value;
	}
	return { frontmatter, body };
}

/**
 * 从单个 SKILL.md 文件加载 skill。无 frontmatter 返回 null（跳过）。
 * name 取 frontmatter.name，缺省取父目录名。description 取 frontmatter.description。
 */
function loadSkillFromFile(filePath: string): Skill | null {
	const raw = readFileSync(filePath, "utf-8");
	const parsed = parseFrontmatter(raw);
	if (!parsed) return null;
	const { frontmatter, body } = parsed;
	const sourceDir = dirname(filePath);
	const parentDirName = basename(sourceDir);
	const name =
		typeof frontmatter.name === "string" && frontmatter.name !== ""
			? frontmatter.name
			: parentDirName;
	const description =
		typeof frontmatter.description === "string" ? frontmatter.description : "";
	return {
		name,
		description,
		content: body,
		frontmatter,
		sourceDir,
		filePath,
	};
}

function basename(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const slashIndex = Math.max(
		normalized.lastIndexOf("/"),
		normalized.lastIndexOf("\\"),
	);
	return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

/**
 * 递归扫描目录下所有 SKILL.md（带 frontmatter）。
 * - 空目录/不存在目录：返回空数组，不抛。
 * - 递归进入子目录。
 * - 跳过无 frontmatter 的 SKILL.md。
 *
 * @param dirs 扫描目录列表。
 * @param defaultClassifications 可选的目录→默认分类映射。当 skill 的 frontmatter
 *   没有显式 classification 字段时，若其所在目录命中此映射，则使用对应的默认分类。
 *   目录匹配用前缀（skill.sourceDir 以 dir 开头）。未命中时走 classifySkill 启发式。
 */
export function loadSkills(
	dirs: string[],
	defaultClassifications?: Record<string, SkillClassification>,
): Skill[] {
	const skills: Skill[] = [];
	for (const dir of dirs) {
		collectSkillsFromDir(dir, skills);
	}
	if (defaultClassifications) {
		const normalize = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/");
		for (const skill of skills) {
			if (skill.frontmatter.classification) continue; // 显式指定不覆盖
			const normSource = normalize(skill.sourceDir);
			for (const [dir, cls] of Object.entries(defaultClassifications)) {
				const normDir = normalize(dir);
				if (normSource === normDir || normSource.startsWith(normDir + "/")) {
					skill.frontmatter.classification = cls;
					break;
				}
			}
		}
	}
	return skills;
}

function collectSkillsFromDir(dir: string, out: Skill[]): void {
	if (!existsSync(dir)) return;
	let dirStat;
	try {
		dirStat = statSync(dir);
	} catch {
		return;
	}
	if (!dirStat.isDirectory()) return;

	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		let entryStat;
		try {
			entryStat = statSync(fullPath);
		} catch {
			continue;
		}
		if (entryStat.isDirectory()) {
			collectSkillsFromDir(fullPath, out);
		} else if (entryStat.isFile() && entry === "SKILL.md") {
			const skill = loadSkillFromFile(fullPath);
			if (skill) out.push(skill);
		}
	}
}

/**
 * 分类 skill：优先 frontmatter.classification 显式字段；
 * 无则用启发式——repoEvidence.keywords 与 skill name/description 关键词匹配 → daily，
 * 否则 library。repoEvidence 可注入留接口（agent-sort 证据驱动）。
 */
export function classifySkill(
	skill: Skill,
	repoEvidence?: RepoEvidence,
): SkillClassification {
	if (skill.frontmatter.classification === "daily") return "daily";
	if (skill.frontmatter.classification === "library") return "library";
	if (repoEvidence && repoEvidence.keywords.length > 0) {
		const haystack = `${skill.name} ${skill.description}`.toLowerCase();
		for (const kw of repoEvidence.keywords) {
			if (kw && haystack.includes(kw.toLowerCase())) return "daily";
		}
	}
	return "library";
}

/**
 * 生成注入 system prompt 的 <available_skills> 块，含每个 daily skill 的 name + description。
 * 空列表返回空串（不注入）。格式参考 pi 蓝本 system-prompt.ts 的同名函数。
 */
export function formatSkillsForSystemPrompt(daily: Skill[]): string {
	if (daily.length === 0) return "";
	const lines: string[] = [
		"The following skills provide specialized instructions for specific tasks.",
		"Read the full skill file when the task matches its description.",
		"",
		"<available_skills>",
	];
	for (const skill of daily) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push("  </skill>");
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * 显式调用 skill。Slice 1 最小版占位：返回 skill 的 content 供 caller 处理。
 * 找不到对应 name 的 skill 抛错。真执行（模型驱动 skill body）留后续 slice。
 */
export async function invokeSkill(
	name: string,
	skills: Skill[],
): Promise<string> {
	const skill = skills.find((s) => s.name === name);
	if (!skill) {
		throw new Error(`skill not found: ${name}`);
	}
	return skill.content;
}
