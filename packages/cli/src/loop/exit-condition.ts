// packages/cli/src/loop/exit-condition.ts
/**
 * 循环退出条件(spec §4.5)。纯函数,无副作用,无依赖。
 *
 * 五条件任一命中 → stop。判定顺序:maxRuns → maxCost → maxDuration →
 * completionSignal → consecutiveGateFailures。abort 不在此判定(abort 由
 * LoopRunner 循环顶部单独检 signal.aborted,保持本函数纯——spec §7 测试列表
 * 亦不含 abort,印证此设计)。
 *
 * 无任何条件(config 全空)→ 永不停;调用方(runLoopMode)应强制至少一个退出条件。
 */

export interface LoopState {
	runs: number;
	cost: number;
	durationMs: number;
	consecutiveCompletionSignals: number;
	consecutiveGateFailures: number;
}

export interface ExitConditionConfig {
	maxRuns?: number;
	maxCost?: number;
	maxDurationMs?: number;
	completionSignal?: string;
	/** completionSignal 连续命中几次才停。默认 1。 */
	completionThreshold?: number;
	/** 连续 gate 失败几次提前停(防 agent 破坏自身 test 空转烧预算)。默认 3。 */
	maxConsecutiveGateFailures?: number;
}

export interface ExitDecision {
	stop: boolean;
	reason: "max-runs" | "max-cost" | "max-duration" | "completion-signal" | "max-consecutive-gate-failures" | "";
}

/**
 * 五条件任一命中 → { stop:true, reason }。无命中 → { stop:false, reason:"" }。
 */
export function checkExit(state: LoopState, config: ExitConditionConfig): ExitDecision {
	if (config.maxRuns != null && state.runs >= config.maxRuns) {
		return { stop: true, reason: "max-runs" };
	}
	if (config.maxCost != null && state.cost >= config.maxCost) {
		return { stop: true, reason: "max-cost" };
	}
	if (config.maxDurationMs != null && state.durationMs >= config.maxDurationMs) {
		return { stop: true, reason: "max-duration" };
	}
	if (
		config.completionSignal != null &&
		state.consecutiveCompletionSignals >= (config.completionThreshold ?? 1)
	) {
		return { stop: true, reason: "completion-signal" };
	}
	const maxFail = config.maxConsecutiveGateFailures ?? 3;
	if (state.consecutiveGateFailures >= maxFail) {
		return { stop: true, reason: "max-consecutive-gate-failures" };
	}
	return { stop: false, reason: "" };
}
