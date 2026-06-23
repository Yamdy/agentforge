import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
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
