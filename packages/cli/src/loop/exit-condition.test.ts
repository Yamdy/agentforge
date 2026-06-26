// packages/cli/src/loop/exit-condition.test.ts
import { describe, it, expect } from "vitest";
import { checkExit } from "./exit-condition.js";
import type { LoopState, ExitConditionConfig } from "./exit-condition.js";

const baseState: LoopState = {
	runs: 0,
	cost: 0,
	durationMs: 0,
	consecutiveCompletionSignals: 0,
	consecutiveGateFailures: 0,
};

describe("checkExit", () => {
	it("maxRuns 命中 → stop, reason max-runs", () => {
		const state: LoopState = { ...baseState, runs: 3 };
		const config: ExitConditionConfig = { maxRuns: 3 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-runs" });
	});

	it("maxRuns 未到 → 不停", () => {
		const state: LoopState = { ...baseState, runs: 2 };
		const config: ExitConditionConfig = { maxRuns: 3 };
		expect(checkExit(state, config)).toEqual({ stop: false, reason: "" });
	});

	it("maxCost 命中 → stop, reason max-cost", () => {
		const state: LoopState = { ...baseState, cost: 1.5 };
		const config: ExitConditionConfig = { maxCost: 1.5 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-cost" });
	});

	it("maxDurationMs 命中 → stop, reason max-duration", () => {
		const state: LoopState = { ...baseState, durationMs: 5000 };
		const config: ExitConditionConfig = { maxDurationMs: 5000 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-duration" });
	});

	it("completionSignal 达 threshold(默认 1)→ stop, reason completion-signal", () => {
		const state: LoopState = { ...baseState, consecutiveCompletionSignals: 1 };
		const config: ExitConditionConfig = { completionSignal: "DONE" };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "completion-signal" });
	});

	it("completionSignal threshold=2 未达 → 不停", () => {
		const state: LoopState = { ...baseState, consecutiveCompletionSignals: 1 };
		const config: ExitConditionConfig = { completionSignal: "DONE", completionThreshold: 2 };
		expect(checkExit(state, config)).toEqual({ stop: false, reason: "" });
	});

	it("completionSignal threshold=2 达 → stop", () => {
		const state: LoopState = { ...baseState, consecutiveCompletionSignals: 2 };
		const config: ExitConditionConfig = { completionSignal: "DONE", completionThreshold: 2 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "completion-signal" });
	});

	it("consecutiveGateFailures 达默认 3 → stop, reason max-consecutive-gate-failures", () => {
		const state: LoopState = { ...baseState, consecutiveGateFailures: 3 };
		const config: ExitConditionConfig = {};
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-consecutive-gate-failures" });
	});

	it("consecutiveGateFailures 自定义 2 达 → stop", () => {
		const state: LoopState = { ...baseState, consecutiveGateFailures: 2 };
		const config: ExitConditionConfig = { maxConsecutiveGateFailures: 2 };
		expect(checkExit(state, config)).toEqual({ stop: true, reason: "max-consecutive-gate-failures" });
	});

	it("无任何条件 → 永不停(调用方应至少配 maxRuns)", () => {
		expect(checkExit(baseState, {})).toEqual({ stop: false, reason: "" });
	});

	it("多条件同时命中 → stop=true(reason 为先命中者)", () => {
		const state: LoopState = { ...baseState, runs: 5, cost: 9.9 };
		const config: ExitConditionConfig = { maxRuns: 3, maxCost: 1.0 };
		const r = checkExit(state, config);
		expect(r.stop).toBe(true);
	});
});
