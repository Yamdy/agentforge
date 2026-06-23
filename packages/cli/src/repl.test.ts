import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	readFileSync,
	existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";

import { runReplMode, makeReadlineBridge } from "./repl.js";
import { runPrintMode } from "./print-mode.js";
import { serializeEntry } from "@agentforge/shared";
import type { AgentForgeHarness } from "@agentforge/harness";

/** 构造一个合法的最小 AssistantMessage（stopReason "stop"，无 toolCall）。 */
function makeAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions" as any,
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** mock streamFn：每行 text 一一对应回复。若只传单个 text 则每轮回复同一句。 */
function makeMockStreamFn(reply: string | ((turn: number) => string)) {
	let turn = 0;
	return () => {
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

/** 一个可注入的输入源：按行弹出，模拟 readline。遇 "exit" 退出。T7: read() 异步。 */
function makeMockInput(lines: string[]) {
	const queue = [...lines];
	return {
		read: async (): Promise<string | null> =>
			queue.length === 0 ? null : (queue.shift() as string),
		/** readline.Interface 兼容：question/close/emit/on 不需要——deps 直接用 read() */
	};
}

function makeMockOutput() {
	const lines: string[] = [];
	return {
		write: (s: string) => {
			lines.push(s);
		},
		lines: () => lines,
	};
}

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), `agentforge-repl-${randomUUID()}`));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("cli REPL mode — runReplMode", () => {
	it("drives harness.prompt per input line and prints assistant replies, then exits on 'exit'", async () => {
		const input = makeMockInput(["hello", "exit"]);
		const output = makeMockOutput();
		const streamFn = makeMockStreamFn((turn) =>
			turn === 0 ? "reply-to-hello" : "reply-to-other",
		);

		const { sessionId } = await runReplMode([], {
			streamFn,
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});

		// "hello" drives one prompt; "exit" terminates before a second prompt.
		const all = output.lines().join("\n");
		expect(all).toContain("reply-to-hello");
		// sessionId printed at start
		expect(all).toContain(sessionId);
		// session jsonl file created
		expect(existsSync(join(dir, `${sessionId}.jsonl`))).toBe(true);
	});

	it("terminates on EOF (no 'exit' line) after processing queued inputs", async () => {
		const input = makeMockInput(["q1", "q2"]);
		const output = makeMockOutput();
		const streamFn = makeMockStreamFn("ok");

		await runReplMode([], {
			streamFn,
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});

		// Both lines drive a prompt each → 2 replies ("ok\n" each)
		const replies = output.lines().filter((l) => l.includes("ok") && l.includes("\n") && !l.startsWith("agentforge"));
		expect(replies.length).toBe(2);
	});

	it("generates a unique sessionId when --session not given", async () => {
		// drive one prompt so the JSONL file is actually created via appendEntry
		const input = makeMockInput(["hi", "exit"]);
		const output = makeMockOutput();
		const { sessionId } = await runReplMode([], {
			streamFn: makeMockStreamFn("x"),
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});
		expect(typeof sessionId).toBe("string");
		expect(sessionId.length).toBeGreaterThan(0);
		// UUID format: 36 chars with dashes
		expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		expect(existsSync(join(dir, `${sessionId}.jsonl`))).toBe(true);
	});

	it("uses --session <id> when provided", async () => {
		const input = makeMockInput(["hi", "exit"]);
		const output = makeMockOutput();
		const { sessionId } = await runReplMode(["--session", "my-fixed-id"], {
			streamFn: makeMockStreamFn("x"),
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});
		expect(sessionId).toBe("my-fixed-id");
		expect(existsSync(join(dir, "my-fixed-id.jsonl"))).toBe(true);
	});

	it("drives harness.prompt per line with async read() (T7 line-by-line)", async () => {
		// T7: read() is async. input returns "hello"/"world"/null → 2 prompts.
		const queue = ["hello", "world"];
		const input = {
			read: async (): Promise<string | null> =>
				queue.length === 0 ? null : (queue.shift() as string),
		};
		const output = makeMockOutput();
		let promptCount = 0;
		const streamFn = makeMockStreamFn("reply");
		// wrap streamFn to count prompts by tracking harness via output writes:
		// each prompt writes a "reply\n" line.
		const result = await runReplMode([], {
			streamFn,
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});
		// Two non-empty lines → two prompts → two "reply\n" outputs.
		const replyLines = output.lines().filter((l) => l === "reply\n");
		expect(replyLines.length).toBe(2);
		expect(result.sessionId).toBeTruthy();
		// promptCount inferred from reply writes
		void promptCount;
	});

	it("counts prompts via streamFn calls (T7: 2 non-empty lines → 2 prompts)", async () => {
		const queue = ["hello", "world"];
		const input = {
			read: async (): Promise<string | null> =>
				queue.length === 0 ? null : (queue.shift() as string),
		};
		const output = makeMockOutput();
		let streamFnCalls = 0;
		const streamFn = () => {
			streamFnCalls += 1;
			return makeMockStreamFn("reply")();
		};
		await runReplMode([], {
			streamFn,
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});
		expect(streamFnCalls).toBe(2);
	});

	it("EOF (read returns null) exits loop without prompting (T7)", async () => {
		const input = { read: async (): Promise<string | null> => null };
		const output = makeMockOutput();
		let streamFnCalls = 0;
		const streamFn = () => {
			streamFnCalls += 1;
			return makeMockStreamFn("reply")();
		};
		await runReplMode([], {
			streamFn,
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});
		expect(streamFnCalls).toBe(0);
	});

	it("'exit' command exits loop after prior prompts (T7)", async () => {
		const queue = ["hello", "exit", "should-not-run"];
		const input = {
			read: async (): Promise<string | null> =>
				queue.length === 0 ? null : (queue.shift() as string),
		};
		const output = makeMockOutput();
		let streamFnCalls = 0;
		const streamFn = () => {
			streamFnCalls += 1;
			return makeMockStreamFn("reply")();
		};
		await runReplMode([], {
			streamFn,
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});
		// "hello" prompts once; "exit" breaks; "should-not-run" never read.
		expect(streamFnCalls).toBe(1);
	});

	it("blank line (trim empty) continues without prompting (T7)", async () => {
		const queue = ["", "   ", "hello", ""];
		const input = {
			read: async (): Promise<string | null> =>
				queue.length === 0 ? null : (queue.shift() as string),
		};
		const output = makeMockOutput();
		let streamFnCalls = 0;
		const streamFn = () => {
			streamFnCalls += 1;
			return makeMockStreamFn("reply")();
		};
		await runReplMode([], {
			streamFn,
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});
		// Only "hello" is non-blank → 1 prompt. Blank lines skipped via continue.
		expect(streamFnCalls).toBe(1);
	});

	it("persists each turn to the JSONL session file synchronously", async () => {
		const input = makeMockInput(["first", "second", "exit"]);
		const output = makeMockOutput();
		const { sessionId } = await runReplMode([], {
			streamFn: makeMockStreamFn("reply"),
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
		});
		const file = join(dir, `${sessionId}.jsonl`);
		const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length);
		// 2 user + 2 assistant messages appended = 4 entries
		expect(lines.length).toBe(4);
	});
});

describe("cli REPL mode --resume", () => {
	it("loads an existing JSONL session and continues with history as initial messages", async () => {
		// 1. Run a print-mode round to write a JSONL session file.
		//    Use runPrintMode with a sessionDir + --session to fix the id.
		//    BUT print-mode uses createMemorySession, not JSONL. So write the
		//    JSONL by hand via a REPL round instead.
		const seedSessionId = "seed-session";
		const seedInput = makeMockInput(["seed-question", "exit"]);
		const seedOutput = makeMockOutput();
		await runReplMode(["--session", seedSessionId], {
			streamFn: makeMockStreamFn("seed-reply"),
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input: seedInput,
			output: seedOutput,
		});

		const seedFile = join(dir, `${seedSessionId}.jsonl`);
		expect(existsSync(seedFile)).toBe(true);
		// seed round = 1 user + 1 assistant = 2 entries
		const seedLines = readFileSync(seedFile, "utf8")
			.split("\n")
			.filter((l) => l.length);
		expect(seedLines.length).toBe(2);

		// 2. Resume: a fresh REPL run with --resume <seedSessionId>.
		const resumeInput = makeMockInput(["follow-up", "exit"]);
		const resumeOutput = makeMockOutput();
		const { sessionId, resumedMessageCount } = await runReplMode(
			["--resume", seedSessionId],
			{
				streamFn: makeMockStreamFn("resume-reply"),
				getApiKey: () => "fake-key",
				sessionDir: dir,
				input: resumeInput,
				output: resumeOutput,
			},
		);

		// resume reuses the same session id (continues the file)
		expect(sessionId).toBe(seedSessionId);
		// history (2 seed messages) fed as initialState.messages
		expect(resumedMessageCount).toBe(2);

		// The resumed file now has seed (2) + follow-up round (2) = 4 entries
		const resumedLines = readFileSync(seedFile, "utf8")
			.split("\n")
			.filter((l) => l.length);
		expect(resumedLines.length).toBe(4);

		// resume-reply printed
		expect(resumeOutput.lines().join("\n")).toContain("resume-reply");
	});

	it("throws a clear error when --resume <id> has no matching session file", async () => {
		const input = makeMockInput(["exit"]);
		const output = makeMockOutput();
		await expect(
			runReplMode(["--resume", "nonexistent-id"], {
				streamFn: makeMockStreamFn("x"),
				getApiKey: () => "fake-key",
				sessionDir: dir,
				input,
				output,
			}),
		).rejects.toThrow(/nonexistent-id|resume|session/i);
	});

	it("--resume injects compaction summary and skips compacted messages (issue #3 e2e)", async () => {
		const sessionId = "compacted-session";
		const file = join(dir, `${sessionId}.jsonl`);

		// 手写含 CompactionEntry 的 jsonl:
		// 路径 [old-q, old-a, CompactionEntry(summary, firstKeptEntryId=kept-q), kept-q, kept-a]
		// parentId 链:old-q(null) → old-a → compaction → kept-q → kept-a(leaf)。
		const oldQId = "e-old-q";
		const oldAId = "e-old-a";
		const compId = "e-comp";
		const keptQId = "e-kept-q";
		const keptAId = "e-kept-a";
		const ts = 1000;
		const lines = [
			serializeEntry({ type: "message", entryId: oldQId, parentId: null, timestamp: ts, message: { role: "user", content: "old question", timestamp: ts } } as any),
			serializeEntry({ type: "message", entryId: oldAId, parentId: oldQId, timestamp: ts, message: { role: "assistant", content: "old answer", timestamp: ts } } as any),
			serializeEntry({ type: "compaction", entryId: compId, parentId: oldAId, timestamp: ts, summary: "SUMMARY OF OLD", firstKeptEntryId: keptQId } as any),
			serializeEntry({ type: "message", entryId: keptQId, parentId: compId, timestamp: ts, message: { role: "user", content: "kept question", timestamp: ts } } as any),
			serializeEntry({ type: "message", entryId: keptAId, parentId: keptQId, timestamp: ts, message: { role: "assistant", content: "kept answer", timestamp: ts } } as any),
		];
		writeFileSync(file, lines.join("\n") + "\n", "utf8");

		const input = makeMockInput(["follow-up", "exit"]);
		const output = makeMockOutput();
		const { sessionId: resumedId, resumedMessageCount } = await runReplMode(
			["--resume", sessionId],
			{
				streamFn: makeMockStreamFn("resume-reply"),
				getApiKey: () => "fake-key",
				sessionDir: dir,
				input,
				output,
			},
		);

		expect(resumedId).toBe(sessionId);
		// rebuildMessages 注入 summary + 保留 kept-q/kept-a = 3 条;旧 old-q/old-a 被压缩跳过。
		// 若 wiring 未调 rebuildMessages(MessageEntry-only),会是 4 条 → 测试红。
		expect(resumedMessageCount).toBe(3);
	});
});

describe("cli REPL mode — T8 Safety + 6 tools + askHandler wiring", () => {
	it("constructs harness with 6 tools + safety guard + askHandler injected", async () => {
		const input = makeMockInput(["exit"]);
		const output = makeMockOutput();
		let seenHarness: AgentForgeHarness | null = null;

		await runReplMode([], {
			streamFn: makeMockStreamFn("reply"),
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
			safetyAskHandler: async () => true,
			onHarnessCreated: (h: AgentForgeHarness) => {
				seenHarness = h;
			},
		});

		expect(seenHarness).not.toBeNull();
		const h = seenHarness as AgentForgeHarness;
		// 6 tools via public agent.state.tools: read, bash, edit, write, grep, glob
		const toolNames = h.agent.state.tools.map((t: any) => t.name).sort();
		expect(toolNames).toEqual(["bash", "edit", "glob", "grep", "read", "write"]);
		// safety present: applySafety on a deny pattern ("rm -rf") returns block.
		const denyResult = await h.applySafety({
			toolName: "bash",
			args: { command: "rm -rf /tmp/x" },
		});
		expect(denyResult).toEqual({ block: true, reason: "safety:deny" });
		// askHandler wired: applySafety on an ask pattern ("git push") calls handler → allow.
		const askResult = await h.applySafety({
			toolName: "bash",
			args: { command: "git push origin main" },
		});
		expect(askResult).toBeUndefined();
	});

	it("defaults safetyAskHandler to undefined when not injected (bin supplies real one)", async () => {
		const input = makeMockInput(["exit"]);
		const output = makeMockOutput();
		let seenHarness: AgentForgeHarness | null = null;

		await runReplMode([], {
			streamFn: makeMockStreamFn("reply"),
			getApiKey: () => "fake-key",
			sessionDir: dir,
			input,
			output,
			onHarnessCreated: (h: AgentForgeHarness) => {
				seenHarness = h;
			},
		});

		const h = seenHarness as AgentForgeHarness;
		// safety present (deny pattern blocked)
		const denyResult = await h.applySafety({
			toolName: "bash",
			args: { command: "rm -rf /tmp/x" },
		});
		expect(denyResult).toEqual({ block: true, reason: "safety:deny" });
		// no askHandler → ask degrades to deny (reason "safety:ask-no-handler")
		const askResult = await h.applySafety({
			toolName: "bash",
			args: { command: "git push origin main" },
		});
		expect(askResult).toEqual({ block: true, reason: "safety:ask-no-handler" });
	});
});

describe("makeReadlineBridge", () => {
	it("read returns pushed lines in FIFO order", async () => {
		const b = makeReadlineBridge();
		b.push("a");
		b.push("b");
		expect(await b.read()).toBe("a");
		expect(await b.read()).toBe("b");
	});

	it("read awaits until a line is pushed (no line buffered)", async () => {
		const b = makeReadlineBridge();
		const pending = b.read();
		b.push("x");
		expect(await pending).toBe("x");
	});

	it("read returns null on EOF (push null)", async () => {
		const b = makeReadlineBridge();
		b.push(null);
		expect(await b.read()).toBeNull();
	});
});

