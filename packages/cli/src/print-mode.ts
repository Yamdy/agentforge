/**
 * cli print 模式。见 ARCHITECTURE.md §5/§8，Slice 0 Task 7。
 *
 * 职责：
 *  - parseArgs(argv)：解析 -p/--print <prompt>、--provider、--model、--session-dir。
 *  - runPrintMode(argv, deps?)：构造 AgentForgeHarness（接 read+bash 工具 + provider/model +
 *    getApiKey + 可选 mock streamFn），驱动 harness.prompt，返回最终 assistant 文本。
 *
 * 设计：核心逻辑抽成可测函数 runPrintMode(args, deps?)，deps={streamFn?, getApiKey?}
 * 便于测试注入 mock streamFn（不调真实 LLM）。bin 入口调用它。
 *
 * API key 绝不硬编码——从 process.env 读（环境变量名按 pi-ai 约定，如 DEEPSEEK_API_KEY）。
 */
import { parseArgs as nodeParseArgs } from "node:util";

import { AgentForgeHarness } from "@agentforge/harness";
import {
	createEventBus,
	createMemorySession,
	createSafetyGuard,
} from "@agentforge/harness";
import {
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createGlobTool,
} from "./tools/index.js";
import { createSystemPromptWithSkills, defaultSkillDirs } from "./system-prompt.js";
import { createCompactionConfig } from "./compaction-config.js";

/** print 模式解析后的 args。 */
export interface ParsedArgs {
	/** 是否进入 print 模式（-p/--print 提供）。 */
	print: boolean;
	/** print 模式的 prompt 文本。 */
	prompt?: string;
	/** provider 名，默认 "deepseek"。 */
	provider: string;
	/** model id，默认 "deepseek-v4-pro"。 */
	model: string;
	/** 可选 session 目录（Task 8 持久化用，Task 7 暂不用）。 */
	sessionDir?: string;
	/** 可选 session id（Task 9 REPL 用，--session <id>）。 */
	session?: string;
	/** 可选 resume 目标 session id（Task 9 REPL 用，--resume <id>）。 */
	resume?: string;
	/** 是否进入 RPC 模式（--rpc，Slice 3.5）。 */
	rpc: boolean;
}

/** 默认 provider/model（DeepSeek 原生 KnownProvider，pi-ai 内置注册）。 */
export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_MODEL = "deepseek-v4-pro";

/** 默认 systemPrompt。 */
export const DEFAULT_SYSTEM_PROMPT =
	"You are agentforge, a code agent. Use tools to help.";

/**
 * 解析 cli argv 为 ParsedArgs。
 *
 * 支持的 flag 最小集：
 *  - -p, --print <prompt>     ：进入 print 模式，prompt 为下一参数。
 *  - --provider <name>        ：覆盖默认 provider（deepseek）。
 *  - --model <id>             ：覆盖默认 model（deepseek-v4-pro）。
 *  - --session-dir <path>     ：可选 session 目录。
 *
 * 用 node:util parseArgs（strict）做最小手写解析。
 */
export function parseArgs(argv: string[]): ParsedArgs {
	const { values } = nodeParseArgs({
		args: argv,
		options: {
			print: { type: "string", short: "p" },
			provider: { type: "string", default: DEFAULT_PROVIDER },
			model: { type: "string", default: DEFAULT_MODEL },
			"session-dir": { type: "string" },
			session: { type: "string" },
			resume: { type: "string" },
			rpc: { type: "boolean", default: false },
		},
		allowPositionals: false,
		strict: true,
	});

	const prompt = values.print as string | undefined;
	return {
		print: prompt !== undefined,
		prompt,
		provider: (values.provider as string) ?? DEFAULT_PROVIDER,
		model: (values.model as string) ?? DEFAULT_MODEL,
		sessionDir: values["session-dir"] as string | undefined,
		session: values.session as string | undefined,
		resume: values.resume as string | undefined,
		rpc: (values.rpc as boolean) ?? false,
	};
}

/** runPrintMode 的可注入依赖（测试用）。 */
export interface PrintModeDeps {
	/** mock streamFn（测试注入，避免真实 LLM 请求）。真对话省略走默认 provider 流。 */
	streamFn?: any;
	/**
	 * getApiKey 回调。返回 apiKey（缺失返回 undefined，pi-ai provider 会抛错）。
	 * 签名比 HarnessOptions 宽松以容纳同步返回 undefined 的 env 读取。
	 */
	getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;
	/** 覆盖 skills 发现目录（测试用临时目录；默认 defaultSkillDirs()）。 */
	skillDirs?: string[];
	/** 测试检视 hook：harness 构造后立即调用（断言 tools/safety 等）。 */
	onHarnessCreated?: (h: AgentForgeHarness) => void;
}

/**
 * 驱动 print 模式：构造 harness、调用 prompt、返回最终 assistant 文本。
 *
 * @param argv cli argv（不含 node 二进制与脚本路径，即 process.argv.slice(2)）。
 * @param deps 可选注入（streamFn mock / getApiKey）。
 * @returns 最终 assistant 消息的 text content（无文本则空串）。
 */
export async function runPrintMode(argv: string[], deps: PrintModeDeps = {}): Promise<string> {
	const args = parseArgs(argv);
	if (!args.print || args.prompt === undefined) {
		throw new Error("print mode requires -p/--print <prompt>");
	}

	const session = createMemorySession();
	const events = createEventBus();
	const tools = [
		createReadTool(),
		createBashTool(),
		createEditTool(),
		createWriteTool(),
		createGrepTool(),
		createGlobTool(),
	];

	const systemPrompt = createSystemPromptWithSkills(
		DEFAULT_SYSTEM_PROMPT,
		deps.skillDirs ?? defaultSkillDirs(),
	);

	// Slice 2.5 T5：构造 compaction/budget 四字段并注入 harness（与 buildHarness 同构）。
	// getApiKey 缺省时给一个返回 undefined 的 stub，保持 createCompactionConfig 签名满足。
	const compaction = createCompactionConfig({
		provider: args.provider,
		model: args.model,
		getApiKey: deps.getApiKey ?? (() => undefined),
	});
	const harness = new AgentForgeHarness({
		session,
		events,
		tools,
		provider: args.provider,
		model: args.model,
		systemPrompt,
		// HarnessOptions.getApiKey 签名为 (provider) => string | Promise<string|undefined>，
		// 此处放宽断言以容纳同步返回 undefined 的 env 读取。
		getApiKey: deps.getApiKey as
			| ((provider: string) => string | Promise<string | undefined>)
			| undefined,
		streamFn: deps.streamFn,
		// T8 §4.6：print 模式接 SafetyGuard，但**不传** safetyAskHandler——
		// 无人工交互通道，ask 降级 deny（reason "safety:ask-no-handler"），用户决策。
		safety: createSafetyGuard(),
		compactor: compaction.compactor,
		compactorDeps: compaction.compactorDeps,
		modelContextWindow: compaction.modelContextWindow,
		budgetThresholds: compaction.budgetThresholds,
	});

	// 测试检视 hook。
	deps.onHarnessCreated?.(harness);

	await harness.prompt(args.prompt);

	// 从 agent.state.messages 取最后 assistant 消息的 text content
	const messages = harness.agent.state.messages;
	const lastAssistant = [...messages]
		.reverse()
		.find((m) => m.role === "assistant");
	if (!lastAssistant) {
		return "";
	}
	const textBlock = lastAssistant.content.find(
		(c: any) => c.type === "text",
	) as { type: "text"; text: string } | undefined;
	return textBlock?.text ?? "";
}
