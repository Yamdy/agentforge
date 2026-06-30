import { describe, it, expect } from "vitest";
import {
	serializeEvent,
	type SerializedEvent,
	type HarnessEvent,
	type HarnessCustomEvent,
	type AgentMessage,
} from "./index.js";

/** 构造合法 AgentMessage 的最小 helper（结构取自 pi types，role/text 必填）。 */
function makeAssistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
	} as unknown as AgentMessage;
}

describe("shared serializeEvent — 9-case whitelist", () => {
	it("serializes agent_start (type-only)", () => {
		const event = { type: "agent_start" } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toEqual({ type: "agent_start" });
	});

	it("serializes agent_end as type-only (messages omitted, given in prompt result)", () => {
		const event = {
			type: "agent_end",
			messages: [makeAssistantMessage("hi")],
		} as unknown as HarnessEvent;
		expect(serializeEvent(event)).toEqual({ type: "agent_end" });
	});

	it("serializes message_end with message", () => {
		const message = makeAssistantMessage("hi");
		const event = { type: "message_end", message } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toMatchObject({ type: "message_end", message });
	});

	it("serializes tool_execution_end (slim: toolCallId/toolName/isError, no result by default)", () => {
		const event = {
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			args: { path: "/x" },
			result: { content: [{ type: "text", text: "file contents" }] },
			isError: false,
		} as unknown as HarnessEvent;
		expect(serializeEvent(event)).toEqual({
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			isError: false,
		});
	});

	it("serializes context_budget event", () => {
		const event = {
			type: "context_budget",
			components: {},
			total: 5000,
			suggestions: [],
			headroom: 60000,
		} as unknown as HarnessEvent;
		expect(serializeEvent(event)).toMatchObject({ type: "context_budget", total: 5000 });
	});

	it("serializes compaction event (with firstKeptEntryId — locks Card C drift point)", () => {
		const event = {
			type: "compaction",
			summary: "SUMMARY",
			firstKeptEntryId: "e-1",
		} as unknown as HarnessEvent;
		expect(serializeEvent(event)).toMatchObject({
			type: "compaction",
			summary: "SUMMARY",
			firstKeptEntryId: "e-1",
		});
	});

	it("serializes compaction_error event", () => {
		const event = { type: "compaction_error", error: "LLM down" } as unknown as HarnessEvent;
		expect(serializeEvent(event)).toEqual({ type: "compaction_error", error: "LLM down" });
	});

	it("serializes audit_finding event (type + severity + finding)", () => {
		const finding = {
			severity: "critical",
			title: "hallucinated tool execution",
		};
		const event = {
			type: "audit_finding",
			severity: "critical",
			finding,
		} as unknown as HarnessEvent;
		expect(serializeEvent(event)).toEqual({
			type: "audit_finding",
			severity: "critical",
			finding,
		});
	});

	it("serializes message_update only when opts.includeMessageUpdate=true", () => {
		const message = makeAssistantMessage("partial");
		const event = {
			type: "message_update",
			message,
			assistantMessageEvent: { delta: "tok" },
		} as unknown as HarnessEvent;
		// default false → undefined
		expect(serializeEvent(event)).toBeUndefined();
		// true → returns { type, message } (drops assistantMessageEvent)
		expect(serializeEvent(event, { includeMessageUpdate: true })).toEqual({
			type: "message_update",
			message,
		});
	});
});

describe("shared serializeEvent — opts differences", () => {
	it("opts.includeMessageUpdate=false (default) → message_update returns undefined", () => {
		const event = {
			type: "message_update",
			message: makeAssistantMessage("x"),
		} as unknown as HarnessEvent;
		expect(serializeEvent(event)).toBeUndefined();
		expect(serializeEvent(event, { includeMessageUpdate: false })).toBeUndefined();
	});

	it("opts.includeMessageUpdate=true → message_update returns {type, message}", () => {
		const message = makeAssistantMessage("partial");
		const event = {
			type: "message_update",
			message,
			assistantMessageEvent: { delta: "tok" },
		} as unknown as HarnessEvent;
		const out = serializeEvent(event, { includeMessageUpdate: true });
		expect(out).toEqual({ type: "message_update", message });
		// drops assistantMessageEvent (token-stream detail not on wire)
		expect(out).not.toHaveProperty("assistantMessageEvent");
	});

	it("opts.includeToolArgs=false (default) → tool_execution_end has no args", () => {
		const event = {
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			args: { path: "/x" },
			result: "big",
			isError: false,
		} as unknown as HarnessEvent;
		const out = serializeEvent(event);
		expect(out).toEqual({
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			isError: false,
		});
		expect(out).not.toHaveProperty("args");
		expect(out).not.toHaveProperty("result");
	});

	it("opts.includeToolArgs=true → tool_execution_end includes args", () => {
		const event = {
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			args: { path: "/x" },
			result: "big",
			isError: false,
		} as unknown as HarnessEvent;
		const out = serializeEvent(event, { includeToolArgs: true });
		expect(out).toEqual({
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			args: { path: "/x" },
			isError: false,
		});
		// result still omitted regardless of opts (large payload)
		expect(out).not.toHaveProperty("result");
	});

	it("web opts = {includeMessageUpdate:true, includeToolArgs:true} → message_update + args both present", () => {
		const msg = makeAssistantMessage("partial");
		const mu = serializeEvent(
			{ type: "message_update", message: msg } as unknown as HarnessEvent,
			{ includeMessageUpdate: true, includeToolArgs: true },
		);
		expect(mu).toEqual({ type: "message_update", message: msg });
		const te = serializeEvent(
			{
				type: "tool_execution_end",
				toolCallId: "tc-1",
				toolName: "read",
				args: { path: "/x" },
				result: "big",
				isError: true,
			} as unknown as HarnessEvent,
			{ includeMessageUpdate: true, includeToolArgs: true },
		);
		expect(te).toEqual({
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			args: { path: "/x" },
			isError: true,
		});
	});

	it("rpc opts = defaults (false,false) → message_update undefined + no args", () => {
		expect(
			serializeEvent(
				{ type: "message_update", message: makeAssistantMessage("x") } as unknown as HarnessEvent,
			),
		).toBeUndefined();
		expect(
			serializeEvent(
				{
					type: "tool_execution_end",
					toolCallId: "tc-1",
					toolName: "read",
					args: { path: "/x" },
					result: "big",
					isError: false,
				} as unknown as HarnessEvent,
			),
		).toEqual({
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			isError: false,
		});
	});
});

describe("shared serializeEvent — non-whitelist → undefined", () => {
	it.each([
		["turn_start", { type: "turn_start" }],
		["turn_end", { type: "turn_end", message: {}, toolResults: [] }],
		["message_start", { type: "message_start", message: {} }],
		["tool_execution_start", { type: "tool_execution_start", toolCallId: "x", toolName: "y", args: {} }],
		["tool_execution_update", { type: "tool_execution_update", toolCallId: "x", toolName: "y", args: {}, partialResult: {} }],
		["instinct_observed", { type: "instinct_observed", observation: {} }],
		["adr_recorded", { type: "adr_recorded", adrId: "a-1" }],
		["unknown internal event", { type: "some_unknown_internal_event" }],
	])("returns undefined for %s", (_label, ev) => {
		expect(serializeEvent(ev as unknown as HarnessEvent)).toBeUndefined();
		// opts do not rescue non-whitelist types
		expect(
			serializeEvent(ev as unknown as HarnessEvent, {
				includeMessageUpdate: true,
				includeToolArgs: true,
			}),
		).toBeUndefined();
	});
});

describe("shared serializeEvent — discriminant narrowing (compile-time type safety)", () => {
	it("returned values are assignable to SerializedEvent (no `as` runtime re-assertion needed)", () => {
		// 这个测试主要靠 tsc 编译期保证：serializeEvent 内部用 switch(event.type)
		// discriminant 窄化，字段直接 event.xxx 读取。这里仅做运行时形状断言。
		const cases: HarnessEvent[] = [
			{ type: "agent_start" } as unknown as HarnessEvent,
			{ type: "agent_end", messages: [] } as unknown as HarnessEvent,
			{ type: "message_end", message: makeAssistantMessage("x") } as unknown as HarnessEvent,
			{
				type: "tool_execution_end",
				toolCallId: "tc",
				toolName: "t",
				args: {},
				result: {},
				isError: false,
			} as unknown as HarnessEvent,
			{ type: "context_budget", components: {}, total: 0, suggestions: [], headroom: 0 } as unknown as HarnessEvent,
			{ type: "compaction", summary: "s", firstKeptEntryId: "e" } as unknown as HarnessEvent,
			{ type: "compaction_error", error: "e" } as unknown as HarnessEvent,
			{ type: "audit_finding", severity: "low", finding: {} } as unknown as HarnessEvent,
		];
		for (const ev of cases) {
			const out: SerializedEvent | undefined = serializeEvent(ev);
			expect(out).toBeDefined();
			expect(typeof out).toBe("object");
			expect(out).toHaveProperty("type");
		}
		// message_update with includeMessageUpdate=true also yields a SerializedEvent member
		const mu: SerializedEvent | undefined = serializeEvent(
			{ type: "message_update", message: makeAssistantMessage("p") } as unknown as HarnessEvent,
			{ includeMessageUpdate: true },
		);
		expect(mu).toBeDefined();
	});
});

/**
 * Task 2 契约测：锁 Card C 漂移。
 *
 * 与上方 9-case whitelist 测的区别：这里把 HarnessCustomEvent 每个成员当作一个
 * "协议契约条目"遍历，断言 (a) web opts 下输出符合 SerializedEvent 联合，
 * (b) 白名单成员落字、非白名单成员 undefined，(c) compaction.firstKeptEntryId 锁定漂移点。
 *
 * 每个成员以强类型对象（非 as unknown）构造 → 编译期即锁 union 形状：
 * 若 shared 改了任一成员字段名/类型，tsc 立即红，无需运行时。
 */
describe("Task 2 — HarnessCustomEvent 契约测（锁 Card C 漂移）", () => {
	/** web adapter opts：转发 message_update + 带 args。 */
	const webOpts = { includeMessageUpdate: true, includeToolArgs: true };

	/** 把 7 个 HarnessCustomEvent 成员各构造一份强类型样本（编译期锁形状）。 */
	const samples: HarnessCustomEvent[] = [
		{ type: "compaction", summary: "S", firstKeptEntryId: "e-1" },
		{ type: "compaction_error", error: "boom" },
		{ type: "instinct_observed", observation: { x: 1 } },
		{
			type: "audit_finding",
			severity: "high",
			finding: { title: "t" },
		},
		{ type: "adr_recorded", adrId: "adr-1" },
		{
			type: "context_budget",
			components: { systemPrompt: 10, skills: 0, tools: 0, history: 0 },
			total: 10,
			suggestions: [],
			headroom: 1000,
		},
		{
			type: "tool_execution_end",
			toolCallId: "tc-1",
			toolName: "read",
			args: { path: "/x" },
			result: "r",
			isError: false,
		},
	];

	/** 白名单：serializeEvent 应落字（非 undefined）。 */
	const whitelist = new Set([
		"compaction",
		"compaction_error",
		"audit_finding",
		"context_budget",
		"tool_execution_end",
	]);
	/** 非白名单（HarnessCustomEvent 中）→ undefined。 */
	const nonWhitelist = new Set(["instinct_observed", "adr_recorded"]);

	it.each(samples.map((s) => [s.type, s] as const))(
		"member %s — serializeEvent(member, webOpts) 落字且符合 SerializedEvent",
		(_type, member) => {
			if (nonWhitelist.has(member.type)) {
				// 非白名单成员单独在下一测断言 undefined；这里跳过落字断言。
				return;
			}
			const out = serializeEvent(member, webOpts);
			expect(out).toBeDefined();
			// 编译期契约：输出可赋值给 SerializedEvent 联合。
			const _contract: SerializedEvent | undefined = out;
			expect(_contract).toBe(out);
			// 运行时契约：type 透传，是 SerializedEvent 联合的字面量之一。
			expect(typeof out).toBe("object");
			expect(out).toHaveProperty("type", member.type);
		},
	);

	it.each(samples.map((s) => [s.type, s] as const))(
		"non-whitelist member %s → undefined（opts 不救非白名单）",
		(_type, member) => {
			if (whitelist.has(member.type)) return;
			expect(serializeEvent(member)).toBeUndefined();
			expect(serializeEvent(member, webOpts)).toBeUndefined();
			expect(serializeEvent(member, { includeToolArgs: true })).toBeUndefined();
		},
	);

	it("compaction 输出含 firstKeptEntryId（锁 Card C 漂移点）", () => {
		const member: HarnessCustomEvent = {
			type: "compaction",
			summary: "compacted",
			firstKeptEntryId: "entry-42",
		};
		const out = serializeEvent(member, webOpts);
		expect(out).toEqual({
			type: "compaction",
			summary: "compacted",
			firstKeptEntryId: "entry-42",
		});
		// 漂移护栏：firstKeptEntryId 字段必须存在（reducer 依赖此名做 compaction 锚点）。
		expect(out).toHaveProperty("firstKeptEntryId", "entry-42");
		expect(typeof (out as { firstKeptEntryId: unknown } | undefined)?.firstKeptEntryId).toBe(
			"string",
		);
	});

	it("compaction 输出不含 wire 不需要的字段（summary/firstKeptEntryId 之外无泄漏）", () => {
		const out = serializeEvent(
			{ type: "compaction", summary: "s", firstKeptEntryId: "e" },
			webOpts,
		);
		// 仅 3 个字段上 wire；任何 extra 字段泄漏都是协议漂移。
		expect(Object.keys(out as object).sort()).toEqual([
			"firstKeptEntryId",
			"summary",
			"type",
		]);
	});

	it("HarnessCustomEvent 每个成员遍历无遗漏（样本数 = 联合成员数 7）", () => {
		// 防护栏：若有人往 HarnessCustomEvent 加新成员而忘了加样本，此测红。
		expect(samples).toHaveLength(7);
		const seen = new Set(samples.map((s) => s.type));
		expect(seen).toEqual(
			new Set([
				"compaction",
				"compaction_error",
				"instinct_observed",
				"audit_finding",
				"adr_recorded",
				"context_budget",
				"tool_execution_end",
			]),
		);
	});
});
