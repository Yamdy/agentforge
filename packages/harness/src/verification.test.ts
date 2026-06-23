import { describe, it, expect, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
	extractReviewerVerdict,
	gateReview,
	defaultReviewerSystemPrompt,
	createSubmitReviewTool,
	createSantaVerifier,
	SUBMIT_REVIEW_TOOL_NAME,
	type Rubric,
	type ReviewerVerdict,
	type ReviewerRun,
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
