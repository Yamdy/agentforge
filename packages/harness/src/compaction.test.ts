import { describe, it, expect } from "vitest";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	AgentMessage,
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-agent-core";

import { AgentForgeHarness } from "./harness.js";
import { createEventBus } from "./events.js";
import { createMemorySession } from "./session.js";
import { createCompactor, estimateTokens } from "./compaction.js";
import type { CompactionContext } from "./compaction.js";

/** 构造一个合法的最小 UserMessage。 */
function makeUserMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

/** 构造一个合法的最小 AssistantMessage（无 toolCall）。 */
function makeAssistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic" as any,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
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
	} as any;
}

/** 构造一个 AssistantMessage 携带一个 toolCall 块。 */
function makeAssistantWithToolCall(
	toolName: string,
	args: Record<string, any>,
): AgentMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text: "calling tool" },
			{ type: "toolCall", id: `call-${toolName}`, name: toolName, arguments: args },
		],
		api: "anthropic" as any,
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	} as any;
}

/** 构造一个 ToolResultMessage。 */
function makeToolResultMessage(toolCallId: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: Date.now(),
	} as any;
}

/** mock streamFn：产出 start + done 事件。 */
function makeMockStreamFn(text: string) {
	return () => {
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

/** 构造一组 messages + 并行 entryIds。 */
function buildContext(
	messages: AgentMessage[],
	opts: {
		tokenThreshold: number;
		isAtStageBoundary?: () => boolean;
		signal?: AbortSignal;
	},
): CompactionContext {
	const entryIds = messages.map((_, i) => `entry-${i}`);
	return {
		messages,
		entryIds,
		tokenThreshold: opts.tokenThreshold,
		isAtStageBoundary: opts.isAtStageBoundary ?? (() => false),
		signal: opts.signal,
	};
}

describe("Compactor", () => {
	describe("shouldCompact", () => {
		it("returns false when estimated tokens are below the threshold", () => {
			const compactor = createCompactor();
			const ctx = buildContext(
				[makeUserMessage("hi"), makeAssistantMessage("hello")],
				{ tokenThreshold: 10000 },
			);

			expect(compactor.shouldCompact(ctx)).toBe(false);
		});

		it("returns true when estimated tokens exceed the threshold", () => {
			const compactor = createCompactor();
			// 一条很长的 user 消息：4000 字符 ≈ 1000 tokens (chars/4 估算)。
			// 两条长消息 ≈ 2000 tokens，阈值设 1000 → 超阈值。
			const longText = "x".repeat(4000);
			const ctx = buildContext(
				[makeUserMessage(longText), makeAssistantMessage(longText)],
				{ tokenThreshold: 1000 },
			);

			expect(compactor.shouldCompact(ctx)).toBe(true);
		});

		it("returns true when the injected stage-boundary predicate fires", () => {
			const compactor = createCompactor();
			const ctx = buildContext(
				[makeUserMessage("hi"), makeAssistantMessage("hello")],
				{ tokenThreshold: 10000, isAtStageBoundary: () => true },
			);

			expect(compactor.shouldCompact(ctx)).toBe(true);
		});

		it("returns true when stageMarkers match the last message content (tokens under threshold)", () => {
			// 末尾 assistant 消息内容含 stage marker；token 未超阈值。
			const compactor = createCompactor({ stageMarkers: ["## STAGE COMPLETE"] });
			const ctx = buildContext(
				[
					makeUserMessage("hi"),
					makeAssistantMessage("done with work\n## STAGE COMPLETE"),
				],
				{ tokenThreshold: 10000 },
			);

			expect(compactor.shouldCompact(ctx)).toBe(true);
		});

		it("returns false when stageMarkers do not match the last message (tokens under threshold)", () => {
			// 末尾消息不含任何 marker；token 未超阈值 → 不触发。
			const compactor = createCompactor({ stageMarkers: ["## STAGE COMPLETE"] });
			const ctx = buildContext(
				[makeUserMessage("hi"), makeAssistantMessage("still working, no marker here")],
				{ tokenThreshold: 10000 },
			);

			expect(compactor.shouldCompact(ctx)).toBe(false);
		});

		it("does not trigger on marker-like text when stageMarkers not configured (backward compat)", () => {
			// 未传 stageMarkers：即便末尾消息恰好含 marker 字面量，也不触发（仅 token 阈值触发）。
			const compactor = createCompactor();
			const ctx = buildContext(
				[makeUserMessage("hi"), makeAssistantMessage("## STAGE COMPLETE by accident")],
				{ tokenThreshold: 10000 },
			);

			expect(compactor.shouldCompact(ctx)).toBe(false);
		});

		it("gives ctx.isAtStageBoundary predicate priority over stageMarkers (fires even when markers do not match)", () => {
			// markers 不匹配末尾消息，但注入谓词返回 true → 仍触发。
			const compactor = createCompactor({ stageMarkers: ["## STAGE COMPLETE"] });
			const ctx = buildContext(
				[makeUserMessage("hi"), makeAssistantMessage("no marker here")],
				{ tokenThreshold: 10000, isAtStageBoundary: () => true },
			);

			expect(compactor.shouldCompact(ctx)).toBe(true);
		});
	});

	describe("estimateTokens", () => {
		it("counts image block data length toward the char estimate", () => {
			// 构造一条 assistant 消息，含一个 image block，data 为某长度字符串。
			// image 分支计入 (block.data ?? "").length 的十进制字符串表示（String(...) 规范化）。
			// 选 data 长度 12345678 → String(12345678) = "12345678" = 8 chars → ceil(8/4) = 2 tokens。
			// 若实现被破坏成 out += "0"（1 char）→ ceil(1/4) = 1 token，测试可 catch。
			const imageData = "x".repeat(12345678);
			const message = {
				role: "assistant",
				content: [{ type: "image", data: imageData }],
			} as any;

			const tokens = estimateTokens(message);

			// String(12345678) = 8 chars → 至少 2 tokens 贡献被计入。
			expect(tokens).toBeGreaterThanOrEqual(2);
		});
	});

	describe("compact", () => {
		it("calls deps.generateSummary and returns its summary", async () => {
			const compactor = createCompactor({ keepRecentTokens: 1 });
			// 2 个完整 turn；keepRecentTokens=1 强制只保留最后一个 turn。
			const messages: AgentMessage[] = [
				makeUserMessage("old question"),
				makeAssistantMessage("old answer"),
				makeUserMessage("new question"),
				makeAssistantMessage("new answer"),
			];
			const ctx = buildContext(messages, { tokenThreshold: 1000 });

			const result = await compactor.compact(ctx, {
				generateSummary: async () => "SUMMARY OF OLD",
			});

			expect(result.summary).toBe("SUMMARY OF OLD");
		});

		it("keeps the cut point on a turn boundary (user message), not mid-turn", async () => {
			// 用很小的 keepRecentTokens 强制切点落在 assistant 上，
			// 验证对齐逻辑把 cutIndex 推到前一条 user 消息（保留整个 turn）。
			const compactor = createCompactor({ keepRecentTokens: 1 });
			// turn1: user + assistant(+toolCall) + toolResult + assistant
			// turn2: user + assistant
			const messages: AgentMessage[] = [
				makeUserMessage("turn1 q"),
				makeAssistantWithToolCall("read", { path: "/a.txt" }),
				makeToolResultMessage("call-read"),
				makeAssistantMessage("turn1 final answer"),
				makeUserMessage("turn2 q"),
				makeAssistantMessage("turn2 answer"),
			];
			const ctx = buildContext(messages, { tokenThreshold: 1000 });

			const result = await compactor.compact(ctx, {
				generateSummary: async () => "S",
			});

			// firstKeptEntryId 必须指向 user 消息（turn 边界），
			// 而不是 assistant / toolResult（turn 中间）。
			const keptIdx = messages.indexOf(result.keptMessages[0]!);
			expect((result.keptMessages[0] as any).role).toBe("user");
			expect(result.firstKeptEntryId).toBe(`entry-${keptIdx}`);
		});

		it("returns keptMessages = messages after the cut point", async () => {
			const compactor = createCompactor({ keepRecentTokens: 1 });
			const messages: AgentMessage[] = [
				makeUserMessage("old q"),
				makeAssistantMessage("old a"),
				makeUserMessage("new q"),
				makeAssistantMessage("new a"),
			];
			const ctx = buildContext(messages, { tokenThreshold: 1000 });

			const result = await compactor.compact(ctx, {
				generateSummary: async () => "S",
			});

			// 保留区应是最后一个完整 turn（new q + new a）
			expect(result.keptMessages).toHaveLength(2);
			expect((result.keptMessages[0] as any).role).toBe("user");
			expect((result.keptMessages[1] as any).role).toBe("assistant");
		});

		it("extracts fileOps (read/written/edited) from compacted tool_calls", async () => {
			const compactor = createCompactor({ keepRecentTokens: 1 });
			// 被压缩区含 read/write/edit 三种 tool_call。
			const messages: AgentMessage[] = [
				makeAssistantWithToolCall("read", { path: "/read.txt" }),
				makeToolResultMessage("call-read"),
				makeAssistantWithToolCall("write", { path: "/written.txt" }),
				makeToolResultMessage("call-write"),
				makeAssistantWithToolCall("edit", { path: "/edited.txt" }),
				makeToolResultMessage("call-edit"),
				makeUserMessage("new turn"),
				makeAssistantMessage("new answer"),
			];
			const ctx = buildContext(messages, { tokenThreshold: 1000 });

			const result = await compactor.compact(ctx, {
				generateSummary: async () => "S",
			});

			expect(result.fileOps.read.has("/read.txt")).toBe(true);
			expect(result.fileOps.written.has("/written.txt")).toBe(true);
			expect(result.fileOps.edited.has("/edited.txt")).toBe(true);
			// 保留区的消息（new turn）不应进 fileOps
			expect(result.fileOps.read.has("/new-turn")).toBe(false);
		});

		it("does not extract fileOps from the kept (non-compacted) region", async () => {
			const compactor = createCompactor({ keepRecentTokens: 1 });
			const messages: AgentMessage[] = [
				makeAssistantWithToolCall("read", { path: "/old.txt" }),
				makeToolResultMessage("call-read"),
				makeUserMessage("new turn"),
				makeAssistantWithToolCall("write", { path: "/kept-write.txt" }),
				makeToolResultMessage("call-write"),
				makeAssistantMessage("done"),
			];
			const ctx = buildContext(messages, { tokenThreshold: 1000 });

			const result = await compactor.compact(ctx, {
				generateSummary: async () => "S",
			});

			// /old.txt 在被压缩区 → 进 read；/kept-write.txt 在保留区 → 不进 fileOps
			expect(result.fileOps.read.has("/old.txt")).toBe(true);
			expect(result.fileOps.written.has("/kept-write.txt")).toBe(false);
		});

		it("always retains the last complete turn even when token budget would zero out the keep region", async () => {
			// keepRecentTokens=0 → 每条消息都超预算 → findCutPoint 的 target 推到 length
			// → 防御逻辑 target=length-1 → 对齐到最后 turn 的 user 边界。
			// 验证：即使保留预算为 0，仍保留最后一个完整 turn，不把全部历史压成 summary。
			// 若防御逻辑缺失（target=length 不修止），slice(length)=[] → 测试失败。
			const compactor = createCompactor({ keepRecentTokens: 0 });
			const messages: AgentMessage[] = [
				makeUserMessage("turn1 q"),
				makeAssistantMessage("turn1 a"),
				makeUserMessage("turn2 q"),
				makeAssistantMessage("turn2 a"),
			];
			const ctx = buildContext(messages, { tokenThreshold: 1 });

			const result = await compactor.compact(ctx, {
				generateSummary: async () => "S",
			});

			// 必须保留最后完整 turn（turn2 q + a），不能为空也不能只留半 turn
			expect(result.keptMessages.length).toBe(2);
			expect((result.keptMessages[0] as any).role).toBe("user");
			expect((result.keptMessages[1] as any).role).toBe("assistant");
			// 旧 turn 被压成 summary
			expect(result.summary).toBe("S");
		});

		it("passes ctx.signal through to generateSummary", async () => {
			const ac = new AbortController();
			const seenSignals: (AbortSignal | undefined)[] = [];
			const compactor = createCompactor();
			const ctx = buildContext(
				[makeUserMessage("hi"), makeAssistantMessage("hello")],
				{ tokenThreshold: 0, signal: ac.signal },
			);
			const deps = {
				generateSummary: async (_messages: AgentMessage[], signal?: AbortSignal) => {
					seenSignals.push(signal);
					return "summary";
				},
			};
			const result = await compactor.compact(ctx, deps);
			expect(seenSignals).toEqual([ac.signal]);
			expect(result.summary).toBe("summary");
		});
	});

	describe("harness integration", () => {
		it("persists a CompactionEntry when the injected compactor triggers after a prompt", async () => {
			const events = createEventBus();
			const session = createMemorySession();

			// 注入 mock compactor：一旦 messages 超过 1 条就 shouldCompact=true，
			// compact 返回固定 summary + 保留最后一条消息。
			const mockCompactor = {
				shouldCompact: (ctx: any) => ctx.messages.length > 1,
				compact: async (ctx: any, _deps: any) => ({
					summary: "MOCK SUMMARY",
					firstKeptEntryId: "kept-id",
					keptMessages: [ctx.messages[ctx.messages.length - 1]],
					fileOps: { read: new Set(), written: new Set(), edited: new Set() },
				}),
			};

			const harness = new AgentForgeHarness({
				session,
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: "test",
				streamFn: makeMockStreamFn("mocked reply"),
				compactor: mockCompactor as any,
				compactorDeps: {
					generateSummary: async () => "MOCK SUMMARY",
				} as any,
			});

			await harness.prompt("first turn");

			// session 路径上应存在一条 CompactionEntry
			const path = session.getPathToRoot(session.getLeafId());
			const compactionEntry = path.find((e: any) => e.type === "compaction");
			expect(compactionEntry).toBeDefined();
			expect((compactionEntry as any).summary).toBe("MOCK SUMMARY");
			expect((compactionEntry as any).firstKeptEntryId).toBe("kept-id");
		});

		it("emits a compaction event on the EventBus when compaction runs", async () => {
			const events = createEventBus();
			const session = createMemorySession();
			const seen: any[] = [];
			events.on("compaction", (e: any) => seen.push(e));

			const mockCompactor = {
				shouldCompact: (ctx: any) => ctx.messages.length > 1,
				compact: async (ctx: any, _deps: any) => ({
					summary: "S",
					firstKeptEntryId: "k",
					keptMessages: [ctx.messages[ctx.messages.length - 1]],
					fileOps: { read: new Set(), written: new Set(), edited: new Set() },
				}),
			};

			const harness = new AgentForgeHarness({
				session,
				events,
				tools: [],
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				systemPrompt: "test",
				streamFn: makeMockStreamFn("reply"),
				compactor: mockCompactor as any,
				compactorDeps: { generateSummary: async () => "S" } as any,
			});

			await harness.prompt("trigger compaction");

			expect(seen.length).toBe(1);
			expect(seen[0].type).toBe("compaction");
			expect(seen[0].summary).toBe("S");
		});
	});
});
