/**
 * cli REPL 模式。见 ARCHITECTURE.md §5/§8，Slice 0 Task 9。
 *
 * 职责：
 *  - 无 -p/--print 时进入 REPL：readline 循环，每行输入 → harness.prompt →
 *    输出 assistant 回复，直到 EOF 或 "exit"。
 *  - --resume <sessionId>：用 createJsonlSession 加载已持久化 session，重建
 *    messages 喂给 Agent initialState.messages（经 HarnessOptions.initialMessages），
 *    继续对话。
 *  - session 持久化：REPL 用 createJsonlSession（非 memory），每轮 prompt 后
 *    harness.prompt 内部已 appendEntry 同步落盘（Task 8）。sessionId 由 cli 生成
 *    或 --session 指定，启动时打印。
 *
 * 设计：核心逻辑抽成可测函数 runReplMode(args, deps?)，deps={streamFn?, getApiKey?,
 * input?, output?, sessionDir?}。bin 入口调用它。input/output 抽象为最小接口
 * （read(): string|null / write(s): void），测试注入 mock，bin 用 readline 适配。
 *
 * API key 绝不硬编码——从 process.env 读（环境变量名按 pi-ai 约定）。
 */
import { randomUUID } from "node:crypto";

import {
	AgentForgeHarness,
	createJsonlSession,
	createEventBus,
	createSafetyGuard,
	rebuildMessages,
} from "@agentforge/harness";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SafetyContext, SantaVerifier } from "@agentforge/harness";

import {
	parseArgs,
	DEFAULT_SYSTEM_PROMPT,
	type ParsedArgs,
} from "./print-mode.js";
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

/** runReplMode 的可注入输入源（测试 mock 或 readline 适配）。 */
export interface ReplInput {
	/** 读下一行；返回 null 表示 EOF（无更多输入）。异步以支持 readline 逐行事件桥接。 */
	read(): Promise<string | null>;
}

/**
 * 把逐行事件源桥接为异步 read() 队列（ADR-0001a readline 逐行）。
 * 返回 { read, push }：read 消费一行（null=EOF），push 喂 readline 'line'/'close' 事件。
 * pending 缓存已到达未消费的行；lineResolve 是 read 正在等待的 resolver
 * （有 line 到达时直接 resolve 它，不入 pending）。
 *
 * bin 入口（index.ts）rpc/repl 两分支共用，消除重复队列桥接代码（A6）。
 */
export function makeReadlineBridge(): {
	read(): Promise<string | null>;
	push: (line: string | null) => void;
} {
	const pending: (string | null)[] = [];
	let lineResolve: ((line: string | null) => void) | null = null;
	const push = (line: string | null): void => {
		if (lineResolve) {
			const resolve = lineResolve;
			lineResolve = null;
			resolve(line);
		} else {
			pending.push(line);
		}
	};
	const read = (): Promise<string | null> => {
		if (pending.length > 0) {
			return Promise.resolve(pending.shift() as string | null);
		}
		return new Promise<string | null>((resolve) => {
			lineResolve = resolve;
		});
	};
	return { read, push };
}

/**
 * 构造 rpc/repl 共享的 AgentForgeHarness（A2：消除两 mode 重复构造）。
 * tools/systemPrompt/safety/events/cwd 统一；rpc 传 verifier，repl 传 safetyAskHandler。
 * --resume 的 initialMessages 计算留调用方（repl 还需 resumedMessageCount）。
 */
export function buildHarness(opts: {
	args: ParsedArgs;
	session: ReturnType<typeof createJsonlSession>;
	initialMessages: AgentMessage[];
	streamFn?: any;
	getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;
	skillDirs?: string[];
	verifier?: SantaVerifier;
	safetyAskHandler?: (ctx: SafetyContext) => boolean | Promise<boolean>;
}): AgentForgeHarness {
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
		opts.skillDirs ?? defaultSkillDirs(),
	);
	// Slice 2.5 T4：构造 compaction/budget 四字段并注入 harness（repl/rpc 共用）。
	// getApiKey 缺省时给一个返回 undefined 的 stub，保持 createCompactionConfig 签名满足。
	const compaction = createCompactionConfig({
		provider: opts.args.provider,
		model: opts.args.model,
		getApiKey: opts.getApiKey ?? (() => undefined),
	});
	return new AgentForgeHarness({
		session: opts.session,
		events,
		tools,
		provider: opts.args.provider,
		model: opts.args.model,
		systemPrompt,
		getApiKey: opts.getApiKey as
			| ((provider: string) => string | Promise<string | undefined>)
			| undefined,
		streamFn: opts.streamFn,
		initialMessages: opts.initialMessages,
		safety: createSafetyGuard(),
		safetyAskHandler: opts.safetyAskHandler,
		cwd: process.cwd(),
		verifier: opts.verifier,
		compactor: compaction.compactor,
		compactorDeps: compaction.compactorDeps,
		modelContextWindow: compaction.modelContextWindow,
		budgetThresholds: compaction.budgetThresholds,
	});
}

/** runReplMode 的可注入输出汇（测试 mock 或 process.stdout 适配）。 */
export interface ReplOutput {
	/** 写一段文本（不含自动换行，调用方决定）。 */
	write(s: string): void;
}

/** runReplMode 的可注入依赖（测试用）。 */
export interface ReplModeDeps {
	/** mock streamFn（测试注入，避免真实 LLM 请求）。真对话省略走默认 provider 流。 */
	streamFn?: any;
	/** getApiKey 回调。真对话从 process.env 读。 */
	getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;
	/** 注入输入源（测试用 mock）。bin 用 readline 适配。 */
	input?: ReplInput;
	/** 注入输出汇（测试用 mock）。bin 用 process.stdout 适配。 */
	output?: ReplOutput;
	/** 覆盖 session 目录（测试用临时目录）。bin 默认 <cwd>/.agentforge/sessions。 */
	sessionDir?: string;
	/** 覆盖 skills 发现目录（测试用临时目录；默认 defaultSkillDirs()）。 */
	skillDirs?: string[];
	/**
	 * 可选 SafetyGuard.ask 处理器（T8 §4.6）。safety.check 返回 "ask" 时调用，
	 * 返回 true 放行、false 阻断。bin 入口传真实 readline handler；
	 * 测试注入 mock；未提供时 ask 降级 deny（reason "safety:ask-no-handler"）。
	 */
	safetyAskHandler?: (ctx: SafetyContext) => boolean | Promise<boolean>;
	/** 测试检视 hook：harness 构造后立即调用（断言 tools/safety 等）。 */
	onHarnessCreated?: (h: AgentForgeHarness) => void;
}

/** runReplMode 的返回值。 */
export interface ReplResult {
	/** 本次会话的 sessionId（--session 指定或自动生成；--resume 时为被恢复的 id）。 */
	sessionId: string;
	/** --resume 时从历史 session 重建的 initialState.messages 数量；非 resume 为 0。 */
	resumedMessageCount: number;
}

/** 默认 session 目录：<cwd>/.agentforge/sessions。 */
export function defaultSessionDir(): string {
	return `${process.cwd()}/.agentforge/sessions`;
}

/** REPL 退出命令。 */
const EXIT_COMMAND = "exit";

/**
 * 驱动 REPL 模式：构造 harness、readline 循环、每行 prompt、输出回复、持久化。
 *
 * @param argv cli argv（不含 node 二进制与脚本路径）。
 * @param deps 可选注入（streamFn mock / getApiKey / input / output / sessionDir）。
 * @returns sessionId 与 resumedMessageCount。
 */
export async function runReplMode(
	argv: string[],
	deps: ReplModeDeps = {},
): Promise<ReplResult> {
	const args = parseArgs(argv);
	// print 模式不应走 runReplMode；防御性检查。
	if (args.print) {
		throw new Error("runReplMode does not handle print mode; use runPrintMode");
	}

	const sessionDir = deps.sessionDir ?? args.sessionDir ?? defaultSessionDir();
	const sessionId = resolveSessionId(args);
	const sessionPath = `${sessionDir}/${sessionId}.jsonl`;

	// 构造 JSONL session store（自动加载已有文件重建 entries + leafId）。
	const session = createJsonlSession(sessionPath);

	// --resume：从已持久化 session 重建 messages 喂给 Agent initialState。
	let initialMessages: AgentMessage[] = [];
	let resumedMessageCount = 0;
	if (args.resume) {
		const result = resumeFromSession(session, args.resume);
		initialMessages = result.messages;
		resumedMessageCount = result.messages.length;
	}

	const harness = buildHarness({
		args,
		session,
		initialMessages,
		streamFn: deps.streamFn,
		getApiKey: deps.getApiKey,
		skillDirs: deps.skillDirs,
		// T8 §4.6：接 SafetyGuard（默认规则）+ askHandler（bin 传 readline，测试 mock）。
		// 未传 safetyAskHandler 时 ask 降级 deny（reason "safety:ask-no-handler"）。
		safetyAskHandler: deps.safetyAskHandler,
	});

	// 测试检视 hook。
	deps.onHarnessCreated?.(harness);

	const output = deps.output ?? stdoutOutput();
	const input = deps.input;

	// 启动横幅：打印 sessionId。
	output.write(`agentforge — session ${sessionId}\n`);

	// 无注入 input 且不在 TTY：无法交互，直接返回（bin 入口会传 readline input）。
	if (!input) {
		return { sessionId, resumedMessageCount };
	}

	// REPL 循环。
	while (true) {
		const line = await input.read();
		if (line === null) {
			// EOF：退出。
			break;
		}
		const trimmed = line.trim();
		if (trimmed === "") {
			continue;
		}
		if (trimmed === EXIT_COMMAND) {
			break;
		}

		await harness.prompt(trimmed);

		// 输出最后一条 assistant 消息的 text content。
		const messages = harness.agent.state.messages;
		const lastAssistant = [...messages]
			.reverse()
			.find((m) => m.role === "assistant");
		if (lastAssistant) {
			const textBlock = lastAssistant.content.find(
				(c: any) => c.type === "text",
			) as { type: "text"; text: string } | undefined;
			if (textBlock && textBlock.text) {
				output.write(textBlock.text + "\n");
			}
		}
	}

	return { sessionId, resumedMessageCount };
}

/** 解析 sessionId：--session 指定则用之；--resume 时用 resume id；否则生成 UUID。 */
function resolveSessionId(args: ParsedArgs): string {
	if (args.session) {
		return args.session;
	}
	if (args.resume) {
		return args.resume;
	}
	return randomUUID();
}

/**
 * 从已持久化 session 重建 messages。
 * 取 getPathToRoot(leafId)，调 rebuildMessages 重建（遇 CompactionEntry 注入 summary
 * user 消息并跳过被压缩的旧 messages —— issue #3）。若 leafId 为空（文件不存在或为空），
 * 抛错（--resume 必须命中已存在 session）。
 */
function resumeFromSession(
	session: ReturnType<typeof createJsonlSession>,
	expectedId: string,
): { messages: AgentMessage[] } {
	const leafId = session.getLeafId();
	if (!leafId) {
		throw new Error(
			`--resume ${expectedId}: no existing session found (file missing or empty)`,
		);
	}
	const entries = session.getPathToRoot(leafId);
	const messages = rebuildMessages(entries);
	return { messages };
}

/** process.stdout 适配 ReplOutput。 */
function stdoutOutput(): ReplOutput {
	return {
		write(s: string) {
			process.stdout.write(s);
		},
	};
}

/**
 * 最小 readline.Interface 接口（仅 question 方法）。bin 传 node:readline createInterface
 * 的返回值；测试可传 mock。question 以回调形式返回答案（node readline 语义）。
 */
export interface ReadlineLike {
	question(query: string, callback: (answer: string) => void): void;
}

/**
 * 构造 SafetyGuard.ask 处理器（T8 §4.6）。用 readline.Interface 的 question 提示用户
 * "Allow ${toolName}? (y/n) "，答案 trim 低压小写 === "y" 放行，其余阻断。
 *
 * @param rl readline.Interface（bin 入口 createInterface 返回值）。
 * @returns safetyAskHandler，传给 runReplMode 的 deps.safetyAskHandler。
 */
export function makeReadlineAskHandler(
	rl: ReadlineLike,
): (ctx: SafetyContext) => Promise<boolean> {
	return (ctx: SafetyContext): Promise<boolean> => {
		return new Promise<boolean>((resolve) => {
			rl.question(`Allow ${ctx.toolName}? (y/n) `, (answer: string) => {
				resolve(answer.trim().toLowerCase() === "y");
			});
		});
	};
}
