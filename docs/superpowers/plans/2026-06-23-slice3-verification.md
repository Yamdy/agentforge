# Slice 3 Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建 `packages/harness/src/verification.ts`，实现 in-process SantaVerifier（双独立 reviewer + verdict gate + fix-until-nice），harness 可选注入 + `verify()` 方法。

**Architecture:** 遵循 safety/compaction 既定模式（独立 `.ts` + `HarnessOptions` 可选注入）。reviewer = in-process 独立 `Agent` 实例（ADR-0001b），配 `submit_review` 工具强制结构化产出。verifier 只评审，fix loop 外部编排（`review` + `verifyUntilNice(fixFn)`）。

**Tech Stack:** TypeScript ESM + TypeBox + `@earendil-works/pi-agent-core` Agent + `@earendil-works/pi-ai` getModel + vitest

## Global Constraints

（每个 task 隐含遵循，从 spec + 项目硬规范逐字抄录）

- **ESM + TS strict + verbatimModuleSyntax**：相对导入带 `.js`；类型导入 `import type`。
- **TypeBox**（`import { Type, type Static } from "typebox"`）非 zod。
- **TDD 铁律**：无失败测试不写生产代码，严格 per-test RED（Slice 1 classifySkill 教训）。
- **DeepSeek API key 安全**：只经 `DEEPSEEK_API_KEY` env 运行时注入，绝不硬编码。TDD 全程用 mock，不依赖真实 LLM。
- **vitest 跨包 development condition vs tsc dist**（老陷阱）：vitest 经 `development` condition 读 src（测试绿），但 `tsc --noEmit` typecheck 走 dist。harness 加新 export（verification）后**必须** `pnpm --filter @agentforge/harness build` rebuild dist，cli typecheck 才认。
- **pi Agent API**（`agent.d.ts` 确认）：`new Agent({initialState:{systemPrompt, model, tools, messages}, getApiKey?, streamFn?})`；`agent.prompt(input: string)`；`agent.waitForIdle()`；`agent.state.messages: AgentMessage[]`（含 assistant toolCall block）。
- **AgentTool**（`types.d.ts` 确认）：`{ name, label, description, parameters: TSchema, execute: (toolCallId, params, signal?, onUpdate?) => Promise<{content, details, terminate?}> }`。
- **AgentToolCall**：`{ type:"toolCall", name, arguments, id }`，在 assistant message `content` 数组里。
- **StreamFn**：`(...args: Parameters<typeof streamSimple>) => ...`，第 1 参数是经 `convertToLlm` 的 LLM Message[]（结构 provider-specific，**勿在测试里直接依赖其结构**——本 plan 用 `reviewerRun` 注入绕开）。
- **GateGuard hook**：Write/Edit 需先 Grep 列 import + 陈述 4 事实；同文件首次 Edit 必拦；首次 Bash Fact-Forcing。受阻可 `ECC_GATEGUARD=off`。
- **仅用户要求时 commit/push**（AGENTS.md）。commit message 末尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`。plan 内 commit 步骤是 TDD frequent-commit 蓝图，执行时用户可控制时机。

## Spec 细化说明（相对 spec §4.3/§7）

spec `createSantaVerifier(deps)` 接口加一个可注入依赖 **`reviewerRun`**，用于测试时绕开真实 Agent loop（`convertToLlm`/provider 结构不确定，直接 mock streamFn 多轮不可靠）。这与 `compaction.ts` 的 `CompactDeps.generateSummary` 注入同构：默认 `reviewerRun` 用真实 `Agent` + `submit_review` 工具 + `extractReviewerVerdict`；测试注入 mock `reviewerRun` 直接返回 `ReviewerVerdict`，使 `review()`/`verifyUntilNice()` 的 gate/fix-loop 逻辑可独立 TDD，不依赖 pi loop。默认 `reviewerRun` 的真实 Agent 集成单独 1 个测试覆盖（Task 4）。

## File Structure

- **Create** `packages/harness/src/verification.ts` — 类型 + `submit_review` 工具 + `defaultReviewerSystemPrompt` + `extractReviewerVerdict` + `gateReview` + `SantaVerifier` 接口 + `createSantaVerifier`（含默认 `reviewerRun`）
- **Create** `packages/harness/src/verification.test.ts` — 全部测试
- **Modify** `packages/harness/src/harness.ts` — `HarnessOptions` 加 `verifier?`；`AgentForgeHarness` 加 `verify()` + `get verifier()`
- **Modify** `packages/harness/src/harness.test.ts` — verifier 集成测试
- **Modify** `packages/harness/src/index.ts` — `export * from "./verification.js"`

---

## Task 1: 纯函数基础（类型 + submit_review 工具 + prompt builder + 提取 + gate）

**Files:**
- Create: `packages/harness/src/verification.ts`
- Test: `packages/harness/src/verification.test.ts`

**Interfaces:**
- Consumes: `AgentTool`/`AgentMessage` from pi-agent-core, `Type`/`Static` from typebox
- Produces: `Rubric`, `Issue`, `ReviewerVerdict`, `ReviewResult`, `FixFn`, `VerifyUntilNiceResult`, `SubmitReviewInput`, `SUBMIT_REVIEW_TOOL_NAME`, `createSubmitReviewTool`, `defaultReviewerSystemPrompt`, `extractReviewerVerdict`, `gateReview`

- [ ] **Step 1: 写失败测试（类型 + 提取 + gate + prompt builder + 工具名）**

`packages/harness/src/verification.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
	extractReviewerVerdict,
	gateReview,
	defaultReviewerSystemPrompt,
	createSubmitReviewTool,
	SUBMIT_REVIEW_TOOL_NAME,
	type Rubric,
	type ReviewerVerdict,
	type Issue,
} from "./verification.js";

/** 构造一条含 submit_review toolCall 的 assistant AgentMessage。 */
function makeAssistantWithSubmitReview(
	verdict: "nice" | "naughty",
	issues: Issue[],
): AgentMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text: "reviewing" },
			{
				type: "toolCall",
				id: "call-submit",
				name: SUBMIT_REVIEW_TOOL_NAME,
				arguments: { verdict, issues },
			},
		],
	} as any;
}

describe("verification: extractReviewerVerdict", () => {
	it("extracts the latest submit_review verdict from assistant messages", () => {
		const messages: AgentMessage[] = [
			makeAssistantWithSubmitReview("nice", []),
			{ role: "user", content: "x" } as any,
		];
		const v = extractReviewerVerdict(messages);
		expect(v).toEqual({ verdict: "nice", issues: [] });
	});

	it("returns undefined when no submit_review toolCall exists", () => {
		const messages: AgentMessage[] = [
			{ role: "assistant", content: [{ type: "text", text: "no tool" }] } as any,
		];
		expect(extractReviewerVerdict(messages)).toBeUndefined();
	});

	it("takes the last submit_review when multiple exist", () => {
		const messages: AgentMessage[] = [
			makeAssistantWithSubmitReview("nice", []),
			makeAssistantWithSubmitReview("naughty", [
				{ severity: "high", description: "bug" },
			]),
		];
		const v = extractReviewerVerdict(messages);
		expect(v?.verdict).toBe("naughty");
		expect(v?.issues).toHaveLength(1);
	});
});

describe("verification: gateReview", () => {
	const nice: ReviewerVerdict = { verdict: "nice", issues: [] };
	const naughty: ReviewerVerdict = {
		verdict: "naughty",
		issues: [{ severity: "high", description: "a" }],
	};

	it("returns nice when both reviewers are nice (AND gate)", () => {
		const r = gateReview([nice, nice]);
		expect(r.verdict).toBe("nice");
		expect(r.issues).toEqual([]);
		expect(r.reviews).toHaveLength(2);
	});

	it("returns naughty when one reviewer is naughty", () => {
		const r = gateReview([nice, naughty]);
		expect(r.verdict).toBe("naughty");
		expect(r.issues).toHaveLength(1);
	});

	it("returns naughty when both are naughty and merges issues (no dedup)", () => {
		const n2: ReviewerVerdict = {
			verdict: "naughty",
			issues: [{ severity: "medium", description: "b" }],
		};
		const r = gateReview([naughty, n2]);
		expect(r.verdict).toBe("naughty");
		expect(r.issues).toHaveLength(2);
	});
});

describe("verification: defaultReviewerSystemPrompt", () => {
	it("includes rubric criteria and the output", () => {
		const rubric: Rubric = { criteria: ["must be correct", "must be tested"] };
		const prompt = defaultReviewerSystemPrompt(rubric, "SOME OUTPUT");
		expect(prompt).toContain("must be correct");
		expect(prompt).toContain("must be tested");
		expect(prompt).toContain("SOME OUTPUT");
		expect(prompt).toContain("submit_review");
	});

	it("includes context when provided", () => {
		const rubric: Rubric = { criteria: ["c1"], context: "TASK CTX" };
		const prompt = defaultReviewerSystemPrompt(rubric, "out");
		expect(prompt).toContain("TASK CTX");
	});
});

describe("verification: createSubmitReviewTool", () => {
	it("exposes the submit_review tool with correct name", () => {
		const tool = createSubmitReviewTool();
		expect(tool.name).toBe(SUBMIT_REVIEW_TOOL_NAME);
		expect(tool.parameters).toBeDefined();
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @agentforge/harness test -- verification.test.ts`
Expected: FAIL（`Cannot find module './verification.js'` 或符号未定义）

- [ ] **Step 3: 写最小实现**

`packages/harness/src/verification.ts`：

```ts
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

/**
 * Verification 模块：对抗验证（santa 双 reviewer + verdict gate + fix-until-nice）。
 * 见 ARCHITECTURE.md §4.8 + docs/superpowers/specs/2026-06-23-slice3-verification-design.md。
 *
 * reviewer = in-process 独立 Agent 实例（ADR-0001b），配 submit_review 工具强制结构化产出。
 * verifier 只评审，fix loop 外部编排（review + verifyUntilNice(fixFn)）。
 */

// === 类型 ===

export interface Rubric {
	/** 通过/失败判定标准。 */
	criteria: string[];
	/** 可选背景（如任务描述、约束）。 */
	context?: string;
}

export interface Issue {
	severity: "high" | "medium" | "low";
	description: string;
	suggestion?: string;
}

export interface ReviewerVerdict {
	verdict: "nice" | "naughty";
	issues: Issue[];
}

export interface ReviewResult {
	/** gate 后最终裁决。 */
	verdict: "nice" | "naughty";
	/** 合并（不去重）的 issues。 */
	issues: Issue[];
	/** 两 reviewer 各自原始裁决（透明，供 audit）。 */
	reviews: ReviewerVerdict[];
}

export type FixFn = (output: string, issues: Issue[]) => Promise<string>;

export interface VerifyUntilNiceResult {
	/** 最终（可能经 fix 修订的）output。 */
	output: string;
	/** 收敛结果。 */
	verdict: "nice" | "naughty";
	/** 实际轮次。 */
	rounds: number;
	/** 每轮 review 结果。 */
	history: ReviewResult[];
}

// === submit_review 工具 ===

export const SUBMIT_REVIEW_TOOL_NAME = "submit_review";

const submitReviewSchema = Type.Object({
	verdict: Type.Union([Type.Literal("nice"), Type.Literal("naughty")]),
	issues: Type.Array(
		Type.Object({
			severity: Type.Union([
				Type.Literal("high"),
				Type.Literal("medium"),
				Type.Literal("low"),
			]),
			description: Type.String(),
			suggestion: Type.Optional(Type.String()),
		}),
	),
});

export type SubmitReviewInput = Static<typeof submitReviewSchema>;

/**
 * reviewer agent 唯一工具：提交结构化评审结论。
 * execute 仅返回占位结果（verifier 从 assistant toolCall block 提取 arguments，
 * 不依赖 execute 返回值）。
 */
export function createSubmitReviewTool(): AgentTool<typeof submitReviewSchema, Record<string, never>> {
	return {
		name: SUBMIT_REVIEW_TOOL_NAME,
		label: "Submit Review",
		description:
			"提交评审结论。verdict=nice 表示通过，naughty 表示不通过（附 issues）。必须调用此工具提交结构化结论。",
		parameters: submitReviewSchema,
		async execute(_toolCallId, args) {
			return {
				content: [
					{ type: "text", text: `review submitted: ${args.verdict}` },
				],
				details: {},
			};
		},
	};
}

// === 默认 reviewer system prompt builder ===

/**
 * 默认 reviewer system prompt：注入 rubric criteria + output，要求调 submit_review。
 * 可经 deps.reviewerSystemPromptBuilder 覆盖。
 */
export function defaultReviewerSystemPrompt(rubric: Rubric, output: string): string {
	const criteriaList = rubric.criteria
		.map((c, i) => `${i + 1}. ${c}`)
		.join("\n");
	const contextBlock = rubric.context ? `\n\n背景:\n${rubric.context}` : "";
	return [
		"你是对抗验证的独立 reviewer。独立判断，不假设其他 reviewer 的结论。",
		"依据 rubric 评审下方的 output，必须调用 submit_review 工具提交结构化结论。",
		"verdict=nice 表示通过（无 issue 或仅 trivial），naughty 表示不通过并附 issues。",
		"",
		"Rubric 判定标准:",
		criteriaList,
		contextBlock,
		"",
		"待评审 output:",
		"```",
		output,
		"```",
	].join("\n");
}

// === 提取逻辑 ===

/**
 * 从 reviewer agent 的 messages 提取 submit_review 工具调用的 verdict + issues。
 * 扫所有 assistant 消息的 toolCall block，取最后一个 submit_review（最新裁决）。
 * 未找到返回 undefined（调用方据保守 naughty 处理）。
 */
export function extractReviewerVerdict(
	messages: AgentMessage[],
): ReviewerVerdict | undefined {
	let found: ReviewerVerdict | undefined;
	for (const m of messages) {
		if ((m as any).role !== "assistant") continue;
		const content = (m as any).content;
		if (!Array.isArray(content)) continue;
		for (const block of content as any[]) {
			if (!block || block.type !== "toolCall") continue;
			if (block.name !== SUBMIT_REVIEW_TOOL_NAME) continue;
			const args = block.arguments as SubmitReviewInput;
			found = {
				verdict: args.verdict,
				issues: args.issues ?? [],
			};
		}
	}
	return found;
}

// === gate ===

/**
 * verdict gate（AND）：两 reviewer 都 nice 才 nice，任一 naughty 即 naughty。
 * issues 合并（不去重，保留全部；reviews 保留各自原始裁决供 audit）。
 */
export function gateReview(reviews: ReviewerVerdict[]): ReviewResult {
	const verdict = reviews.every((r) => r.verdict === "nice") ? "nice" : "naughty";
	const issues = reviews.flatMap((r) => r.issues);
	return { verdict, issues, reviews };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @agentforge/harness test -- verification.test.ts`
Expected: PASS

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @agentforge/harness typecheck`
Expected: PASS（无错误）

- [ ] **Step 6: Commit**

```bash
git add packages/harness/src/verification.ts packages/harness/src/verification.test.ts
git commit -m "feat(verification): 纯函数基础（类型+submit_review 工具+提取+gate）" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: createSantaVerifier + review()（reviewerRun 注入测 gate 组合）

**Files:**
- Modify: `packages/harness/src/verification.ts`（追加 SantaVerifier 接口 + createSantaVerifier + 默认 reviewerRun）
- Test: `packages/harness/src/verification.test.ts`（追加 review() 测试）

**Interfaces:**
- Consumes: Task 1 的 `extractReviewerVerdict`/`gateReview`/`createSubmitReviewTool`/`defaultReviewerSystemPrompt` + pi `Agent`/`getModel`
- Produces: `ReviewerRun`, `SantaVerifier`, `SantaVerifierDeps`, `createSantaVerifier`

- [ ] **Step 1: 写失败测试（review() gate 组合 + fresh reviewer + 未 submit 保守 naughty）**

追加到 `verification.test.ts`：

```ts
import { createSantaVerifier, type ReviewerRun } from "./verification.js";

// ... 已有 imports 与 helper ...

describe("verification: createSantaVerifier.review (reviewerRun injected)", () => {
	const rubric: Rubric = { criteria: ["c1"] };

	it("returns nice when both reviewers are nice", async () => {
		const niceRun: ReviewerRun = async () => ({ verdict: "nice", issues: [] });
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: niceRun,
		});
		const r = await v.review("output", rubric);
		expect(r.verdict).toBe("nice");
		expect(r.reviews).toHaveLength(2);
	});

	it("returns naughty when one reviewer is naughty", async () => {
		let i = 0;
		const run: ReviewerRun = async () => {
			i++;
			return i === 1
				? { verdict: "nice", issues: [] }
				: { verdict: "naughty", issues: [{ severity: "high", description: "bug" }] };
		};
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: run,
		});
		const r = await v.review("output", rubric);
		expect(r.verdict).toBe("naughty");
		expect(r.issues).toHaveLength(1);
	});

	it("returns naughty with conservative issue when a reviewer did not submit (reviewerRun returns undefined)", async () => {
		const run: ReviewerRun = async () => undefined;
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: run,
		});
		const r = await v.review("output", rubric);
		expect(r.verdict).toBe("naughty");
		expect(r.issues.some((x) => x.description.includes("did not submit"))).toBe(true);
	});

	it("invokes reviewerRun twice per review (fresh reviewers)", async () => {
		const calls: number[] = [];
		const run: ReviewerRun = async () => {
			calls.push(1);
			return { verdict: "nice", issues: [] };
		};
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: run,
		});
		await v.review("output", rubric);
		expect(calls).toHaveLength(2);
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @agentforge/harness test -- verification.test.ts`
Expected: FAIL（`createSantaVerifier` 未定义）

- [ ] **Step 3: 写实现**

追加到 `verification.ts`（顶部加 import，底部加接口与工厂）：

顶部 import 区追加：

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
```

底部追加：

```ts
// === SantaVerifier ===

/**
 * reviewer 运行器：给定 systemPrompt，跑一个独立 reviewer agent 并返回其裁决。
 * 返回 undefined 表示 reviewer 正常完成但未调 submit_review（调用方保守 naughty）。
 *
 * 可注入以便测试（mock 直接返回 ReviewerVerdict，绕开真实 Agent loop）。
 * 默认实现（createDefaultReviewerRun）用真实 Agent + submit_review 工具。
 */
export type ReviewerRun = (systemPrompt: string) => Promise<ReviewerVerdict | undefined>;

export interface SantaVerifier {
	review(output: string, rubric: Rubric): Promise<ReviewResult>;
	verifyUntilNice(
		initialOutput: string,
		rubric: Rubric,
		fixFn: FixFn,
		maxRounds?: number,
	): Promise<VerifyUntilNiceResult>;
}

export interface SantaVerifierDeps {
	provider: string;
	model: string;
	getApiKey?: (provider: string) => string | Promise<string | undefined>;
	/** 测试 mock；真对话不传走 pi-ai 默认 stream。 */
	streamFn?: any;
	/** 默认 defaultReviewerSystemPrompt。 */
	reviewerSystemPromptBuilder?: (rubric: Rubric, output: string) => string;
	/**
	 * 可注入的 reviewer 运行器（测试 mock）。
	 * 未提供时用 createDefaultReviewerRun（真实 Agent）。
	 */
	reviewerRun?: ReviewerRun;
	cwd?: string;
}

/** reviewer 未调 submit_review 时的保守 issue。 */
const NO_SUBMIT_ISSUE: Issue = {
	severity: "high",
	description: "reviewer did not submit structured review",
};

/**
 * 默认 reviewerRun：new 独立 Agent（无共享上下文）+ prompt + extractReviewerVerdict。
 * 真实 LLM 路径；测试通常注入 mock reviewerRun 绕开。
 */
function createDefaultReviewerRun(deps: SantaVerifierDeps): ReviewerRun {
	return async (systemPrompt: string) => {
		const tool = createSubmitReviewTool();
		const agent = new Agent({
			initialState: {
				systemPrompt,
				model: getModel(deps.provider as any, deps.model as any),
				tools: [tool],
				messages: [],
			},
			getApiKey: deps.getApiKey,
			streamFn: deps.streamFn,
		});
		await agent.prompt(
			"Review the output against the rubric. Call submit_review with your verdict and issues.",
		);
		await agent.waitForIdle();
		const v = extractReviewerVerdict(agent.state.messages);
		return v;
	};
}

/**
 * 创建 SantaVerifier。review() 内部对每次调用 spawn 2 个独立 reviewer（fresh，
 * 无共享上下文），gate 后返回 ReviewResult。
 */
export function createSantaVerifier(deps: SantaVerifierDeps): SantaVerifier {
	const buildPrompt = deps.reviewerSystemPromptBuilder ?? defaultReviewerSystemPrompt;
	const runReviewer: ReviewerRun =
		deps.reviewerRun ?? createDefaultReviewerRun(deps);

	const review: SantaVerifier["review"] = async (output, rubric) => {
		const systemPrompt = buildPrompt(rubric, output);
		// 2 个独立 reviewer（fresh，无共享上下文）。Promise.all 并行 spawn。
		const verdicts = await Promise.all(
			[0, 1].map(async () => {
				const v = await runReviewer(systemPrompt);
				return v ?? {
					verdict: "naughty" as const,
					issues: [NO_SUBMIT_ISSUE],
				};
			}),
		);
		return gateReview(verdicts);
	};

	// verifyUntilNice 在 Task 3 实现；此处先占位抛错，Task 3 替换。
	const verifyUntilNice: SantaVerifier["verifyUntilNice"] = async () => {
		throw new Error("verifyUntilNice not implemented yet");
	};

	return { review, verifyUntilNice };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @agentforge/harness test -- verification.test.ts`
Expected: PASS（review() 4 个测试绿；Task 1 测试仍绿）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @agentforge/harness typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/harness/src/verification.ts packages/harness/src/verification.test.ts
git commit -m "feat(verification): createSantaVerifier + review()（reviewerRun 注入）" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: verifyUntilNice() fix loop

**Files:**
- Modify: `packages/harness/src/verification.ts`（替换 verifyUntilNice 占位实现）
- Test: `packages/harness/src/verification.test.ts`（追加 fix loop 测试）

**Interfaces:**
- Consumes: Task 2 的 `createSantaVerifier`/`review`
- Produces: `verifyUntilNice` 完整实现

- [ ] **Step 1: 写失败测试（fix loop 收敛/未收敛/fixFn 收到 issues/fresh）**

追加到 `verification.test.ts`（顶部补 `import { vi } from "vitest";`）：

```ts
describe("verification: createSantaVerifier.verifyUntilNice", () => {
	const rubric: Rubric = { criteria: ["c1"] };

	it("converges on round 1 when initial output is nice", async () => {
		const run: ReviewerRun = async () => ({ verdict: "nice", issues: [] });
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: run,
		});
		const fixFn = vi.fn(async (o: string) => `${o}-fixed`);
		const r = await v.verifyUntilNice("init", rubric, fixFn);
		expect(r.verdict).toBe("nice");
		expect(r.rounds).toBe(1);
		expect(r.history).toHaveLength(1);
		expect(fixFn).not.toHaveBeenCalled();
	});

	it("converges on round 2 after fixFn revises output", async () => {
		let reviewCount = 0;
		const run: ReviewerRun = async () => {
			reviewCount++;
			// 每 review 调 2 次（2 reviewer），reviewCount<=2 为第 1 轮（naughty）。
			return reviewCount <= 2
				? { verdict: "naughty", issues: [{ severity: "high", description: "bug" }] }
				: { verdict: "nice", issues: [] };
		};
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: run,
		});
		const fixFn = vi.fn(async (o: string, _issues: Issue[]) => `${o}-fixed`);
		const r = await v.verifyUntilNice("init", rubric, fixFn, 3);
		expect(r.verdict).toBe("nice");
		expect(r.rounds).toBe(2);
		expect(r.history).toHaveLength(2);
		expect(fixFn).toHaveBeenCalledTimes(1);
	});

	it("returns naughty after maxRounds without convergence", async () => {
		const run: ReviewerRun = async () => ({
			verdict: "naughty",
			issues: [{ severity: "high", description: "persistent bug" }],
		});
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: run,
		});
		const fixFn = vi.fn(async (o: string) => `${o}-fixed`);
		const r = await v.verifyUntilNice("init", rubric, fixFn, 3);
		expect(r.verdict).toBe("naughty");
		expect(r.rounds).toBe(3);
		expect(r.history).toHaveLength(3);
		expect(fixFn).toHaveBeenCalledTimes(3);
	});

	it("passes previous round's issues to fixFn", async () => {
		let reviewCount = 0;
		const run: ReviewerRun = async () => {
			reviewCount++;
			return reviewCount <= 2
				? { verdict: "naughty", issues: [{ severity: "high", description: "THE ISSUE" }] }
				: { verdict: "nice", issues: [] };
		};
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: run,
		});
		const seenIssues: Issue[][] = [];
		const fixFn = vi.fn(async (o: string, issues: Issue[]) => {
			seenIssues.push(issues);
			return `${o}-fixed`;
		});
		await v.verifyUntilNice("init", rubric, fixFn, 3);
		expect(seenIssues[0].some((x) => x.description === "THE ISSUE")).toBe(true);
	});

	it("uses fresh reviewers each round (reviewerRun called 2x per round)", async () => {
		let totalCalls = 0;
		const run: ReviewerRun = async () => {
			totalCalls++;
			return { verdict: "naughty", issues: [{ severity: "low", description: "x" }] };
		};
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			reviewerRun: run,
		});
		await v.verifyUntilNice("init", rubric, async (o) => o, 2);
		// 2 rounds × 2 reviewers = 4 calls
		expect(totalCalls).toBe(4);
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @agentforge/harness test -- verification.test.ts`
Expected: FAIL（`verifyUntilNice not implemented yet` 抛错）

- [ ] **Step 3: 替换 verifyUntilNice 实现**

在 `verification.ts` 的 `createSantaVerifier` 内，替换占位 `verifyUntilNice`：

```ts
	const verifyUntilNice: SantaVerifier["verifyUntilNice"] = async (
		initialOutput,
		rubric,
		fixFn,
		maxRounds = 3,
	) => {
		let output = initialOutput;
		const history: ReviewResult[] = [];
		for (let round = 1; round <= maxRounds; round++) {
			const result = await review(output, rubric); // 每轮 fresh reviewer（review 内 new）
			history.push(result);
			if (result.verdict === "nice") {
				return { output, verdict: "nice", rounds: round, history };
			}
			output = await fixFn(output, result.issues);
		}
		return { output, verdict: "naughty", rounds: maxRounds, history };
	};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @agentforge/harness test -- verification.test.ts`
Expected: PASS（fix loop 5 个测试绿）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @agentforge/harness typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/harness/src/verification.ts packages/harness/src/verification.test.ts
git commit -m "feat(verification): verifyUntilNice fix loop（max 3 轮 fresh reviewer）" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 默认 reviewerRun 真实 Agent 集成测试

**Files:**
- Test: `packages/harness/src/verification.test.ts`（追加默认 reviewerRun 集成测试）

**Interfaces:**
- Consumes: Task 2 的 `createSantaVerifier`（不注入 reviewerRun，用默认）+ pi `Agent` + `AssistantMessageEventStream`

**说明：** 此 task 验证默认 `reviewerRun`（真实 `Agent` + `submit_review` 工具）能跑通。mock `streamFn` 让 reviewer agent 产出 `submit_review` toolCall。pi agent toolUse loop：assistant 产出 toolCall(stopReason "toolUse") → agent 执行 submit_review → toolResult 进 messages → 继续 loop 调 streamFn → 返回 stop(stopReason "stop") → idle。mock `streamFn` 基于 messages 是否已含 submit_review toolCall 决定返回 toolCall 还是 stop（无状态，2 reviewer 共享正确）。**若 pi agent loop 行为与此假设不同（如 convertToLlm 改写 toolCall 结构），调整 mock 的判断逻辑——核心 review()/verifyUntilNice() 逻辑已被 Task 2/3 的 reviewerRun 注入测试覆盖，此集成测试仅验证默认路径接线。**

- [ ] **Step 1: 写集成测试**

追加到 `verification.test.ts`：

```ts
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessageEvent } from "@earendil-works/pi-agent-core";

/** 构造最小 assistant message（含给定 content blocks + stopReason）。 */
function makeAssistantMessage(
	content: any[],
	stopReason: "stop" | "toolUse",
): any {
	return {
		role: "assistant",
		content,
		api: "anthropic",
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
		stopReason,
		timestamp: Date.now(),
	};
}

/**
 * mock streamFn：messages 未含 submit_review 时返回 submit_review toolCall（toolUse），
 * 已含时返回 stop。无状态，2 reviewer 共享各自正确。
 * messages 是 convertToLlm 后的 LLM Message[]；用 JSON 序列化检测 submit_review 字样。
 */
function makeReviewerStreamFn(verdict: "nice" | "naughty", issues: Issue[]) {
	return (messages: any) => {
		const stream = new AssistantMessageEventStream();
		const serialized = JSON.stringify(messages ?? []);
		const hasSubmit = serialized.includes("submit_review");
		let message: any;
		let reason: "stop" | "toolUse";
		if (hasSubmit) {
			message = makeAssistantMessage([{ type: "text", text: "done" }], "stop");
			reason = "stop";
		} else {
			message = makeAssistantMessage(
				[
					{ type: "text", text: "reviewing" },
					{
						type: "toolCall",
						id: "call-submit",
						name: SUBMIT_REVIEW_TOOL_NAME,
						arguments: { verdict, issues },
					},
				],
				"toolUse",
			);
			reason = "toolUse";
		}
		const startEvent: AssistantMessageEvent = { type: "start", partial: message };
		const doneEvent: AssistantMessageEvent = { type: "done", reason, message };
		queueMicrotask(() => {
			stream.push(startEvent);
			stream.push(doneEvent);
		});
		return stream;
	};
}

describe("verification: default reviewerRun (real Agent + submit_review)", () => {
	it("extracts verdict from a real reviewer agent that calls submit_review", async () => {
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			streamFn: makeReviewerStreamFn("nice", []),
		});
		const r = await v.review("output", { criteria: ["c1"] });
		expect(r.verdict).toBe("nice");
		expect(r.reviews).toHaveLength(2);
		expect(r.reviews.every((rv) => rv.verdict === "nice")).toBe(true);
	});

	it("returns naughty when real reviewers call submit_review with naughty", async () => {
		const v = createSantaVerifier({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			streamFn: makeReviewerStreamFn("naughty", [
				{ severity: "high", description: "bug" },
			]),
		});
		const r = await v.review("output", { criteria: ["c1"] });
		expect(r.verdict).toBe("naughty");
		expect(r.issues.length).toBeGreaterThanOrEqual(1);
	});
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm --filter @agentforge/harness test -- verification.test.ts`
Expected: PASS

若 FAIL（pi agent loop 行为不同，如 mock streamFn 未被按预期调用、或 messages 结构不含 "submit_review" 字样导致 hasSubmit 判定错误），按失败信号调整 `makeReviewerStreamFn` 的 `hasSubmit` 判断逻辑（例如改检查 `messages` 数组里 assistant content 的 toolCall name，或在 streamFn 内部用闭包计数 + `createSantaVerifier` 改为每个 reviewer 独立 streamFn——但需同步改 `SantaVerifierDeps`，优先用最小改动让测试通过）。核心 gate/fix-loop 逻辑不在此 task 验证范围。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @agentforge/harness typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/harness/src/verification.test.ts
git commit -m "test(verification): 默认 reviewerRun 真实 Agent 集成测试" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: harness 集成（HarnessOptions.verifier + verify() + getter）

**Files:**
- Modify: `packages/harness/src/harness.ts`（HarnessOptions 加 verifier 字段，在 `safety` 后；私有字段 `_verifier`；constructor 赋值；加 `verify()` + `get verifier()`）
- Modify: `packages/harness/src/harness.test.ts`（追加 verifier 集成测试）

**Interfaces:**
- Consumes: Task 2 的 `SantaVerifier`/`ReviewResult`/`Rubric`
- Produces: `AgentForgeHarness.verify(output, rubric)` + `AgentForgeHarness.verifier` getter

- [ ] **Step 1: 写失败测试**

追加到 `packages/harness/src/harness.test.ts`：

```ts
import type { SantaVerifier, Rubric, ReviewResult } from "./verification.js";

// ... 已有 imports ...

describe("AgentForgeHarness verifier mounting", () => {
	it("verify() delegates to the injected verifier.review", async () => {
		const fakeReview = vi.fn(async (): Promise<ReviewResult> => ({
			verdict: "nice",
			issues: [],
			reviews: [
				{ verdict: "nice", issues: [] },
				{ verdict: "nice", issues: [] },
			],
		}));
		const verifier: SantaVerifier = {
			review: fakeReview,
			verifyUntilNice: vi.fn(async () => ({
				output: "o",
				verdict: "nice",
				rounds: 1,
				history: [],
			})) as any,
		};
		const events = createEventBus();
		const session = createMemorySession();
		const harness = new AgentForgeHarness({
			session,
			events,
			tools: [],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt: "test",
			streamFn: () => ({}) as any,
			verifier,
		});
		const rubric: Rubric = { criteria: ["c1"] };
		const r = await harness.verify("output", rubric);
		expect(fakeReview).toHaveBeenCalledTimes(1);
		expect(r.verdict).toBe("nice");
	});

	it("verify() throws when no verifier is configured", async () => {
		const events = createEventBus();
		const session = createMemorySession();
		const harness = new AgentForgeHarness({
			session,
			events,
			tools: [],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt: "test",
			streamFn: () => ({}) as any,
		});
		await expect(harness.verify("output", { criteria: ["c1"] })).rejects.toThrow(
			/no verifier/i,
		);
	});

	it("exposes verifier via getter (undefined when not injected)", () => {
		const events = createEventBus();
		const session = createMemorySession();
		const harness = new AgentForgeHarness({
			session,
			events,
			tools: [],
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			systemPrompt: "test",
			streamFn: () => ({}) as any,
		});
		expect(harness.verifier).toBeUndefined();
	});
});
```

注意：`harness.test.ts` 顶部已有 `import { vi } from "vitest";`；补 `./verification.js` 的类型 import。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @agentforge/harness test -- harness.test.ts`
Expected: FAIL（`harness.verify` 不是函数 / `verifier` 不是 getter）

- [ ] **Step 3: 修改 harness.ts**

3a. 顶部 import 区（`./safety.js` import 后）加：

```ts
import type { SantaVerifier, Rubric, ReviewResult } from "./verification.js";
```

3b. `HarnessOptions` 接口末尾（`cwd?: string;` 后、`}` 前）加：

```ts
	/**
	 * 可选 SantaVerifier（Slice 3 §4.8）。注入后，harness.verify(output, rubric)
	 * 委托 verifier.review。未注入时 verify() throw "no verifier configured"。
	 * harness.prompt 不自动触发 verifier（被动工具，调用方显式调）。
	 */
	verifier?: SantaVerifier;
```

3c. `AgentForgeHarness` 私有字段区（`private readonly cwd: string;` 后）加（注意下划线前缀避免与 getter 命名冲突）：

```ts
	private readonly _verifier?: SantaVerifier;
```

3d. constructor 内（`this.cwd = opts.cwd ?? process.cwd();` 后）加：

```ts
		this._verifier = opts.verifier;
```

3e. 在 `applySafety` 方法后加：

```ts
	/**
	 * 对抗验证（Slice 3 §4.8）：委托注入的 verifier.review(output, rubric)。
	 * 未注入 verifier 时 throw "no verifier configured"。
	 * 不自动触发——调用方显式调（harness.prompt 不调）。
	 */
	async verify(output: string, rubric: Rubric): Promise<ReviewResult> {
		if (!this._verifier) {
			throw new Error("no verifier configured");
		}
		return this._verifier.review(output, rubric);
	}

	/** 暴露注入的 verifier（高级用法访问 verifyUntilNice）；未注入时 undefined。 */
	get verifier(): SantaVerifier | undefined {
		return this._verifier;
	}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @agentforge/harness test -- harness.test.ts`
Expected: PASS（3 个 verifier 测试绿 + 既有 harness 测试仍绿）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @agentforge/harness typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/harness/src/harness.ts packages/harness/src/harness.test.ts
git commit -m "feat(harness): verifier 可选注入 + verify()/getter（Slice 3 §4.8）" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: index.ts export + rebuild dist + 全量验证

**Files:**
- Modify: `packages/harness/src/index.ts`（在 `export * from "./harness.js";` 后加 verification export）

**Interfaces:**
- Consumes: Task 1-5 的 verification 公共 API
- Produces: `@agentforge/harness` 包导出 verification

- [ ] **Step 1: 修改 index.ts**

在 `export * from "./harness.js";` 后加一行：

```ts
export * from "./verification.js";
```

- [ ] **Step 2: rebuild harness dist（老陷阱：cli typecheck 走 dist）**

Run: `pnpm --filter @agentforge/harness build`
Expected: PASS（dist 含 verification.js + .d.ts）

- [ ] **Step 3: 全量 typecheck（3 包）**

Run: `pnpm -r typecheck`
Expected: PASS（shared + harness + cli 全绿）

- [ ] **Step 4: 全量 test**

Run: `pnpm -r test`
Expected: PASS（193 既有 + 新增 verification 测试全绿）

- [ ] **Step 5: 真对话 smoke（可选，需 DEEPSEEK_API_KEY）**

若 session env 有 `DEEPSEEK_API_KEY`：

Run: `pnpm -r build && DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY node packages/cli/dist/index.js -p "用一句话回答 1+1"`
Expected: 正常输出（验证 harness 改造不破坏真对话链路；cli 本 slice 未接 verifier，故不验证 verify 真对话）

若无 key，跳过此步（TDD 已覆盖逻辑；真对话验证留 RPC slice 接通时）。

- [ ] **Step 6: Commit**

```bash
git add packages/harness/src/index.ts
git commit -m "feat(harness): export verification 模块 + 全量验证通过" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage：**
- §4.1 类型（Rubric/Issue/ReviewerVerdict/ReviewResult/FixFn/VerifyUntilNiceResult）→ Task 1 ✓
- §4.2 submit_review 工具（TypeBox）→ Task 1 ✓
- §4.3 SantaVerifier 接口 + createSantaVerifier（+ reviewerRun 细化）→ Task 2 ✓
- §4.4 harness 集成（HarnessOptions.verifier + verify + getter + prompt 不自动触发）→ Task 5 ✓
- §5.1 review 数据流（spawn 2 + 提取 + gate）→ Task 2 ✓
- §5.2 verifyUntilNice 数据流 → Task 3 ✓
- §6 gate AND / 未 submit 保守 naughty / reviewer 报错抛错 / fixFn 抛错抛错 / maxRounds 未收敛 → Task 1（gate）+ Task 2（未 submit）+ Task 3（maxRounds）✓；reviewer 报错抛错/fixFn 抛错由默认实现自然行为覆盖（不吞）
- §7 测试策略（review/verifyUntilNice/harness 集成/工具 schema/prompt builder/mock）→ Task 1-5 ✓
- §8 范围边界（RPC/cli 子命令/reviewer 工具/自动触发/强隔离 不做）→ plan 未涉及，符合 ✓

**2. Placeholder scan：** Task 4 Step 2 含"按失败信号调整"的备选说明——这是对 pi loop 不确定性的务实兜底，非 placeholder（核心逻辑已在 Task 2/3 覆盖）。其余步骤均含完整代码。无 TBD/TODO。

**3. Type consistency：**
- `ReviewerRun` / `SantaVerifier` / `SantaVerifierDeps` / `createSantaVerifier` 在 Task 2 定义，Task 3/4/5 引用一致。
- `gateReview`（Task 1）plan 内统一用 `gateReview`（避免与内置冲突）✓
- `SUBMIT_REVIEW_TOOL_NAME` / `createSubmitReviewTool` / `extractReviewerVerdict` / `defaultReviewerSystemPrompt`（Task 1）被 Task 2/4 引用一致 ✓
- `harness.verifier` getter vs 私有 `_verifier`——Task 5 Step 3c/3d/3e 已统一（私有 `_verifier`，getter `verifier`）✓
- `ReviewResult` / `Rubric` / `Issue` / `ReviewerVerdict` 在 Task 1 定义，harness.ts（Task 5）import 类型一致 ✓
