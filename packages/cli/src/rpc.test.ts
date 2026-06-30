import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";

// 探针：确认 rpc 模块存在（RED 阶段 ./rpc.js 不存在 → 导入失败）。
import "./rpc.js";
import { parseRequest, makeResult, makeError, makeNotification,
	PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR } from "./rpc.js";
import { runRpcMode } from "./rpc.js";
import { parseArgs } from "./print-mode.js";
import type { AgentForgeHarness, SantaVerifier } from "@agentforge/harness";

function makeAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions" as any,
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: {
			input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("rpc — AgentMessage serialization round-trip", () => {
	it("AssistantMessage survives JSON.stringify → parse with no field loss", () => {
		const msg: AssistantMessage = makeAssistantMessage("hello world");
		const parsed = JSON.parse(JSON.stringify(msg)) as AssistantMessage;
		expect(parsed).toEqual(msg);
		expect(parsed.role).toBe("assistant");
		expect(parsed.content[0]).toMatchObject({ type: "text", text: "hello world" });
		expect(parsed.stopReason).toBe("stop");
		expect(parsed.usage.totalTokens).toBe(2);
	});

	it("AssistantMessage with toolCall block survives round-trip", () => {
		const msg = {
			...makeAssistantMessage("thinking"),
			content: [
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/x" } },
			],
		} as AssistantMessage;
		const parsed = JSON.parse(JSON.stringify(msg)) as AssistantMessage;
		expect(parsed).toEqual(msg);
		expect(parsed.content[1]).toMatchObject({ type: "toolCall", name: "read" });
	});
});

describe("rpc — serializeEvent (shared, migrated to Task 1)", () => {
	// serializeEvent 白名单单测已迁移至 packages/shared/src/serialize-event.test.ts（Task 1）。
	// rpc.ts 不再本地实现 serializeEvent，改为 value import @agentforge/shared（Task 6）。
	// dispatch 集成测试（下方 prompt method）覆盖 rpc 转发路径，足以回归。
	it.todo("serializeEvent whitelist unit tests live in @agentforge/shared");
});

describe("rpc — JSON-RPC protocol helpers", () => {
	it("parseRequest parses a valid prompt request", () => {
		const line = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { input: "hi" } });
		const req = parseRequest(line);
		expect(req.ok).toBe(true);
		if (req.ok) {
			expect(req.value.method).toBe("prompt");
			expect(req.value.id).toBe(1);
			expect(req.value.params).toEqual({ input: "hi" });
		}
	});

	it("parseRequest returns PARSE_ERROR for invalid JSON", () => {
		const req = parseRequest("{not json");
		expect(req.ok).toBe(false);
		if (!req.ok) expect(req.code).toBe(PARSE_ERROR);
	});

	it("parseRequest returns INVALID_REQUEST for missing method", () => {
		const req = parseRequest(JSON.stringify({ jsonrpc: "2.0", id: 1 }));
		expect(req.ok).toBe(false);
		if (!req.ok) expect(req.code).toBe(INVALID_REQUEST);
	});

	it("makeResult builds a JSON-RPC success response", () => {
		expect(JSON.parse(makeResult(1, { messages: [] }))).toEqual({
			jsonrpc: "2.0", id: 1, result: { messages: [] },
		});
	});

	it("makeError builds a JSON-RPC error response with null id for parse errors", () => {
		const out = JSON.parse(makeError(null, PARSE_ERROR, "bad json"));
		expect(out.id).toBeNull();
		expect(out.error.code).toBe(PARSE_ERROR);
		expect(out.error.message).toBe("bad json");
	});

	it("makeNotification builds a notification (no id)", () => {
		expect(JSON.parse(makeNotification("event", { type: "agent_start" }))).toEqual({
			jsonrpc: "2.0", method: "event", params: { type: "agent_start" },
		});
	});
});

// === Task 4: runRpcMode skeleton ===

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), `agentforge-rpc-${randomUUID()}`));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** 可注入的输入源：按行弹出，模拟 stdin。EOF 返回 null。 */
function makeMockInput(lines: string[]) {
	const queue = [...lines];
	return {
		read: async (): Promise<string | null> =>
			queue.length === 0 ? null : (queue.shift() as string),
	};
}

function makeMockOutput() {
	const lines: string[] = [];
	return { write: (s: string) => lines.push(s), lines: () => lines };
}

/**
 * mock streamFn。pi streamFn 真实签名是 (model, llmContext, options)，
 * 故 mock 也带这三参（虽不使用，以匹配签名）。读 llmContext.messages 可观察对话。
 */
function makeMockStreamFnLocal(reply: string | ((turn: number) => string)) {
	let turn = 0;
	return (_model: unknown, _llmContext: unknown, _options: unknown) => {
		const text = typeof reply === "string" ? reply : reply(turn);
		turn += 1;
		const stream = new AssistantMessageEventStream();
		const message = makeAssistantMessage(text);
		const startEvent: AssistantMessageEvent = {
			type: "start",
			partial: message,
		};
		const doneEvent: AssistantMessageEvent = {
			type: "done",
			reason: "stop",
			message,
		};
		queueMicrotask(() => {
			stream.push(startEvent);
			stream.push(doneEvent);
		});
		return stream;
	};
}

describe("rpc — runRpcMode skeleton", () => {
	it("emits ready notification with sessionId before reading stdin", async () => {
		const output = makeMockOutput();
		const { sessionId } = await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("x"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([]), output,
		});
		const firstLine = JSON.parse(output.lines()[0]);
		expect(firstLine.method).toBe("ready");
		expect(firstLine.params.sessionId).toBe(sessionId);
	});

	it("exits cleanly on EOF (no requests, no hang)", async () => {
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("x"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([]), output,
		});
		expect(output.lines().length).toBe(1); // only ready
	});

	it("constructs harness with verifier injected (RPC-specific)", async () => {
		let seen: AgentForgeHarness | null = null;
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("x"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([]), output: makeMockOutput(),
			onHarnessCreated: (h) => { seen = h; },
		});
		const h = seen as AgentForgeHarness;
		expect(h.verifier).toBeDefined();
		expect(h.agent.state.tools.map((t: any) => t.name).sort()).toEqual(
			["bash", "edit", "glob", "grep", "read", "write"],
		);
	});

	it("returns sessionId (uuid by default)", async () => {
		const { sessionId } = await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("x"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([]), output: makeMockOutput(),
		});
		expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
	});
});

describe("rpc — prompt method", () => {
	it("prompt request → event notifications + result with messages", async () => {
		const req = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { input: "hello" } });
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("reply-text"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req]), output,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		const result = lines.find((l) => l.id === 1 && l.result);
		expect(result).toBeDefined();
		expect(result.result.messages).toBeInstanceOf(Array);
		expect(result.result.messages.length).toBeGreaterThan(0);
		expect(JSON.stringify(result.result.messages.at(-1))).toContain("reply-text");
	});

	it("prompt with missing input → INVALID_PARAMS, continues to next request", async () => {
		const req1 = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: {} });
		const req2 = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompt", params: { input: "ok" } });
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("r"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req1, req2]), output,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		expect(lines.find((l) => l.id === 1).error.code).toBe(INVALID_PARAMS);
		expect(lines.find((l) => l.id === 2 && l.result)).toBeDefined();
	});
});

describe("rpc — verify method", () => {
	it("verify request → result ReviewResult via injected mock verifier (no events)", async () => {
		const mockVerifier = {
			review: async () => ({
				verdict: "nice" as const, issues: [],
				reviews: [{ verdict: "nice" as const, issues: [] }, { verdict: "nice" as const, issues: [] }],
			}),
			verifyUntilNice: async () => { throw new Error("not used"); },
		};
		const req = JSON.stringify({
			jsonrpc: "2.0", id: 1, method: "verify",
			params: { output: "some code", rubric: { criteria: ["works"] } },
		});
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("x"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req]), output,
			verifier: mockVerifier as unknown as SantaVerifier,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		const result = lines.find((l) => l.id === 1 && l.result);
		expect(result.result).toMatchObject({ verdict: "nice", issues: [] });
		expect(lines.filter((l) => l.method === "event").length).toBe(0); // no mid events
	});

	it("verify with missing output → INVALID_PARAMS", async () => {
		const req = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "verify", params: { rubric: { criteria: ["x"] } } });
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("x"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req]), output,
			verifier: { review: async () => ({ verdict: "nice", issues: [], reviews: [] }) } as unknown as SantaVerifier,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		expect(lines.find((l) => l.id === 1).error.code).toBe(INVALID_PARAMS);
	});
});

describe("rpc — prompt timeout", () => {
	it("promptTimeoutMs → hung prompt emits -32603(timeout); next request observed (reentrancy)", async () => {
		// 调用计数：1st call（req1 hang）返回永不 push 的 stream → for await 永久挂起；
		// 2nd call（req2）返回正常完成 stream。brief 单 hangStreamFn 双用会导致 req2 同样
		// 挂起（内部矛盾），此处按计数分发修正（同 Task 1 的 brief-internal 一致性修复）。
		const normal = makeMockStreamFnLocal("ok-reply");
		let callCount = 0;
		const hangOrNormal = (_model: unknown, _llmContext: unknown, options: { signal?: AbortSignal } = {}) => {
			callCount += 1;
			if (callCount === 1) {
				// 模拟真实 provider：永不主动 push，但 honor options.signal——
				// abort 时 push 一个 error event（stopReason "aborted"）让 agent loop
				// 的 for await 退出、runWithLifecycle finally → finishRun 释放 activeRun。
				// 空 stream + 无 signal 监听会永久挂起（event-stream.js asyncIterator）。
				const stream = new AssistantMessageEventStream();
				const abortedMessage: AssistantMessage = {
					...makeAssistantMessage(""),
					stopReason: "aborted",
					errorMessage: "aborted",
				};
				options.signal?.addEventListener("abort", () => {
					stream.push({ type: "error", reason: "aborted", error: abortedMessage });
				});
				return stream;
			}
			return normal(_model, _llmContext, options);
		};
		const req1 = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { input: "hang" } });
		const req2 = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompt", params: { input: "ok" } });
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: hangOrNormal, getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req1, req2]), output,
			promptTimeoutMs: 50,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		const err1 = lines.find((l) => l.id === 1 && l.error);
		expect(err1).toBeDefined();
		expect(err1.error.code).toBe(INTERNAL_ERROR);
		expect(err1.error.message).toMatch(/timeout/i);
		// req2 必须成功：harness.prompt 现在接 signal，超时触发 agent.abort()，
		// 真中止释放 pi Agent 的 activeRun（runWithLifecycle finally → finishRun）。
		// hangOrNormal 的 hang stream 必须 honor options.signal（push error event
		// 让 agent loop 退出）；否则 stream 永久挂起、finishRun 永不跑。
		const resp2 = lines.find((l) => l.id === 2);
		expect(resp2).toBeDefined();
		expect(resp2.result).toBeDefined();
		expect(resp2.error).toBeUndefined();
	}, 10000);
});

describe("rpc — error codes", () => {
	it("unknown method → METHOD_NOT_FOUND, continues", async () => {
		const req1 = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "frobnicate", params: {} });
		const req2 = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompt", params: { input: "ok" } });
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("r"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req1, req2]), output,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		expect(lines.find((l) => l.id === 1).error.code).toBe(METHOD_NOT_FOUND);
		expect(lines.find((l) => l.id === 2).result).toBeDefined();
	});

	it("parse error → -32700 with null id, continues", async () => {
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("r"), getApiKey: () => "fake-key",
			sessionDir: dir,
			input: makeMockInput(["{not json", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "prompt", params: { input: "ok" } })]),
			output,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		expect(lines.find((l) => l.error && l.id === null).error.code).toBe(PARSE_ERROR);
		expect(lines.find((l) => l.id === 2).result).toBeDefined();
	});

	it("internal error when harness.verify throws → -32603", async () => {
		const req = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "verify", params: { output: "x", rubric: { criteria: ["c"] } } });
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("x"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req]), output,
			verifier: { review: async () => { throw new Error("reviewer boom"); }, verifyUntilNice: async () => { throw new Error("x"); } } as unknown as SantaVerifier,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		const err = lines.find((l) => l.id === 1).error;
		expect(err.code).toBe(INTERNAL_ERROR);
		expect(err.message).toContain("reviewer boom");
	});
});

// === Slice 3.5 修复：spec §5.1 / §7 must-fix ===

describe("rpc — parseRequest rejects id-less request (spec §5.1)", () => {
	it("id-less prompt request → INVALID_REQUEST (no client→server notifications)", () => {
		const line = JSON.stringify({ jsonrpc: "2.0", method: "prompt", params: { input: "hi" } });
		const req = parseRequest(line);
		expect(req.ok).toBe(false);
		if (!req.ok) {
			expect(req.code).toBe(INVALID_REQUEST);
			expect(req.id).toBeNull();
		}
	});

	it("id of wrong type (boolean) → INVALID_REQUEST", () => {
		const line = JSON.stringify({ jsonrpc: "2.0", id: true, method: "prompt", params: { input: "hi" } });
		const req = parseRequest(line);
		expect(req.ok).toBe(false);
		if (!req.ok) expect(req.code).toBe(INVALID_REQUEST);
	});
});

describe("rpc — verify hang protection (spec §7)", () => {
	it("promptTimeoutMs → hung verifier emits -32603(timeout); req2 not blocked", async () => {
		// 永不 resolve 的 mock verifier（模拟 reviewer LLM stall）。
		const hungVerifier = {
			review: () => new Promise(() => {}),
			verifyUntilNice: async () => { throw new Error("not used"); },
		};
		// req1 用 hung verifier；req2 用立即 resolve 的 verifier。两请求分两次 runRpcMode
		// 会各自构造 harness，无法在单次 runRpcMode 内换 verifier——故单次 run 内 hung
		// verifier 同时服务 req1 与 req2：req1 超时软中止后 req2 也会超时（同一 hung
		// verifier）。验证 req1 timeout + req2 也得到响应（不是被 req1 阻塞 hang）。
		const req1 = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "verify", params: { output: "a", rubric: { criteria: ["c"] } } });
		const req2 = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "verify", params: { output: "b", rubric: { criteria: ["c"] } } });
		const output = makeMockOutput();
		await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("x"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req1, req2]), output,
			verifier: hungVerifier as unknown as SantaVerifier,
			promptTimeoutMs: 50,
		});
		const lines = output.lines().map((l) => JSON.parse(l));
		const err1 = lines.find((l) => l.id === 1 && l.error);
		expect(err1).toBeDefined();
		expect(err1.error.code).toBe(INTERNAL_ERROR);
		expect(err1.error.message).toMatch(/timeout/i);
		// req2 必须得到响应（自身也是 timeout error，但关键是不被 req1 hang 阻塞——
		// 修复前 req1 永不 resolve，runRpcMode 读循环永远停在 await harness.verify，req2 无响应）。
		const resp2 = lines.find((l) => l.id === 2);
		expect(resp2).toBeDefined();
	}, 10000);
});

describe("rpc — JSONL persistence + --resume", () => {
	it("prompt persists user+assistant entries to session jsonl", async () => {
		const req = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { input: "hello" } });
		const { sessionId } = await runRpcMode([], {
			streamFn: makeMockStreamFnLocal("reply"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([req]), output: makeMockOutput(),
		});
		const file = join(dir, `${sessionId}.jsonl`);
		expect(existsSync(file)).toBe(true);
		const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length);
		expect(lines.length).toBe(2); // 1 user + 1 assistant
		// A7：解析每行 JSON 断言 role（不只断言行数），防落盘角色错乱回归。
		const entries = lines.map((l) => JSON.parse(l));
		expect(entries[0].type).toBe("message");
		expect(entries[0].message.role).toBe("user");
		expect(entries[1].type).toBe("message");
		expect(entries[1].message.role).toBe("assistant");
	});

	it("--resume loads existing session as initial messages", async () => {
		const seedId = "seed-rpc";
		const seedReq = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { input: "seed-q" } });
		await runRpcMode(["--session", seedId], {
			streamFn: makeMockStreamFnLocal("seed-a"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([seedReq]), output: makeMockOutput(),
		});
		expect(existsSync(join(dir, `${seedId}.jsonl`))).toBe(true);

		const followReq = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompt", params: { input: "follow-up" } });
		const output = makeMockOutput();
		const { sessionId } = await runRpcMode(["--resume", seedId], {
			streamFn: makeMockStreamFnLocal("follow-a"), getApiKey: () => "fake-key",
			sessionDir: dir, input: makeMockInput([followReq]), output,
		});
		expect(sessionId).toBe(seedId);
		const result = output.lines().map((l) => JSON.parse(l)).find((l) => l.id === 1 && l.result);
		expect(result.result.messages.length).toBe(4); // seed(2) + follow user+assistant
	});

	it("--resume throws clear error when session file missing", async () => {
		await expect(
			runRpcMode(["--resume", "nonexistent-rpc"], {
				streamFn: makeMockStreamFnLocal("x"),
				getApiKey: () => "fake-key",
				sessionDir: dir,
				input: makeMockInput([]),
				output: makeMockOutput(),
			}),
		).rejects.toThrow(/nonexistent-rpc|resume|session/i);
	});
});

describe("rpc — parseArgs --rpc flag", () => {
	it("parseArgs recognizes --rpc", () => {
		expect(parseArgs(["--rpc"]).rpc).toBe(true);
	});
	it("parseArgs defaults rpc to false", () => {
		expect(parseArgs([]).rpc).toBe(false);
	});
});
