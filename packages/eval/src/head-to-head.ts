/**
 * Slice 7 eval head-to-head(spec §4.3 / plan Task 5)。
 *
 * runHeadToHead(tasks, configs, opts?):configs 各跑 runSuite → SuiteResult[]。
 *   - 单变量 diff(D5):configs 应仅 provider/model/systemPrompt 之一不同;
 *     本函数不强制(调用方负责),仅提供跑多 config 的入口。
 *   - streamFn 透传给每个 config 的 runSuite(测试注入;真实场景由 runSuite 默认走
 *     pi-ai streamFn)。streamFn 签名 streamFn(model, llmContext, options),首参 model
 *     可用于按 config.model 区分 mock(见 head-to-head.test.ts)。
 *   - sandboxDir 同一根,runSuite 在其下建子目录隔离每 run(见 runner.runSuite)。
 *
 * compare(results):markdown 对比表,列 config name | completionRate | totalCost |
 *   avgWallClockMs(任一 result.metrics.pass3 !== undefined 时加 pass3 列,可选)。
 *   - 表头 + 分隔行 + 每 result 一数据行
 *   - 数值格式:completionRate/pass1/pass3 保留原值(fraction,如 1 / 0.5);
 *     totalCost 保留 6 位小数;avgWallClockMs 取整(ms)
 *
 * 不依赖 harness/LLM:仅聚合 SuiteResult,数据源已在 runSuite/runner 确定。
 */
import { runSuite } from "./runner.js";
import type { RunOpts } from "./runner.js";
import type { EvalConfig, SuiteResult, Task } from "./types.js";

/**
 * 跑多 config 各自 runSuite → SuiteResult[]。
 *
 * opts 透传给每个 runSuite(repeats/sandboxDir/streamFn)。streamFn 同一份,内部可按
 * config.model 区分(首参 model)。
 */
export async function runHeadToHead(
	tasks: Task[],
	configs: EvalConfig[],
	opts?: RunOpts,
): Promise<SuiteResult[]> {
	const results: SuiteResult[] = [];
	for (const config of configs) {
		// 每 config 独立 runSuite;streamFn/sandboxDir 透传(同一 sandbox 根,runSuite 建子目录隔离)
		const suiteResult = await runSuite(tasks, config, opts);
		results.push(suiteResult);
	}
	return results;
}

/**
 * 渲染 markdown 对比表(列:config | completionRate | pass1 | pass3? | totalCost | avgWallClockMs)。
 *
 * pass3 仅当任一 result.metrics.pass3 !== undefined 时渲染(可选列)。completionRate/pass1
 * 总是渲染。totalCost 保留 6 位小数,avgWallClockMs 取整 ms。
 */
export function compare(results: SuiteResult[]): string {
	const hasPass3 = results.some((r) => r.metrics.pass3 !== undefined);

	const header = hasPass3
		? "| config | completionRate | pass1 | pass3 | totalCost | avgWallClockMs |"
		: "| config | completionRate | pass1 | totalCost | avgWallClockMs |";
	const separator = hasPass3
		? "| --- | --- | --- | --- | --- | --- |"
		: "| --- | --- | --- | --- | --- |";

	const rows = results.map((r) => {
		const cr = r.metrics.completionRate;
		const p1 = r.metrics.pass1;
		const cost = r.metrics.totalCost.toFixed(6);
		const wc = Math.round(r.metrics.avgWallClockMs);
		if (hasPass3) {
			const p3 = r.metrics.pass3;
			const p3Str = p3 !== undefined ? String(p3) : "";
			return `| ${r.config.name} | ${cr} | ${p1} | ${p3Str} | ${cost} | ${wc} |`;
		}
		return `| ${r.config.name} | ${cr} | ${p1} | ${cost} | ${wc} |`;
	});

	return [header, separator, ...rows].join("\n");
}
