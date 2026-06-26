/**
 * Slice 7 eval 包 runner(spec §4.2 / plan Task 3)。
 *
 * runTask(task, config, sandbox, opts?):单 task 跑一轮,产 TaskResult。
 *
 * 数据源(red-team 🟡 2/3,明确提取路径):
 * - reply:harness.prompt() 返 void 后,读 harness.agent.state.messages,取最后
 *   AssistantMessage,content 中 TextContent block 的 text join(过滤 thinking/toolCall)。
 * - tokensIn:message.usage.input
 * - tokensOut:message.usage.output
 * - cost:message.usage.cost.total(pi 预算,不重算 Model.cost,避免单位混淆)
 * - wallClockMs:Date.now() 包 await harness.prompt(...)
 * - passed:runAcceptance(checks, sandbox, reply)
 *
 * 流程:setup(sandbox) → 构造 AgentForgeHarness(getModel + getApiKey + tools +
 *   systemPrompt) → t0; await harness.prompt(task.prompt); t1 → 提取 reply/usage →
 *   runAcceptance → teardown → TaskResult。teardown 在 finally 跑(即使 acceptance 不过)。
 *
 * 测试注入:opts.streamFn 透传给 AgentForgeHarness(避免真实 LLM 请求)。
 * getApiKey:用 pi-ai getEnvApiKey(等价 cli env-config.getApiKeyFromEnv,避免 eval→cli
 * 跨依赖,保持包独立 D1)。
 *
 * 安全:tools 默认 [](eval 不调真实工具,acceptance 声明式校验 sandbox 产物);
 * sandbox 由调用方提供(runSuite 用 tmpdir)。
 */
import { getEnvApiKey, getModel } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	AgentForgeHarness,
	createEventBus,
	createMemorySession,
} from "@agentforge/harness";

import { runAcceptance } from "./acceptance.js";
import type {
	EvalConfig,
	Metrics,
	SuiteResult,
	Task,
	TaskResult,
} from "./types.js";

/** runTask 可选注入(测试用 streamFn 避开真实 LLM)。 */
export interface RunTaskOpts {
	streamFn?: any;
}

/**
 * runSuite 可选参数(spec §4.2)。
 * - repeats:每 task 跑多少次,默认 1(repeats≥3 时算 pass3,red-team 🟡 5 默认 off)
 * - sandboxDir:每 task 单次 run 的 sandbox 根目录(runSuite 在其下建子目录隔离)
 * - streamFn:测试注入,透传给 runTask 避开真实 LLM
 */
export interface RunOpts {
	repeats?: number;
	sandboxDir?: string;
	streamFn?: any;
}

/**
 * 跑单 task:setup → harness.prompt → 提取 reply/usage → acceptance → teardown → TaskResult。
 *
 * teardown 总在 finally 跑(即使 acceptance 或 prompt 抛错)。
 * 若 setup/prompt 抛错,TaskResult.passed=false 且 error 填异常 message,reply 为空。
 */
export async function runTask(
	task: Task,
	config: EvalConfig,
	sandbox: string,
	opts?: RunTaskOpts,
): Promise<TaskResult> {
	const t0 = Date.now();
	let reply = "";
	let tokensIn = 0;
	let tokensOut = 0;
	let cost = 0;
	let passed = false;
	let error: string | undefined;

	try {
		if (task.setup) {
			await task.setup(sandbox);
		}

		const harness = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools: [],
			provider: config.provider,
			model: config.model,
			systemPrompt: config.systemPrompt ?? "",
			getApiKey: (provider: string) =>
				Promise.resolve(getEnvApiKey(provider, process.env as unknown as Record<string, string>)),
			streamFn: opts?.streamFn,
		});

		await harness.prompt(task.prompt);
		const t1 = Date.now();

		const last = lastAssistantMessage(harness.agent.state.messages);
		if (last) {
			reply = contentToText(last.content);
			tokensIn = last.usage?.input ?? 0;
			tokensOut = last.usage?.output ?? 0;
			cost = last.usage?.cost?.total ?? 0;
		}

		passed = runAcceptance(task.acceptanceChecks, sandbox, reply);
		// wallClockMs 在 finally 外返回时算(t1-t0);此处保留 t1 供返回。
		return {
			taskId: task.id,
			reply,
			passed,
			tokensIn,
			tokensOut,
			cost,
			wallClockMs: t1 - t0,
			error,
		};
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
		return {
			taskId: task.id,
			reply,
			passed: false,
			tokensIn,
			tokensOut,
			cost,
			wallClockMs: Date.now() - t0,
			error,
		};
	} finally {
		if (task.teardown) {
			try {
				await task.teardown(sandbox);
			} catch {
				// teardown 失败不影响 TaskResult(已构造);吞掉避免污染 runner 调用方。
			}
		}
	}
}

/**
 * 取 messages 中最后一条 AssistantMessage(从尾向头找第一个 role==="assistant")。
 * pi AgentMessage = Message | CustomMessage;只 AssistantMessage 有 usage + content text。
 */
function lastAssistantMessage(
	messages: AgentMessage[],
): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (isAssistantMessage(m)) {
			return m;
		}
	}
	return undefined;
}

/** AssistantMessage 类型守卫(role === "assistant")。 */
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m != null && typeof m === "object" && (m as { role?: string }).role === "assistant";
}

/**
 * content block text join:取所有 TextContent.text 拼接,过滤 thinking/toolCall。
 * (spec §4.2:content text join;多 text block 拼 "part1part2"。)
 */
function contentToText(
	content: AssistantMessage["content"],
): string {
	let out = "";
	for (const block of content) {
		if (block && (block as { type?: string }).type === "text") {
			out += (block as { text: string }).text;
		}
	}
	return out;
}

/**
 * runSuite(spec §4.2 / plan Task 4):跑全部 task,聚合 metrics → SuiteResult。
 *
 * - repeats 默认 1;repeats=N 时每 task 跑 N 次,results 长度 = tasks.length * N
 * - 每 task 每次 run 用独立 sandbox 子目录(sandboxDir/<taskId>-<runIdx>),隔离 setup 产物
 * - metrics 聚合:
 *     completionRate = passed / total runs
 *     pass1 = 单跑通过率(repeats=1 时同 completionRate;repeats>1 时按"每 task 第 1 次 run"算)
 *     pass3 = repeats≥3 时填:每 task 任一 run 通过的比例(任一通过率);<3 时 undefined
 *     totalTokens / totalCost = sum over all runs
 *     avgWallClockMs = mean over all runs
 * - streamFn 透传给 runTask(测试注入,避开真实 LLM)
 *
 * sandbox:sandboxDir 必须由调用方提供(测试用 tmpdir);runSuite 在其下建子目录隔离每 run。
 */
export async function runSuite(
	tasks: Task[],
	config: EvalConfig,
	opts?: RunOpts,
): Promise<SuiteResult> {
	const repeats = opts?.repeats && opts.repeats >= 1 ? Math.floor(opts.repeats) : 1;
	const sandboxRoot = opts?.sandboxDir;
	const streamFn = opts?.streamFn;

	const allResults: TaskResult[] = [];
	const firstRunByTask = new Map<string, TaskResult>();
	const pass3ByTask = new Map<string, boolean>();

	for (const task of tasks) {
		let anyPassed = false;
		for (let i = 0; i < repeats; i++) {
			// 每 run 独立 sandbox 子目录,隔离 setup 产物(防跨 run 污染)。
			const sandbox =
				sandboxRoot != null
					? pathJoin(sandboxRoot, `${task.id}-${i}`)
					: fsMkdtempSync();
			ensureDir(sandbox);
			const result = await runTask(task, config, sandbox, { streamFn });
			allResults.push(result);
			if (result.passed) anyPassed = true;
			if (i === 0) firstRunByTask.set(task.id, result);
		}
		pass3ByTask.set(task.id, anyPassed);
	}

	const metrics = aggregateMetrics(allResults, tasks, firstRunByTask, pass3ByTask, repeats);

	return { config, results: allResults, metrics };
}

/**
 * 聚合 metrics(spec §4.1 Metrics)。
 * - completionRate = passed / total runs
 * - pass1 = 每 task 第 1 次 run 通过比例(firstRunByTask)
 * - pass3 = repeats≥3 时填:每 task 任一 run 通过比例(pass3ByTask);否则 undefined
 * - totalTokens = sum(tokensIn + tokensOut)
 * - totalCost = sum(cost)
 * - avgWallClockMs = mean(wallClockMs)
 */
function aggregateMetrics(
	results: TaskResult[],
	tasks: Task[],
	firstRunByTask: Map<string, TaskResult>,
	pass3ByTask: Map<string, boolean>,
	repeats: number,
): Metrics {
	const total = results.length;
	const passed = results.filter((r) => r.passed).length;
	const completionRate = total > 0 ? passed / total : 0;

	// pass1:每 task 第 1 次 run 通过比例
	const firstPassed = tasks.filter((t) => firstRunByTask.get(t.id)?.passed).length;
	const pass1 = tasks.length > 0 ? firstPassed / tasks.length : 0;

	// pass3:repeats≥3 时填(任一通过率);<3 时 undefined(red-team 🟡 5 默认 off)
	let pass3: number | undefined;
	if (repeats >= 3) {
		const anyPassedCount = tasks.filter((t) => pass3ByTask.get(t.id) === true).length;
		pass3 = tasks.length > 0 ? anyPassedCount / tasks.length : 0;
	}

	const totalTokens = results.reduce((sum, r) => sum + r.tokensIn + r.tokensOut, 0);
	const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
	const avgWallClockMs =
		total > 0 ? results.reduce((sum, r) => sum + r.wallClockMs, 0) / total : 0;

	return {
		completionRate,
		pass1,
		pass3,
		totalTokens,
		totalCost,
		avgWallClockMs,
	};
}

// --- sandbox 子目录辅助(惰性 import 避免顶层 side-effect) ---
import { mkdirSync, mkdtempSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { tmpdir } from "node:os";

function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

function fsMkdtempSync(): string {
	return mkdtempSync(pathJoin(tmpdir(), "eval-suite-"));
}
