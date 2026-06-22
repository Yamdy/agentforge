import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import type {
	AgentEvent,
	AgentMessage,
	AgentTool,
	AfterToolCallContext,
	BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type { SessionStore } from "./session.js";
import type { EventBus } from "./events.js";
import type { MessageEntry, CompactionEntry } from "@agentforge/shared";
import type {
	Compactor,
	CompactDeps,
	CompactionContext,
} from "./compaction.js";
import { audit, headroom, type BudgetThresholds } from "./context-budget.js";

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

	constructor(opts: HarnessOptions) {
		this.session = opts.session;
		this.events = opts.events;
		this.compactor = opts.compactor;
		this.compactorDeps = opts.compactorDeps;
		this.compactionTokenThreshold = opts.compactionTokenThreshold ?? 100000;
		this.modelContextWindow = opts.modelContextWindow;
		this.budgetThresholds = opts.budgetThresholds;

		this._agent = new Agent({
			initialState: {
				systemPrompt: opts.systemPrompt,
				model: getModel(opts.provider as any, opts.model as any),
				tools: opts.tools,
				messages: opts.initialMessages ?? [],
			},
			getApiKey: opts.getApiKey,
			streamFn: opts.streamFn,
			beforeToolCall: async (): Promise<BeforeToolCallResult | undefined> => undefined,
			afterToolCall: async (
				ctx: AfterToolCallContext,
			): Promise<undefined> => {
				this.events.emit({
					type: "tool_execution_end",
					toolCallId: ctx.toolCall.id,
					toolName: ctx.toolCall.name,
					result: ctx.result,
					isError: ctx.isError,
				} as any);
				return undefined;
			},
		});

		// pi Agent 事件 → harness EventBus
		this._agent.subscribe((e: AgentEvent) => {
			this.events.emit(e as any);
		});
	}

	/** 暴露底层 pi Agent（供高级用法/测试检视 state）。 */
	get agent(): Agent {
		return this._agent;
	}

	/**
	 * 驱动一轮对话：append user input → agent.prompt → waitForIdle →
	 * 把新增 assistant 消息 append 到 session。
	 *
	 * 若注入了 compactor，turn 完成并落盘后主动调 shouldCompact + compact，
	 * 持久化 CompactionEntry、emit compaction 事件，并把 agent messages 替换为
	 * [summary 消息, ...keptMessages]。
	 */
	async prompt(input: string): Promise<void> {
		const beforeCount = this._agent.state.messages.length;
		await this._agent.prompt(input);
		await this._agent.waitForIdle();

		const messages = this._agent.state.messages;
		for (let i = beforeCount; i < messages.length; i++) {
			const message = messages[i] as AgentMessage;
			const entry: MessageEntry = {
				type: "message",
				entryId: "" as any,
				parentId: null,
				timestamp: Date.now(),
				message,
			} as any;
			this.session.appendEntry(entry as any);
		}

		// Slice 1: turn 间主动压缩（见 HarnessOptions.compactor 注释）。
		if (this.compactor && this.compactorDeps) {
			await this.maybeCompact();
		}

		// Slice 1 issue #12: 每 turn 完成后做 ContextBudget 诊断（若注入 modelContextWindow）。
		// 诊断性，try/catch 防 budget 失败影响主流程。
		if (this.modelContextWindow) {
			this.maybeAuditBudget();
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
			const systemPrompt = this._agent.state.systemPrompt ?? "";
			const report = audit({
				systemPrompt,
				skills: [],
				tools: this._agent.state.tools,
				messages: this._agent.state.messages,
				modelContextWindow: this.modelContextWindow,
				thresholds: this.budgetThresholds,
			});
			const remaining = headroom(report.total, this.modelContextWindow);
			// 有建议或 headroom 不足时 emit 事件。
			if (report.suggestions.length > 0 || remaining < report.total) {
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
	private buildCompactionContext(): CompactionContext {
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
		};
	}

	private async maybeCompact(): Promise<void> {
		if (!this.compactor || !this.compactorDeps) return;
		const ctx = this.buildCompactionContext();
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
	}
}
