/**
 * cli RPC 模式。见 ARCHITECTURE.md §5 + docs/superpowers/specs/2026-06-23-slice3.5-rpc-design.md。
 *
 * JSONL over stdio（JSON-RPC 2.0）：stdin 读请求，stdout 写响应/事件。
 * runRpcMode 为可测函数（deps 注入），bin 入口 index.ts 调用。
 */
import { randomUUID } from "node:crypto";

import {
	AgentForgeHarness,
	createJsonlSession,
	createSantaVerifier,
	rebuildMessages,
} from "@agentforge/harness";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SantaVerifier, Rubric } from "@agentforge/harness";
import { serializeEvent } from "@agentforge/shared";
import { parseArgs, type ParsedArgs } from "./print-mode.js";
import {
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createGlobTool,
} from "./tools/index.js";
import { createSystemPromptWithSkills, defaultSkillDirs } from "./system-prompt.js";
import { defaultSessionDir, buildHarness } from "./repl.js";
import { createInstinctConfig } from "./instinct-config.js";

/** JSON-RPC 2.0 标准错误码。 */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export type RequestId = number | string;

export type ParsedRequest =
	| { ok: true; value: { id: RequestId; method: string; params: unknown } }
	| { ok: false; code: number; id: RequestId | null };

/** 解析一行 stdin 为 JSON-RPC 请求。JSON 非法 → PARSE_ERROR(id=null)；结构不全 → INVALID_REQUEST。 */
export function parseRequest(line: string): ParsedRequest {
	let obj: unknown;
	try {
		obj = JSON.parse(line);
	} catch {
		return { ok: false, code: PARSE_ERROR, id: null };
	}
	if (typeof obj !== "object" || obj === null) {
		return { ok: false, code: INVALID_REQUEST, id: null };
	}
	const o = obj as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
	if (typeof o.method !== "string") {
		return { ok: false, code: INVALID_REQUEST, id: null };
	}
	// spec §5.1：请求必须有 id（不支持客户端→服务端 notification）。
	// id 缺失或类型非法（非 number/string）→ INVALID_REQUEST，id=null（无 id 可回显）。
	if (typeof o.id !== "number" && typeof o.id !== "string") {
		return { ok: false, code: INVALID_REQUEST, id: null };
	}
	return { ok: true, value: { id: o.id, method: o.method, params: o.params ?? {} } };
}

export function makeResult(id: RequestId, result: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function makeError(id: RequestId | null, code: number, message: string): string {
	return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

export function makeNotification(method: string, params: unknown): string {
	return JSON.stringify({ jsonrpc: "2.0", method, params });
}

// === dispatch（Task 5）===

/**
 * 派发单个 JSON-RPC 请求到 harness。
 *
 * prompt 分支：onEvent 订阅 harness 事件 → serializeEvent → event notification；
 * harness.prompt（可选 promptTimeoutMs race 超时）→ result with messages。
 * 缺 input → INVALID_PARAMS。未知 method → METHOD_NOT_FOUND。
 *
 * 不抛错：所有错误以 makeError 写到 output（保证主循环继续）。
 */
async function dispatch(
	harness: AgentForgeHarness,
	req: { id: RequestId; method: string; params: unknown },
	output: { write(s: string): void },
	deps: RpcModeDeps,
): Promise<void> {
	if (req.method === "prompt") {
		const params = req.params as { input?: string };
		if (typeof params.input !== "string") {
			output.write(makeError(req.id, INVALID_PARAMS, "prompt requires params.input: string") + "\n");
			return;
		}
		const unsubscribe = harness.onEvent((e) => {
			// rpc adapter：丢逐 token message_update + tool_execution_end 不带 args（shared 默认 false）。
			// opts 显式传递以表明 rpc adapter 契约（与 web adapter 的 true 对齐对照）。
			const serialized = serializeEvent(e, { includeMessageUpdate: false, includeToolArgs: false });
			if (serialized) output.write(makeNotification("event", serialized) + "\n");
		});
		const ac = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			if (deps.promptTimeoutMs) {
				timer = setTimeout(() => ac.abort(), deps.promptTimeoutMs);
			}
			await harness.prompt(params.input, ac.signal);
			const messages = harness.agent.state.messages;
			output.write(makeResult(req.id, { messages }) + "\n");
		} catch (err) {
			const message = (ac.signal.aborted || (err instanceof Error && /timeout/i.test(err.message)))
				? "timeout"
				: (err instanceof Error ? err.message : String(err));
			output.write(makeError(req.id, INTERNAL_ERROR, message) + "\n");
		} finally {
			// A3：unsubscribe hoist 到 finally（单调用点，替代 success+catch 双调）。
			unsubscribe();
			if (timer) clearTimeout(timer);
		}
		return;
	}
	if (req.method === "verify") {
		const params = req.params as { output?: string; rubric?: { criteria?: string[] } };
		if (typeof params.output !== "string" || !params.rubric || !Array.isArray(params.rubric.criteria)) {
			output.write(makeError(req.id, INVALID_PARAMS, "verify requires params.output: string + params.rubric: {criteria: string[]}") + "\n");
			return;
		}
		// spec §7：verify hang 防护。harness.verify/verifier.review 无 signal 通道
		// （reviewer Agents 独立无状态，每次 review 新建），故用 Promise.race 软中止：
		// 超时 → emit -32603(timeout)，清 timer，继续下一请求（in-flight reviewer 后台
		// 跑完无害，下次 verify 新建 reviewer）。
		const ac = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (deps.promptTimeoutMs) {
			timer = setTimeout(() => ac.abort(), deps.promptTimeoutMs);
		}
		try {
			const verifyPromise = harness.verify(params.output, params.rubric as Rubric);
			const reviewResult = deps.promptTimeoutMs
				? await Promise.race([
					verifyPromise,
					new Promise<never>((_, reject) => {
						ac.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
					}),
				])
				: await verifyPromise;
			output.write(makeResult(req.id, reviewResult) + "\n");
		} catch (err) {
			const message = ac.signal.aborted
				? "timeout"
				: (err instanceof Error ? err.message : String(err));
			output.write(makeError(req.id, INTERNAL_ERROR, message) + "\n");
		} finally {
			if (timer) clearTimeout(timer);
		}
		return;
	}
	output.write(makeError(req.id, METHOD_NOT_FOUND, `method not found: ${req.method}`) + "\n");
}

// === runRpcMode（Task 4 骨架） ===

/** runRpcMode 的可注入输入源（测试 mock 或 stdin 适配）。 */
export interface RpcInput {
	/** 读下一行；返回 null 表示 EOF。异步以支持 readline 逐行桥接。 */
	read(): Promise<string | null>;
}

/** runRpcMode 的可注入输出汇（测试 mock 或 process.stdout 适配）。 */
export interface RpcOutput {
	/** 写一段文本（不含自动换行，调用方决定）。 */
	write(s: string): void;
}

/** runRpcMode 的可注入依赖（测试用）。 */
export interface RpcModeDeps {
	/** mock streamFn（测试注入，避免真实 LLM 请求）。 */
	streamFn?: any;
	/** getApiKey 回调。真对话从 process.env 读。 */
	getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;
	/** 注入输入源（测试用 mock）。bin 用 stdin 适配。 */
	input?: RpcInput;
	/** 注入输出汇（测试用 mock）。bin 用 process.stdout 适配。 */
	output?: RpcOutput;
	/** 覆盖 session 目录（测试用临时目录）。 */
	sessionDir?: string;
	/** 覆盖 skills 发现目录（默认 defaultSkillDirs()）。 */
	skillDirs?: string[];
	/**
	 * 可选注入整个 verifier（测试用 mock；默认 createSantaVerifier）。
	 * RPC 特有：repl 不含 verifier，rpc 默认注入。
	 */
	verifier?: SantaVerifier;
	/** 可选单请求超时（ms）。Task 8 实现。 */
	promptTimeoutMs?: number;
	/** 测试检视 hook：harness 构造后立即调用（断言 tools/verifier 等）。 */
	onHarnessCreated?: (h: AgentForgeHarness) => void;
}

/** runRpcMode 的返回值。 */
export interface RpcResult {
	/** 本次会话的 sessionId（--session 指定或自动生成；--resume 时为被恢复的 id）。 */
	sessionId: string;
}

/** 解析 sessionId：--session 指定则用之；--resume 时用 resume id；否则生成 UUID。 */
function resolveSessionId(args: ParsedArgs): string {
	if (args.session) return args.session;
	if (args.resume) return args.resume;
	return randomUUID();
}

/**
 * 驱动 RPC 模式（JSONL over stdio, JSON-RPC 2.0）。
 *
 * Task 4 骨架：构造 harness（复用 repl 共享材料：6 tools / systemPrompt / safety /
 * JSONL session / --resume initialMessages）+ RPC 特有 verifier 注入，emit ready
 * notification，然后循环读 stdin 直到 EOF。派发逻辑 Task 5 加。
 *
 * @param argv cli argv（不含 node 二进制与脚本路径）。
 * @param deps 可选注入（streamFn mock / getApiKey / input / output / sessionDir / verifier）。
 * @returns sessionId。
 */
export async function runRpcMode(
	argv: string[],
	deps: RpcModeDeps = {},
): Promise<RpcResult> {
	const args = parseArgs(argv);
	const sessionDir = deps.sessionDir ?? args.sessionDir ?? defaultSessionDir();
	const sessionId = resolveSessionId(args);
	const sessionPath = `${sessionDir}/${sessionId}.jsonl`;
	const session = createJsonlSession(sessionPath);

	// --resume：从已持久化 session 重建 messages 喂给 Agent initialState。
	let initialMessages: AgentMessage[] = [];
	if (args.resume) {
		const leafId = session.getLeafId();
		if (!leafId) {
			throw new Error(
				`--resume ${args.resume}: no existing session found (file missing or empty)`,
			);
		}
		initialMessages = rebuildMessages(session.getPathToRoot(leafId));
	}

	// RPC 特有：verifier 注入（repl 不含）。deps.verifier 优先（测试 mock）。
	const verifier =
		deps.verifier ??
		createSantaVerifier({
			provider: args.provider,
			model: args.model,
			getApiKey: deps.getApiKey as
				| ((provider: string) => string | Promise<string | undefined>)
				| undefined,
			streamFn: deps.streamFn,
		});

	// Slice 4-B T9：rpc 注入 instinct（observe/apply active；extract DEFERRED——
	// rpc 无明确 session end，不触发 extract）。
	const instinctCfg = createInstinctConfig({
		provider: args.provider,
		model: args.model,
		getApiKey: deps.getApiKey ?? (() => undefined),
	});
	const harness = buildHarness({
		args,
		session,
		initialMessages,
		streamFn: deps.streamFn,
		getApiKey: deps.getApiKey,
		skillDirs: deps.skillDirs,
		verifier,
		instinct: instinctCfg.instinct,
	});
	deps.onHarnessCreated?.(harness);

	const output = deps.output ?? {
		write: (s: string) => {
			process.stdout.write(s);
		},
	};
	const input = deps.input;

	// strict gate：ready 前不读 stdin。
	output.write(makeNotification("ready", { sessionId }) + "\n");

	if (input) {
		while (true) {
			const line = await input.read();
			if (line === null) break;
			const trimmed = line.trim();
			if (trimmed === "") continue;
			const parsed = parseRequest(trimmed);
			if (!parsed.ok) {
				output.write(makeError(parsed.id, parsed.code, parsed.code === PARSE_ERROR ? "parse error" : "invalid request") + "\n");
				continue;
			}
			await dispatch(harness, parsed.value, output, deps);
		}
	}

	return { sessionId };
}
