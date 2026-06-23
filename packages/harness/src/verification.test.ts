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
