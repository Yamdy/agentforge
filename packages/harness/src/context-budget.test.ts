import { describe, it, expect } from "vitest";
import { estimateStringTokens, audit, headroom } from "./context-budget.js";
import { formatSkillsForSystemPrompt } from "./skills.js";
import { estimateTotalTokens } from "./compaction.js";
import type { Skill } from "./skills.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

function makeSkill(name: string, description: string): Skill {
	return {
		name,
		description,
		content: "",
		frontmatter: { classification: "daily" },
		sourceDir: "",
		filePath: "",
	};
}

/**
 * ContextBudget 模块测试。见 ARCHITECTURE.md §4.3。
 *
 * 审计 system prompt / skills / tools / history 的 token 开销，给出优化建议。
 * pi 无此模块，完全自写。token 估算复用 compaction 的 chars/4 策略。
 */
describe("estimateStringTokens", () => {
	it("估算字符串为 chars/4（向上取整，不足 1 token 计 1）", () => {
		// "hello world" 11 chars → ceil(11/4) = 3
		expect(estimateStringTokens("hello world")).toBe(3);
		// 空串 → 至少 1 token（与 compaction estimateTokens 的 Math.max(1,...) 一致）
		expect(estimateStringTokens("")).toBe(1);
		// 4 chars → 1 token
		expect(estimateStringTokens("abcd")).toBe(1);
		// 5 chars → 2 token
		expect(estimateStringTokens("abcde")).toBe(2);
	});
});

describe("audit", () => {
	it("估算 systemPrompt 为 chars/4", () => {
		const systemPrompt = "You are a helpful assistant. Follow instructions carefully.";
		// 56 chars → ceil(56/4) = 14
		const expected = Math.max(1, Math.ceil(systemPrompt.length / 4));
		const report = audit({
			systemPrompt,
			skills: [],
			tools: [],
			messages: [],
		});
		expect(report.components.systemPrompt).toBe(expected);
	});

	it("估算 skills 块为 formatSkillsForSystemPrompt 生成块的 chars/4", () => {
		const skills = [
			makeSkill("tdd", "test driven development methodology"),
			makeSkill("refactor", "code refactoring guidance"),
		];
		const block = formatSkillsForSystemPrompt(skills);
		const expected = estimateStringTokens(block);
		const report = audit({
			systemPrompt: "",
			skills,
			tools: [],
			messages: [],
		});
		expect(report.components.skills).toBe(expected);
	});

	it("估算 tools 为各 tool JSON schema chars/4 之和", () => {
		const tool1 = {
			label: "read",
			name: "read",
			description: "read a file",
			inputSchema: { type: "object", properties: { path: { type: "string" } } },
			execute: async () => ({ content: [], details: {} }),
		} as any;
		const tool2 = {
			label: "write",
			name: "write",
			description: "write a file",
			inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
			execute: async () => ({ content: [], details: {} }),
		} as any;
		const expected =
			estimateStringTokens(JSON.stringify(tool1)) +
			estimateStringTokens(JSON.stringify(tool2));
		const report = audit({
			systemPrompt: "",
			skills: [],
			tools: [tool1, tool2],
			messages: [],
		});
		expect(report.components.tools).toBe(expected);
	});

	it("估算 history 为复用 compaction.estimateTotalTokens 的值", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "hello there, how are you today?", timestamp: 0 } as any,
			{ role: "assistant", content: [{ type: "text", text: "I am well, thank you for asking." }], timestamp: 0 } as any,
		];
		const expected = estimateTotalTokens(messages);
		const report = audit({
			systemPrompt: "",
			skills: [],
			tools: [],
			messages,
		});
		expect(report.components.history).toBe(expected);
	});

	it("total 等于各组件 token 之和", () => {
		const systemPrompt = "You are a coding assistant.";
		const skills = [makeSkill("tdd", "test driven development")];
		const tool = {
			label: "read",
			name: "read",
			description: "read a file",
			inputSchema: { type: "object" },
			execute: async () => ({ content: [], details: {} }),
		} as any;
		const messages: AgentMessage[] = [
			{ role: "user", content: "what is the time?", timestamp: 0 } as any,
		];
		const report = audit({ systemPrompt, skills, tools: [tool], messages });
		expect(report.total).toBe(
			report.components.systemPrompt +
				report.components.skills +
				report.components.tools +
				report.components.history,
		);
	});

	it("skills 块超阈值时建议降级 daily skill 到 library", () => {
		// 构造足够大的 skills 块使其 tokens 超过默认阈值 2000
		const big = "x".repeat(200 * 4); // 单 skill 约 200 tokens
		const skills: Skill[] = [];
		for (let i = 0; i < 15; i++) {
			skills.push(makeSkill(`skill-${i}`, big));
		}
		const report = audit({
			systemPrompt: "",
			skills,
			tools: [],
			messages: [],
		});
		expect(report.components.skills).toBeGreaterThan(2000);
		const suggestion = report.suggestions.find((s) => s.component === "skills");
		expect(suggestion).toBeDefined();
		expect(suggestion!.action).toMatch(/demote|library/i);
		expect(suggestion!.reason).toContain("skills");
	});

	it("单个 tool schema 超阈值(~500)时建议精简该 schema", () => {
		// 构造一个 schema 很大的 tool（> 500*4 = 2000 chars）
		const bigSchema = {
			type: "object",
			properties: {
				path: { type: "string", description: "y".repeat(2000) },
				content: { type: "string", description: "z".repeat(2000) },
			},
		};
		const bigTool = {
			label: "huge",
			name: "huge",
			description: "huge tool",
			inputSchema: bigSchema,
			execute: async () => ({ content: [], details: {} }),
		} as any;
		const report = audit({
			systemPrompt: "",
			skills: [],
			tools: [bigTool],
			messages: [],
		});
		const toolTokens = estimateStringTokens(JSON.stringify(bigTool));
		expect(toolTokens).toBeGreaterThan(500);
		const suggestion = report.suggestions.find((s) => s.component === "tools");
		expect(suggestion).toBeDefined();
		expect(suggestion!.action).toMatch(/simplif|trim|schema/i);
		expect(suggestion!.reason).toContain("huge");
	});

	it("history 占 modelContextWindow 比例过高时建议触发 compaction", () => {
		// modelContextWindow = 1000；history 占比阈值 0.8 → 超 800 tokens 触发
		const bigContent = "a".repeat(4000); // ~1000 tokens
		const messages: AgentMessage[] = [
			{ role: "user", content: bigContent, timestamp: 0 } as any,
			{ role: "assistant", content: [{ type: "text", text: bigContent }], timestamp: 0 } as any,
		];
		const report = audit({
			systemPrompt: "",
			skills: [],
			tools: [],
			messages,
			modelContextWindow: 1000,
		});
		expect(report.components.history).toBeGreaterThan(800);
		const suggestion = report.suggestions.find((s) => s.component === "history");
		expect(suggestion).toBeDefined();
		expect(suggestion!.action).toMatch(/compact/i);
	});

	it("无任何组件超阈值时 suggestions 为空数组", () => {
		const report = audit({
			systemPrompt: "small prompt",
			skills: [makeSkill("s", "small desc")],
			tools: [
				{
					label: "r",
					name: "r",
					description: "r",
					inputSchema: { type: "object" },
					execute: async () => ({ content: [], details: {} }),
				} as any,
			],
			messages: [{ role: "user", content: "hi", timestamp: 0 } as any],
			modelContextWindow: 100000,
		});
		expect(report.suggestions).toEqual([]);
	});
});

describe("headroom", () => {
	it("返回 contextWindow - total；超 out 时返回 0 不抛", () => {
		const report = audit({
			systemPrompt: "prompt", // 2 tokens
			skills: [],
			tools: [],
			messages: [],
		});
		// 充足窗口：window - total
		expect(headroom(report.total, 1000)).toBe(1000 - report.total);
		// 超出窗口：返回 0，不抛
		expect(headroom(report.total, 1)).toBe(0);
		expect(() => headroom(report.total, 1)).not.toThrow();
	});
});
