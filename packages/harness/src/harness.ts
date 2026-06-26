import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import type {
	AgentEvent,
	AgentMessage,
	AgentTool,
	AfterToolCallContext,
	BeforeToolCallContext,
	BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type { SessionStore } from "./session.js";
import type { EventBus } from "./events.js";
import type {
	HarnessEvent,
	HarnessToolExecutionEndEvent,
	MessageEntry,
	CompactionEntry,
} from "@agentforge/shared";
import type {
	Compactor,
	CompactDeps,
	CompactionContext,
} from "./compaction.js";
import { audit, headroom, type BudgetThresholds } from "./context-budget.js";
import type {
	SafetyGuard,
	SafetyContext,
	SafetyVerdict,
} from "./safety.js";
import type { SantaVerifier, Rubric, ReviewResult } from "./verification.js";
import {
	formatInstinctsForSystemPrompt,
	type InstinctStore,
} from "./instinct.js";
import type { Auditor } from "./audit.js";

/**
 * AgentForgeHarness：包装 pi 核心 Agent 的 harness 核心类。见 ARCHITECTURE.md §9。
 *
 * 职责（Slice 0 最小版）：
 *  - 构造 pi Agent（注入 systemPrompt / model / tools / getApiKey / streamFn）。
 *  - 把 pi Agent.subscribe 的事件转发到 harness EventBus。
 *  - afterToolCall hook 把 tool_execution_end 转发到 EventBus。
 *  - prompt(input)：驱动 agent.prompt + waitForIdle，再把新增 assistant 消息 append 到 session。
 *
 * Slice 0 构造时 messages 传 []（不从 session 恢复；恢复留待 Task 8）。
 */
export interface HarnessOptions {
	session: SessionStore;
	events: EventBus;
	tools: AgentTool[];
	provider: string; // 如 "anthropic"
	model: string; // 如 "claude-sonnet-4-5"
	systemPrompt: string;
	getApiKey?: (provider: string) => string | Promise<string | undefined>;
	/** 可选 streamFn 注入（测试用 mock，避免真实 LLM 请求）。 */
	streamFn?: any;
	/**
	 * 可选初始消息（--resume 时从已持久化 session 重建的历史）。
	 * 默认 []：Slice 0 构造时 messages 传 []。resume 时传入历史 AgentMessage[]。
	 */
	initialMessages?: AgentMessage[];
	/**
	 * 可选 Compactor（Slice 1）。注入后，prompt() 在 turn 完成后主动调
	 * shouldCompact + compact，持久化 CompactionEntry 并 emit compaction 事件，
	 * 再把 agent 的 messages 替换为 [summary 消息, ...keptMessages]。
	 * 挂载方式说明：pi Agent 不暴露 shouldStopAfterTurn（仅低层 AgentLoopConfig 有），
	 * transformContext hook 是纯变换（返回 messages，无 session 访问，不适合持久化），
	 * 故选 harness.prompt turn 间主动调用——这是"压缩 + 落盘"最自然的方式。
	 */
	compactor?: Compactor;
	/** compact 的依赖（generateSummary 注入；真对话用 pi-ai streamSimple/agent）。 */
	compactorDeps?: CompactDeps;
	/** shouldCompact 的 token 阈值。默认 100000。 */
	compactionTokenThreshold?: number;
	/**
	 * 可选模型上下文窗口（issue #12）。注入后，prompt 每 turn 完成、maybeCompact 之后，
	 * harness 调 context-budget.audit 诊断 systemPrompt/skills/tools/history 的 token
	 * 开销。若有 suggestions 或 headroom 不足，emit context_budget 事件（诊断性，不阻塞）。
	 */
	modelContextWindow?: number;
	/** 可选 audit 阈值覆盖（默认 DEFAULT_THRESHOLDS）。 */
	budgetThresholds?: BudgetThresholds;
	/**
	 * 可选 SafetyGuard（Slice 2 §4.6）。注入后，beforeToolCall 把每次工具调用
	 * 委托给 safety.check，据 verdict 决定 allow / block。未注入时 beforeToolCall
	 * 返回 undefined（向后兼容）。
	 */
	safety?: SafetyGuard;
	/**
	 * 可选 ask 处理器：safety.check 返回 "ask" 时调用。返回 true 放行，
	 * 返回 false 阻断（reason "safety:ask-denied"）。未提供时 ask 降级为 deny
	 * （reason "safety:ask-no-handler"）。可异步。
	 */
	safetyAskHandler?: (ctx: SafetyContext) => boolean | Promise<boolean>;
	/**
	 * 可选工作目录，传入 SafetyContext.cwd 供 safety 判定 write/edit 路径归属。
	 * 默认 process.cwd()。
	 */
	cwd?: string;
	/**
	 * 可选 SantaVerifier（Slice 3 §4.8）。注入后，harness.verify(output, rubric)
	 * 委托 verifier.review。未注入时 verify() throw "no verifier configured"。
	 * harness.prompt 不自动触发 verifier（被动工具，调用方显式调）。
	 */
	verifier?: SantaVerifier;
	/**
	 * 可选 InstinctStore（Slice 4-B §T7）。注入后，构造时 apply：
	 *   1. loadInstincts → filter confidence>=0.5 → sort desc → cap 20 →
	 *      formatInstinctsForSystemPrompt → append 到 systemPrompt（before new Agent）。
	 *   2. store _baseSystemPrompt（原始 opts.systemPrompt）+ _instinctBlock（格式化块）。
	 *   3. new Agent 之后 observe：events.on("*", e => instinct.observe(e))。
	 * maybeAuditBudget 传 systemPrompt=_baseSystemPrompt + memory=_instinctBlock
	 * （避免 instinct tokens 在 systemPrompt + memory 双重计数）。
	 * extract(signal?) 委托 instinctStore.extract。
	 */
	instinct?: InstinctStore;
	/**
	 * 可选 Auditor（Slice 5 §4.4）。注入后，构造时 `auditor.subscribe(events)` 挂载
	 * 事件累积;prompt() 末尾(appendNewMessages 后)调 `auditor.scan(state, recentEvents)`，
	 * scan 内部 emit `audit_finding` per finding。未注入时无副作用(向后兼容)。
	 */
	auditor?: Auditor;
}

export class AgentForgeHarness {
	private readonly _agent: Agent;
	private readonly session: SessionStore;
	private readonly events: EventBus;
	private readonly compactor?: Compactor;
	private readonly compactorDeps?: CompactDeps;
	private readonly compactionTokenThreshold: number;
	private readonly modelContextWindow?: number;
	private readonly budgetThresholds?: BudgetThresholds;
	private readonly safety?: SafetyGuard;
	private readonly safetyAskHandler?: (ctx: SafetyContext) => boolean | Promise<boolean>;
	private readonly cwd: string;
	private readonly _verifier?: SantaVerifier;
	/** Slice 4-B T7: 注入的 InstinctStore（apply/observe/extract 委托目标）。 */
	private readonly _instinct?: InstinctStore;
	/** Slice 5 T5: 注入的 Auditor（subscribe + prompt 末尾 scan）。 */
	private readonly _auditor?: Auditor;
	/** Slice 4-B T7: 原始 opts.systemPrompt（不含 instinct block）—— maybeAuditBudget 据此避免双重计数。 */
	private readonly _baseSystemPrompt: string;
	/** Slice 4-B T7: 格式化 instinct 块（无 instinct / 全被滤 → ""）。maybeAuditBudget 作 memory 传入。 */
	private readonly _instinctBlock: string;

	constructor(opts: HarnessOptions) {
		this.session = opts.session;
		this.events = opts.events;
		this.compactor = opts.compactor;
		this.compactorDeps = opts.compactorDeps;
		this.compactionTokenThreshold = opts.compactionTokenThreshold ?? 100000;
		this.modelContextWindow = opts.modelContextWindow;
		this.budgetThresholds = opts.budgetThresholds;
		this.safety = opts.safety;
		this.safetyAskHandler = opts.safetyAskHandler;
		this.cwd = opts.cwd ?? process.cwd();
		this._verifier = opts.verifier;
		this._instinct = opts.instinct;
		this._auditor = opts.auditor;
		this._baseSystemPrompt = opts.systemPrompt;

		// apply（before new Agent）：load + filter confidence>=0.5 + sort desc + cap 20 +
		// format → instinctBlock。Agent 的 initialState.systemPrompt = basePrompt + block，
		// 让 LLM 看到学到的 instincts。loadInstincts/format 失败静默降级为 "" 块。
		let instinctBlock = "";
		if (this._instinct) {
			try {
				const all = this._instinct.loadInstincts();
				const filtered = all
					.filter((i) => i.confidence >= 0.5)
					.sort((a, b) => b.confidence - a.confidence)
					.slice(0, 20);
				instinctBlock = formatInstinctsForSystemPrompt(filtered);
			} catch {
				instinctBlock = "";
			}
		}
		this._instinctBlock = instinctBlock;

		this._agent = new Agent({
			initialState: {
				systemPrompt: opts.systemPrompt + instinctBlock,
				model: getModel(opts.provider as any, opts.model as any),
				tools: opts.tools,
				messages: opts.initialMessages ?? [],
			},
			getApiKey: opts.getApiKey,
			streamFn: opts.streamFn,
			beforeToolCall: async (
				ctx: BeforeToolCallContext,
			): Promise<BeforeToolCallResult | undefined> => {
				// 无 safety：向后兼容，返回 undefined。
				if (!this.safety) return undefined;
				return this.applySafety({
					toolName: ctx.toolCall?.name ?? "",
					args: ctx.args,
				});
			},
			afterToolCall: async (
				ctx: AfterToolCallContext,
			): Promise<undefined> => {
				this.events.emit({
					type: "tool_execution_end",
					toolCallId: ctx.toolCall.id,
					toolName: ctx.toolCall.name,
					args: ctx.args,
					result: ctx.result,
					isError: ctx.isError,
				} satisfies HarnessToolExecutionEndEvent);
				return undefined;
			},
		});

		// pi Agent 事件 → harness EventBus
		this._agent.subscribe((e: AgentEvent) => {
			this.events.emit(e as any);
		});

		// Slice 4-B T7 observe：instinctStore 订阅全部 harness 事件（通配符）。
		// instinct.observe 内部 adapt 把 tool_execution_end / message_end 等转成 Observation 持久化。
		if (this._instinct) {
			this.events.on("*", (e) => this._instinct!.observe(e));
		}

		// Slice 5 T5: auditor 订阅 events bus（累积 events 到环形 buffer 等）。
		// scan 在 prompt 末尾由 harness 主动触发（见 prompt()）。
		if (this._auditor) {
			this._auditor.subscribe(this.events);
		}
	}

	/** 暴露底层 pi Agent（供高级用法/测试检视 state）。 */
	get agent(): Agent {
		return this._agent;
	}

	/**
	 * 订阅所有 harness 事件（RPC 等外部消费者用）。返回 unsubscribe。
	 * 委托给 EventBus 的通配符 handler（type "*"）。非 breaking：未调用则无副作用。
	 */
	onEvent(handler: (e: HarnessEvent) => void): () => void {
		return this.events.on("*", handler);
	}

	/**
	 * 对一次工具调用应用 Safety 裁决（Slice 2 §4.6）。
	 *
	 * 构造时 beforeToolCall 闭包转发到此方法；亦可被测试直接调用以验证 verdict
	 * → block/undefined 映射。输入为工具名 + args（cwd 从 this.cwd 取）。
	 *
	 * - 无 this.safety → undefined（向后兼容）
	 * - deny → { block: true, reason: "safety:deny" }
	 * - allow → undefined
	 * - ask + handler → handler(ctx) ? undefined : { block: true, reason: "safety:ask-denied" }
	 * - ask 无 handler → { block: true, reason: "safety:ask-no-handler" }（降级 deny）
	 */
	async applySafety(input: {
		toolName: string;
		args: unknown;
	}): Promise<BeforeToolCallResult | undefined> {
		if (!this.safety) return undefined;
		const safetyCtx: SafetyContext = {
			toolName: input.toolName,
			args: input.args,
			cwd: this.cwd,
		};
		const verdict: SafetyVerdict = this.safety.check(safetyCtx);
		if (verdict === "deny") return { block: true, reason: "safety:deny" };
		if (verdict === "allow") return undefined;
		// verdict === "ask"
		if (this.safetyAskHandler) {
			const ok = await this.safetyAskHandler(safetyCtx);
			return ok ? undefined : { block: true, reason: "safety:ask-denied" };
		}
		return { block: true, reason: "safety:ask-no-handler" };
	}

	/**
	 * 对抗验证（Slice 3 §4.8）：委托注入的 verifier.review(output, rubric)。
	 * 未注入 verifier 时 throw "no verifier configured"。
	 * 不自动触发——调用方显式调（harness.prompt 不调）。
	 */
	async verify(output: string, rubric: Rubric): Promise<ReviewResult> {
		if (!this._verifier) {
			throw new Error("no verifier configured");
		}
		return this._verifier.review(output, rubric);
	}

	/** 暴露注入的 verifier（高级用法访问 verifyUntilNice）；未注入时 undefined。 */
	get verifier(): SantaVerifier | undefined {
		return this._verifier;
	}

	/**
	 * Slice 4-B T7: 委托注入的 instinctStore.extract(signal)。
	 * 未注入 instinct 时静默 no-op。extract 在 session 末尾由调用方显式触发；
	 * 中途 extract 不修改当前 session 的 systemPrompt（Agent 已构造，apply 不可逆）——
	 * 新 instincts 在下次构造（下次 session）时才会被 apply 注入（D2 设计意图）。
	 */
	async extract(signal?: AbortSignal): Promise<void> {
		await this._instinct?.extract(signal);
	}

	/** 暴露注入的 InstinctStore；未注入时 undefined。 */
	get instinctStore(): InstinctStore | undefined {
		return this._instinct;
	}

	/**
	 * 驱动一轮对话：append user input → agent.prompt → waitForIdle →
	 * 把新增 assistant 消息 append 到 session。
	 *
	 * 若注入了 compactor，turn 完成并落盘后主动调 shouldCompact + compact，
	 * 持久化 CompactionEntry、emit compaction 事件，并把 agent messages 替换为
	 * [summary 消息, ...keptMessages]。
	 *
	 * 可选 signal：若提供且 abort，触发 agent.abort() 真中止 pi Agent 当前 run
	 * （runWithLifecycle 的 finally → finishRun 释放 activeRun）。streamFn 契约
	 * 要求 honor options.signal 并终止 stream，否则 agent loop 永久挂起。
	 * 注意：abort 后 agent.state.messages 可能含 stopReason==="aborted" 的半成品
	 * assistant 消息——这里过滤掉，不污染 session/--resume 历史。
	 */
	async prompt(input: string, signal?: AbortSignal): Promise<void> {
		if (signal) {
			if (signal.aborted) {
				this._agent.abort();
			} else {
				// {once:true}：abort 触发后 listener 自动移除。正常路径（无 abort）listener
				// 残留至 signal 被 GC——rpc per-request AbortController 短生命周期，无泄漏；
				// 长生命周期 signal 由调用方自行管理（A4 文档化，handoff note）。
				signal.addEventListener("abort", () => this._agent.abort(), { once: true });
			}
		}
		const beforeCount = this._agent.state.messages.length;
		await this._agent.prompt(input);
		await this._agent.waitForIdle();

		// 若调用方 signal 被 abort，throw 让上层（rpc timeout）映射为错误。
		// agent loop 已正常退出（streamFn honor signal），activeRun 已释放；
		// throw 前先（在 appendNewMessages 内）过滤掉 abort 半成品消息再落盘 session。
		if (signal?.aborted) {
			this.appendNewMessages(beforeCount);
			throw new Error("aborted");
		}

		this.appendNewMessages(beforeCount);

		// Slice 1: turn 间主动压缩（见 HarnessOptions.compactor 注释）。
		// Slice 2.5: signal 透传给 generateSummary 的 LLM 调用；失败非治理性，
		// try/catch 内 emit compaction_error 不 rethrow（AbortError 静默）。
		if (this.compactor && this.compactorDeps) {
			await this.maybeCompact(signal);
		}

		// Slice 1 issue #12: 每 turn 完成后做 ContextBudget 诊断（若注入 modelContextWindow）。
		// 诊断性，try/catch 防 budget 失败影响主流程。
		if (this.modelContextWindow) {
			this.maybeAuditBudget();
		}

		// Slice 5 T5: prompt 末尾调 auditor.scan(state, recentEvents)。
		// recentEvents 传 []：createAuditor.scan 入参为空时回落到 subscribe 累积的 buffer
		// （spec §4.4：recentEvents 从 subscribe buffer 取），并经已绑定的 bus emit audit_finding。
		// 诊断性，try/catch 防 audit 失败影响主流程。
		if (this._auditor) {
			try {
				this._auditor.scan(this._agent.state, []);
			} catch {
				// audit 失败不影响主流程。
			}
		}
	}

	/**
	 * 把 agent.state.messages[beforeCount..] 的新消息 append 到 session。
	 * 过滤 stopReason==="aborted" 的半成品 assistant 消息（abort 产生，不进 --resume 历史）。
	 */
	private appendNewMessages(beforeCount: number): void {
		const messages = this._agent.state.messages;
		for (let i = beforeCount; i < messages.length; i++) {
			const message = messages[i] as AgentMessage;
			if (message.role === "assistant" && message.stopReason === "aborted") {
				continue;
			}
			const entry: MessageEntry = {
				type: "message",
				entryId: "" as any,
				parentId: null,
				timestamp: Date.now(),
				message,
			} as any;
			this.session.appendEntry(entry as any);
		}
	}

	/**
	 * 构造 BudgetAuditInput 调 audit，若有 suggestions 或 headroom 不足则 emit
	 * context_budget 事件。skills 传 []（Slice 1 harness 不直接持有 skills 列表，
	 * skills 已在 systemPrompt 拼接阶段融入 systemPrompt 字符串）。try/catch 包裹，
	 * 任何 audit 失败静默吞掉（诊断不阻塞主流程）。
	 */
	private maybeAuditBudget(): void {
		if (!this.modelContextWindow) return;
		try {
			// Slice 4-B T7 红队修正：用 _baseSystemPrompt（不含 instinct 块）+ memory=_instinctBlock，
			// 避免 instinct tokens 同时计入 systemPrompt 与 memory（双重计数）。
			// _instinctBlock 为 "" 时传 undefined（audit 内部 0 而非占位 token）。
			const report = audit({
				systemPrompt: this._baseSystemPrompt,
				skills: [],
				tools: this._agent.state.tools,
				messages: this._agent.state.messages,
				modelContextWindow: this.modelContextWindow,
				thresholds: this.budgetThresholds,
				memory: this._instinctBlock || undefined,
			});
			const remaining = headroom(report.total, this.modelContextWindow);
			// 有建议或总 token 超窗口时 emit 事件(issue #3:收紧条件,
			// 去掉「total>window/2」中间地带,只在有可操作建议或真超窗口时报警)。
			if (
				report.suggestions.length > 0 ||
				report.total > this.modelContextWindow
			) {
				this.events.emit({
					type: "context_budget",
					components: report.components,
					total: report.total,
					suggestions: report.suggestions,
					headroom: remaining,
				});
			}
		} catch {
			// 诊断失败不影响主流程。
		}
	}

	/**
	 * 构造 CompactionContext：把 agent 当前 messages 与 session 路径上的
	 * MessageEntry entryId 配对（顺序一致）。
	 */
	private buildCompactionContext(signal?: AbortSignal): CompactionContext {
		const messages = this._agent.state.messages;
		// 从 session 叶节点路径上的 message entries 取 entryId，与 agent messages 一一对应。
		const path = this.session.getPathToRoot(this.session.getLeafId());
		const messageEntryIds: string[] = [];
		for (const e of path) {
			if (e.type === "message") messageEntryIds.push(e.entryId);
		}
		// 长度应一致；若不一致（如刚构造未落盘），用占位 id 兜底。
		const entryIds = messages.map(
			(_, i) => messageEntryIds[i] ?? `agent-msg-${i}`,
		);
		return {
			messages,
			entryIds,
			tokenThreshold: this.compactionTokenThreshold,
			signal,
		};
	}

	/**
	 * Slice 2.5: 整体 try/catch 包裹——appendEntry + emit + message 替换非原子，
	 * 任一步抛错都视为 compaction 失败。非 abort 错 emit compaction_error 不 rethrow
	 * （不阻塞主流程）；AbortError（signal.aborted 或 DOMException AbortError）静默 return，
	 * 因 abort 是调用方意图、非治理失败。signal 透传给 generateSummary 的 LLM 调用。
	 */
	private async maybeCompact(signal?: AbortSignal): Promise<void> {
		if (!this.compactor || !this.compactorDeps) return;
		try {
			const ctx = this.buildCompactionContext(signal);
			if (!this.compactor.shouldCompact(ctx)) return;

			const result = await this.compactor.compact(ctx, this.compactorDeps);

			// 落盘 CompactionEntry。
			const compactionEntry: CompactionEntry = {
				type: "compaction",
				entryId: "" as any,
				parentId: null,
				timestamp: Date.now(),
				summary: result.summary,
				firstKeptEntryId: result.firstKeptEntryId,
			} as any;
			this.session.appendEntry(compactionEntry as any);

			// emit compaction 事件。
			this.events.emit({
				type: "compaction",
				summary: result.summary,
				firstKeptEntryId: result.firstKeptEntryId,
			});

			// 替换 agent messages：[summary 消息, ...keptMessages]。
			// summary 作为一条 user 消息注入，让 LLM 看到压缩后的历史。
			const summaryMessage: AgentMessage = {
				role: "user",
				content: `[Previous context summary]\n${result.summary}`,
				timestamp: Date.now(),
			} as any;
			this._agent.state.messages = [summaryMessage, ...result.keptMessages];
		} catch (err) {
			// abort 非治理失败，静默不 emit compaction_error。
			if (
				signal?.aborted ||
				(err instanceof DOMException && err.name === "AbortError")
			) {
				return;
			}
			const error = err instanceof Error ? err.message : String(err);
			this.events.emit({ type: "compaction_error", error });
		}
	}
}
