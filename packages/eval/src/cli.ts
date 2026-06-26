/**
 * Slice 7 eval CLI(spec §4.5 / plan Task 7)。
 *
 * `agentforge eval --suite <dir> --config a.json --config b.json [--repeats N] [--sandbox <dir>]`
 *   → head-to-head → stdout markdown 对比表 + 写 JSON 报告(SuiteResult[])。
 *
 * 职责:
 *  - parseArgs(argv):解析 --suite/--config[]/--repeats/--sandbox
 *  - runCli(argv, deps?):load tasks from suite dir → load configs → runHeadToHead →
 *    stdout compare(markdown)+ 写 JSON 报告
 *
 * 设计:
 *  - suite 任务加载:suite dir 下找 task.{cjs,mjs,js},dynamic import 取 default/导出
 *    (Task[] 或单 Task)。cjs 用 require(避免 ESM/CJS 互操作复杂度)。
 *  - configs:逐 --config 读 JSON → EvalConfig[]。
 *  - streamFn 注入(测试用,避开真实 LLM);真实场景由 runSuite 默认走 pi-ai streamFn。
 *  - stdout 经 deps.stdout 注入(默认 process.stdout.write),便于测试捕获。
 *  - JSON 报告写 deps.reportPath(默认不写,测试显式注入);生产可加默认路径。
 */
import { parseArgs as nodeParseArgs } from "node:util";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import { runHeadToHead, compare } from "./head-to-head.js";
import type { RunOpts } from "./runner.js";
import type { EvalConfig, Task, SuiteResult } from "./types.js";

/** parseArgs 解析后的 args。 */
export interface ParsedArgs {
	/** suite 目录(必填)。 */
	suite: string;
	/** config 文件路径数组(--config 可多次)。 */
	configs: string[];
	/** 每 task 跑多少次,默认 1。 */
	repeats: number;
	/** sandbox 根目录(可选)。 */
	sandbox?: string;
}

/**
 * 解析 cli argv 为 ParsedArgs。
 *
 * 支持的 flag:
 *  - --suite <dir>           :suite 目录(必填)
 *  - --config <path>         :config JSON 文件(可多次,允许多个)
 *  - --repeats <n>           :每 task 跑多少次,默认 1
 *  - --sandbox <dir>         :sandbox 根目录(可选)
 *
 * 用 node:util parseArgs(strict);--config 用 multiple 收集数组。
 * 缺 --suite 抛错。
 */
export function parseArgs(argv: string[]): ParsedArgs {
	const { values } = nodeParseArgs({
		args: argv,
		options: {
			suite: { type: "string" },
			config: { type: "string", multiple: true },
			repeats: { type: "string", default: "1" },
			sandbox: { type: "string" },
		},
		allowPositionals: false,
		strict: true,
	});

	const suite = values.suite as string | undefined;
	if (!suite) {
		throw new Error("eval CLI requires --suite <dir>");
	}

	const configs = (values.config as string[] | undefined) ?? [];
	const repeatsRaw = values.repeats as string | undefined;
	const repeats = Number.parseInt(repeatsRaw ?? "1", 10);
	if (!Number.isFinite(repeats) || repeats < 1) {
		throw new Error(`--repeats must be a positive integer, got: ${repeatsRaw}`);
	}

	return {
		suite,
		configs,
		repeats,
		sandbox: values.sandbox as string | undefined,
	};
}

/** runCli 的可注入依赖(测试用)。 */
export interface CliDeps {
	/** mock streamFn(测试注入,避开真实 LLM)。 */
	streamFn?: any;
	/** stdout 写入函数(默认 process.stdout.write)。 */
	stdout?: (s: string) => void;
	/** JSON 报告写入路径(可选;提供则写 SuiteResult[] JSON)。 */
	reportPath?: string;
}

/**
 * 从 suite 目录加载 tasks。
 *
 * 约定:suite dir 下找 task.{cjs,mjs,js} 文件,dynamic import 取导出:
 *  - 默认导出(default)为数组 Task[] 或单 Task
 *  - 命名导出 sampleTasks / tasks 数组
 * cjs 用 require(同步,避免 ESM import .cjs 互操作问题);mjs/js 用 pathToFileURL dynamic import。
 *
 * 无 task 文件 → 抛错(eval 无 tasks 无意义)。
 */
export async function loadTasks(suiteDir: string): Promise<Task[]> {
	const entries = readdirSync(suiteDir);
	const taskFile = entries.find((e) =>
		["task.cjs", "task.mjs", "task.js"].includes(e),
	);
	if (!taskFile) {
		throw new Error(`no task.{cjs,mjs,js} found in suite dir: ${suiteDir}`);
	}

	const fullPath = join(suiteDir, taskFile);
	const ext = extname(taskFile);

	let mod: any;
	if (ext === ".cjs") {
		const req = createRequire(import.meta.url);
		mod = req(fullPath);
	} else {
		mod = await import(pathToFileURL(fullPath).href);
	}

	// mod 本身就是数组(module.exports = [...])
	if (Array.isArray(mod)) {
		return mod as Task[];
	}
	// 优先 default 导出,其次命名导出 sampleTasks/tasks
	const candidate = mod.default ?? mod.sampleTasks ?? mod.tasks;
	if (Array.isArray(candidate)) {
		return candidate as Task[];
	}
	// 单 Task 对象(有 id/prompt/acceptanceChecks)
	if (candidate && typeof candidate === "object" && "id" in candidate) {
		return [candidate as Task];
	}
	throw new Error(
		`task file ${taskFile} must export Task[] or Task (default/sampleTasks/tasks)`,
	);
}

/** 加载 configs:逐 JSON 文件读 → EvalConfig。 */
export function loadConfigs(configPaths: string[]): EvalConfig[] {
	const configs: EvalConfig[] = [];
	for (const p of configPaths) {
		if (!existsSync(p)) {
			throw new Error(`config file not found: ${p}`);
		}
		const raw = readFileSync(p, "utf-8");
		configs.push(JSON.parse(raw) as EvalConfig);
	}
	return configs;
}

/**
 * 驱动 eval CLI:parseArgs → load tasks/configs → runHeadToHead → stdout markdown + JSON 报告。
 *
 * @param argv cli argv(不含 node 二进制与脚本路径,即 process.argv.slice(2))。
 * @param deps 可选注入(streamFn mock / stdout / reportPath)。
 * @returns SuiteResult[](便于调用方进一步处理)。
 */
export async function runCli(
	argv: string[],
	deps: CliDeps = {},
): Promise<SuiteResult[]> {
	const args = parseArgs(argv);

	const tasks = await loadTasks(args.suite);
	const configs = loadConfigs(args.configs);

	if (configs.length === 0) {
		throw new Error("eval CLI requires at least one --config <path>");
	}

	const runOpts: RunOpts = {
		repeats: args.repeats,
		sandboxDir: args.sandbox,
		streamFn: deps.streamFn,
	};

	const results = await runHeadToHead(tasks, configs, runOpts);

	// stdout markdown 对比表
	const md = compare(results);
	const write = deps.stdout ?? ((s: string) => process.stdout.write(s));
	write(md + "\n");

	// JSON 报告(测试 / 生产可注入路径)
	if (deps.reportPath) {
		writeFileSync(deps.reportPath, JSON.stringify(results, null, 2), "utf-8");
	}

	return results;
}
