import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";

import {
	createSystemPromptWithSkills,
	loadAgentsMd,
	buildSystemPromptSync,
	getIntroSection,
	getSecuritySection,
	getSystemSection,
	getDoingTasksSection,
	getActionsSection,
	getToneAndStyleSection,
	getOutputEfficiencySection,
} from "./system-prompt.js";
import { AgentForgeHarness, createEventBus, createMemorySession } from "@agentforge/harness";

const IDENTITY_MARKER = "You are agentforge, a code agent.";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agentforge-cli-skills-"));
	tmpDirs.push(dir);
	return dir;
}

function writeSkill(dir: string, content: string): void {
	writeFileSync(join(dir, "SKILL.md"), content, "utf-8");
}

/** 构造一个合法的最小 AssistantMessage（参考 harness compaction.test.ts 模式）。 */
function makeAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic" as any,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** mock streamFn：产出 start + done 事件（不调真实 LLM）。 */
function makeMockStreamFn(text: string) {
	return () => {
		const stream = new AssistantMessageEventStream();
		const message = makeAssistantMessage(text);
		const startEvent: AssistantMessageEvent = {
			type: "start",
			partial: message,
		};
		const doneEvent: AssistantMessageEvent = {
			type: "done",
			reason: "stop",
			message,
		};
		queueMicrotask(() => {
			stream.push(startEvent);
			stream.push(doneEvent);
		});
		return stream;
	};
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

describe("section functions", () => {
	it("getIntroSection returns identity statement", () => {
		const section = getIntroSection();
		expect(section).toContain(IDENTITY_MARKER);
	});

	it("getSecuritySection returns security guidance", () => {
		const section = getSecuritySection();
		expect(section).toContain("authorized security testing");
		expect(section).toContain("CTF challenges");
	});

	it("getSystemSection returns system behavior", () => {
		const section = getSystemSection();
		expect(section).toContain("# System");
		expect(section).toContain("Github-flavored markdown");
	});

	it("getDoingTasksSection returns task guidance", () => {
		const section = getDoingTasksSection();
		expect(section).toContain("# Doing tasks");
		expect(section).toContain("software engineering tasks");
	});

	it("getActionsSection returns action safety guidance", () => {
		const section = getActionsSection();
		expect(section).toContain("# Executing actions with care");
		expect(section).toContain("Destructive operations");
	});

	it("getToneAndStyleSection returns style guidance", () => {
		const section = getToneAndStyleSection();
		expect(section).toContain("# Tone and style");
		expect(section).toContain("emojis");
	});

	it("getOutputEfficiencySection returns efficiency guidance", () => {
		const section = getOutputEfficiencySection();
		expect(section).toContain("# Output efficiency");
		expect(section).toContain("Go straight to the point");
	});
});

describe("buildSystemPromptSync", () => {
	it("produces a prompt containing all static sections", () => {
		const dir = makeTmpDir();
		const prompt = buildSystemPromptSync({ skillDirs: [dir], agentsMdPath: join(dir, "no-AGENTS.md") });
		expect(prompt).toContain(IDENTITY_MARKER);
		expect(prompt).toContain("# System");
		expect(prompt).toContain("# Doing tasks");
		expect(prompt).toContain("# Executing actions with care");
		expect(prompt).toContain("# Tone and style");
		expect(prompt).toContain("# Output efficiency");
	});

	it("includes tool usage section when toolNames provided", () => {
		const dir = makeTmpDir();
		const prompt = buildSystemPromptSync({
			toolNames: ["read", "bash", "edit"],
			skillDirs: [dir],
			agentsMdPath: join(dir, "no-AGENTS.md"),
		});
		expect(prompt).toContain("# Using your tools");
		expect(prompt).toContain("read instead of cat");
	});

	it("includes language section when specified", () => {
		const dir = makeTmpDir();
		const prompt = buildSystemPromptSync({
			language: "中文",
			skillDirs: [dir],
			agentsMdPath: join(dir, "no-AGENTS.md"),
		});
		expect(prompt).toContain("# Language");
		expect(prompt).toContain("Always respond in 中文");
	});

	it("injects AGENTS.md content when the file exists", () => {
		const dir = makeTmpDir();
		const agentsPath = join(dir, "AGENTS.md");
		writeFileSync(agentsPath, "# Project Rules\nAlways use TDD.", "utf-8");

		const prompt = buildSystemPromptSync({ skillDirs: [dir], agentsMdPath: agentsPath });
		expect(prompt).toContain("# Project Guidelines");
		expect(prompt).toContain("# Project Rules");
		expect(prompt).toContain("Always use TDD.");
	});

	it("injects skills block when daily skills found", () => {
		const dir = makeTmpDir();
		writeSkill(dir, [
			"---",
			"name: daily-review",
			"description: Run a daily review ritual.",
			"classification: daily",
			"---",
			"",
			"body",
		].join("\n"));

		const prompt = buildSystemPromptSync({ skillDirs: [dir], agentsMdPath: join(dir, "no-AGENTS.md") });
		expect(prompt).toContain("<available_skills>");
		expect(prompt).toContain("<name>daily-review</name>");
	});
});

describe("createSystemPromptWithSkills (legacy API)", () => {
	it("appends an available_skills block when daily skills are found", () => {
		const dir = makeTmpDir();
		writeSkill(
			dir,
			[
				"---",
				"name: daily-review",
				"description: Run a daily review ritual.",
				"classification: daily",
				"---",
				"",
				"body",
			].join("\n"),
		);

		const prompt = createSystemPromptWithSkills(IDENTITY_MARKER, [dir]);

		expect(prompt).toContain(IDENTITY_MARKER);
		expect(prompt).toContain("<available_skills>");
		expect(prompt).toContain("<name>daily-review</name>");
		expect(prompt).toContain("Run a daily review ritual.");
	});

	it("returns the base prompt unchanged when no skills are found", () => {
		const dir = makeTmpDir();
		const prompt = createSystemPromptWithSkills(IDENTITY_MARKER, [dir], join(dir, "no-AGENTS.md"));
		expect(prompt).toContain(IDENTITY_MARKER);
	});

	it("only injects daily skills, not library skills", () => {
		const dir = makeTmpDir();
		writeSkill(
			dir,
			[
				"---",
				"name: daily-one",
				"description: A daily skill.",
				"classification: daily",
				"---",
				"",
				"body",
			].join("\n"),
		);
		const libDir = join(dir, "lib");
		mkdirSync(libDir, { recursive: true });
		writeSkill(
			libDir,
			[
				"---",
				"name: lib-one",
				"description: A library skill.",
				"classification: library",
				"---",
				"",
				"body",
			].join("\n"),
		);

		const prompt = createSystemPromptWithSkills(IDENTITY_MARKER, [dir]);

		expect(prompt).toContain("<name>daily-one</name>");
		expect(prompt).not.toContain("lib-one");
	});

	it("handles a non-existent directory gracefully (base prompt unchanged)", () => {
		const dir = makeTmpDir();
		const prompt = createSystemPromptWithSkills(IDENTITY_MARKER, [
			join(dir, "missing"),
		], join(dir, "no-AGENTS.md"));
		expect(prompt).toContain(IDENTITY_MARKER);
	});

	it("injects AGENTS.md content when the file exists", () => {
		const dir = makeTmpDir();
		const agentsPath = join(dir, "AGENTS.md");
		writeFileSync(agentsPath, "# Project Rules\nAlways use TDD.", "utf-8");

		const prompt = createSystemPromptWithSkills(IDENTITY_MARKER, [dir], agentsPath);

		expect(prompt).toContain(IDENTITY_MARKER);
		expect(prompt).toContain("# Project Rules");
		expect(prompt).toContain("Always use TDD.");
	});

	it("injects AGENTS.md before skills block", () => {
		const dir = makeTmpDir();
		const agentsPath = join(dir, "AGENTS.md");
		writeFileSync(agentsPath, "# Project Rules", "utf-8");
		writeSkill(
			dir,
			[
				"---",
				"name: daily-review",
				"description: A daily skill.",
				"classification: daily",
				"---",
				"",
				"body",
			].join("\n"),
		);

		const prompt = createSystemPromptWithSkills(IDENTITY_MARKER, [dir], agentsPath);

		expect(prompt.indexOf("# Project Rules")).toBeLessThan(
			prompt.indexOf("<available_skills>"),
		);
	});

	it("skips AGENTS.md when the file does not exist", () => {
		const dir = makeTmpDir();
		const prompt = createSystemPromptWithSkills(
			IDENTITY_MARKER,
			[dir],
			join(dir, "nonexistent-AGENTS.md"),
		);
		expect(prompt).toContain(IDENTITY_MARKER);
	});
});

describe("loadAgentsMd", () => {
	it("returns file content when the file exists", () => {
		const dir = makeTmpDir();
		const filePath = join(dir, "AGENTS.md");
		writeFileSync(filePath, "# Dev rules\nUse ESM.", "utf-8");
		expect(loadAgentsMd(filePath)).toBe("# Dev rules\nUse ESM.");
	});

	it("returns empty string when the file does not exist", () => {
		expect(loadAgentsMd("/nonexistent/AGENTS.md")).toBe("");
	});
});

describe("integration — skills block reaches harness systemPrompt", () => {
	it("a real AgentForgeHarness built with the injected prompt has the available_skills block in agent.state.systemPrompt", () => {
		const dir = makeTmpDir();
		writeSkill(
			dir,
			[
				"---",
				"name: daily-ritual",
				"description: A daily ritual skill.",
				"classification: daily",
				"---",
				"",
				"body",
			].join("\n"),
		);

		// 用 createSystemPromptWithSkills 生成注入后的 systemPrompt（repl/print-mode
		// 构造 harness 前正是这么做）。
		const systemPrompt = createSystemPromptWithSkills(IDENTITY_MARKER, [dir]);

		// 真构造 AgentForgeHarness（mock streamFn + memory session + events + tools []），
		// 断言 harness.agent.state.systemPrompt 含 <available_skills> 块——即 skills 块
		// 确实透传到了底层 pi Agent initialState.systemPrompt。
		const harness = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools: [],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt,
			streamFn: makeMockStreamFn("ok"),
		});

		const statePrompt = harness.agent.state.systemPrompt;
		expect(statePrompt).toContain(IDENTITY_MARKER);
		expect(statePrompt).toContain("<available_skills>");
		expect(statePrompt).toContain("<name>daily-ritual</name>");
		expect(statePrompt).toContain("A daily ritual skill.");
		// base prompt 在块之前
		expect(statePrompt.indexOf(IDENTITY_MARKER)).toBeLessThan(
			statePrompt.indexOf("<available_skills>"),
		);
	});

	it("harness without skills dir keeps systemPrompt as the base prompt", () => {
		// 无 daily skills → createSystemPromptWithSkills 返回 basePrompt 原值。
		const dir = makeTmpDir(); // 空目录
		const systemPrompt = createSystemPromptWithSkills(IDENTITY_MARKER, [dir], join(dir, "no-AGENTS.md"));

		const harness = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools: [],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt,
			streamFn: makeMockStreamFn("ok"),
		});

		expect(harness.agent.state.systemPrompt).toContain(IDENTITY_MARKER);
		expect(harness.agent.state.systemPrompt).not.toContain("<available_skills>");
	});
});
