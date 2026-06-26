import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSkills, classifySkill, formatSkillsForSystemPrompt, invokeSkill, parseFrontmatter } from "./skills.js";
import type { Skill } from "./skills.js";

/** 创建临时目录的辅助。返回路径，测试后由 afterEach 清理。 */
let tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agentforge-skills-"));
	tmpDirs.push(dir);
	return dir;
}

/** 写一个 SKILL.md 到 dir/SKILL.md，content 为给定字符串。 */
function writeSkill(dir: string, content: string): string {
	const path = join(dir, "SKILL.md");
	writeFileSync(path, content, "utf-8");
	return path;
}

beforeEach(() => {
	tmpDirs = [];
});

afterEach(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs = [];
});

describe("SkillRegistry.load", () => {
	it("reads a SKILL.md with frontmatter and parses name/description/classification", () => {
		const dir = makeTmpDir();
		writeSkill(
			dir,
			[
				"---",
				"name: daily-review",
				"description: Run a daily code review ritual.",
				"classification: daily",
				"---",
				"",
				"# Daily Review",
				"",
				"Step 1: read the diff.",
			].join("\n"),
		);

		const skills = loadSkills([dir]);

		expect(skills).toHaveLength(1);
		const skill = skills[0]!;
		expect(skill.name).toBe("daily-review");
		expect(skill.description).toBe("Run a daily code review ritual.");
		expect(skill.frontmatter.classification).toBe("daily");
		expect(skill.content).toContain("# Daily Review");
		expect(skill.content).not.toContain("---");
		expect(skill.filePath).toBe(join(dir, "SKILL.md"));
		expect(skill.sourceDir).toBe(dir);
	});

	it("recursively discovers SKILL.md in nested subdirectories", () => {
		const dir = makeTmpDir();
		const sub = join(dir, "review", "daily");
		mkdirSync(sub, { recursive: true });
		writeSkill(
			sub,
			[
				"---",
				"name: nested-skill",
				"description: A skill deep in a subdirectory.",
				"---",
				"",
				"body of nested skill",
			].join("\n"),
		);

		const skills = loadSkills([dir]);

		expect(skills).toHaveLength(1);
		expect(skills[0]!.name).toBe("nested-skill");
		expect(skills[0]!.sourceDir).toBe(sub);
	});

	it("skips SKILL.md files that have no frontmatter", () => {
		const dir = makeTmpDir();
		writeSkill(dir, "Just a plain markdown file with no frontmatter.\n\n# Hello");

		const skills = loadSkills([dir]);

		expect(skills).toHaveLength(0);
	});

	it("returns empty array for a non-existent directory without throwing", () => {
		const skills = loadSkills([join(makeTmpDir(), "does-not-exist")]);
		expect(skills).toEqual([]);
	});

	it("returns empty array for an empty directory without throwing", () => {
		const dir = makeTmpDir();
		const skills = loadSkills([dir]);
		expect(skills).toEqual([]);
	});
});

describe("SkillRegistry.parseFrontmatter", () => {
	it("returns null for a file that starts with --- but has no closing fence", () => {
		expect(parseFrontmatter("---something without a closing fence")).toBeNull();
	});
});

/** 构造一个最小 Skill（frontmatter 字段可覆盖），供 classify/format/invoke 测试用。 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
	return {
		name: "test-skill",
		description: "a test skill",
		content: "body",
		frontmatter: {},
		sourceDir: "/tmp/skill",
		filePath: "/tmp/skill/SKILL.md",
		...overrides,
	};
}

describe("SkillRegistry.classifySkill", () => {
	it("returns daily when frontmatter.classification is daily", () => {
		const skill = makeSkill({ frontmatter: { classification: "daily" } });
		expect(classifySkill(skill)).toBe("daily");
	});

	it("returns library when frontmatter.classification is library", () => {
		const skill = makeSkill({ frontmatter: { classification: "library" } });
		expect(classifySkill(skill)).toBe("library");
	});

	it("falls back to daily when no explicit classification and repoEvidence keywords match the skill", () => {
		const skill = makeSkill({
			name: "react-review",
			description: "Review React components.",
			frontmatter: {},
		});
		expect(classifySkill(skill, { keywords: ["react"] })).toBe("daily");
	});

	it("falls back to library when no explicit classification and no repoEvidence match", () => {
		const skill = makeSkill({
			name: "cobol-migration",
			description: "Migrate legacy COBOL.",
			frontmatter: {},
		});
		expect(classifySkill(skill, { keywords: ["react", "typescript"] })).toBe(
			"library",
		);
	});

	it("falls back to library when no explicit classification and no repoEvidence given", () => {
		const skill = makeSkill({ frontmatter: {} });
		expect(classifySkill(skill)).toBe("library");
	});
});

describe("SkillRegistry.formatSkillsForSystemPrompt", () => {
	it("produces an available_skills block with each daily skill's name and description", () => {
		const daily: Skill[] = [
			makeSkill({ name: "daily-review", description: "Run a daily review." }),
			makeSkill({ name: "plan-task", description: "Plan a task." }),
		];
		const block = formatSkillsForSystemPrompt(daily);
		expect(block).toContain("<available_skills>");
		expect(block).toContain("</available_skills>");
		expect(block).toContain("<name>daily-review</name>");
		expect(block).toContain("<description>Run a daily review.</description>");
		expect(block).toContain("<name>plan-task</name>");
		expect(block).toContain("<description>Plan a task.</description>");
	});

	it("returns empty string for an empty daily list (no injection)", () => {
		expect(formatSkillsForSystemPrompt([])).toBe("");
	});

	it("escapes XML special characters in name and description", () => {
		const daily: Skill[] = [
			makeSkill({
				name: "x<>&\"'y",
				description: "a & b < c > d",
			}),
		];
		const block = formatSkillsForSystemPrompt(daily);
		expect(block).toContain("<name>x&lt;&gt;&amp;&quot;&apos;y</name>");
		expect(block).toContain("<description>a &amp; b &lt; c &gt; d</description>");
	});
});

describe("SkillRegistry.invokeSkill", () => {
	it("returns the skill content for a found name", async () => {
		const skills: Skill[] = [
			makeSkill({ name: "findme", content: "the real body" }),
		];
		const content = await invokeSkill("findme", skills);
		expect(content).toBe("the real body");
	});

	it("throws when the skill name is not found", async () => {
		await expect(invokeSkill("nope", [])).rejects.toThrow(
			"skill not found: nope",
		);
	});
});

/**
 * Slice 5 Task 7: council skill 文件发现。
 * <repoRoot>/.agentforge/skills/council/SKILL.md 必须被 loadSkills 发现,
 * 并出现在 daily/library 列表 + formatSkillsForSystemPrompt 输出中。
 * 见 spec §4.3 + plan Task 7 Step 2。
 */
describe("council skill (Slice 5 Task 7)", () => {
	const repoRoot = join(__dirname, "..", "..", "..");
	const skillsDir = join(repoRoot, ".agentforge", "skills");

	it("loadSkills discovers the council skill from <repoRoot>/.agentforge/skills", () => {
		const skills = loadSkills([skillsDir]);
		const council = skills.find((s) => s.name === "council");
		expect(council).toBeDefined();
		expect(council!.description).toBeTruthy();
		// spec §4.3: 四角色独立段落,防 voice collapse
		expect(council!.content).toContain("## architect");
		expect(council!.content).toContain("## skeptic");
		expect(council!.content).toContain("## user-advocate");
		expect(council!.content).toContain("## operator");
		expect(council!.content).toContain("## 综合");
	});

	it("classifies council into daily or library", () => {
		const skills = loadSkills([skillsDir]);
		const council = skills.find((s) => s.name === "council");
		expect(council).toBeDefined();
		const cls = classifySkill(council!);
		expect(["daily", "library"]).toContain(cls);
	});

	it("formatSkillsForSystemPrompt includes council when daily", () => {
		const skills = loadSkills([skillsDir]);
		const council = skills.find((s) => s.name === "council");
		expect(council).toBeDefined();
		const daily = skills.filter((s) => classifySkill(s) === "daily");
		if (daily.some((s) => s.name === "council")) {
			const block = formatSkillsForSystemPrompt(daily);
			expect(block).toContain("<name>council</name>");
		}
	});
});
