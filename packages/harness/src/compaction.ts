import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Compaction 模块：上下文压缩。见 ARCHITECTURE.md §4.2。
 *
 * 职责：在阶段边界或 token 阈值触发时，把旧历史压缩为 summary，
 * 切点保 turn 完整，提取 fileOps（已读/已写/已编辑文件集合）。
 *
 * Slice 1 最小版：token 阈值触发；阶段边界策略做成可注入的判断函数
 * （isAtStageBoundary），不硬编码阶段检测逻辑。token 估算用 chars/4 近似
 * （pi-ai 未暴露 tokenizer；pi harness 的 estimateTokens 同样用字符启发式）。
 */

/**
 * 文件操作集合：从 compacted 历史的 tool_call 中聚合。
 * read = read/grep/glob 读取的文件；written = write 全文写入；edited = edit 修改。
 */
export interface FileOperations {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

/** 压缩决策与执行的输入上下文。 */
export interface CompactionContext {
	/** 待评估/压缩的消息列表（agent 当前 transcript）。 */
	messages: AgentMessage[];
	/** 与 messages 并行的 session entryId（harness 从 session 重建时填入）。
	 * 纯 compactor 单测可填占位 id。 */
	entryIds: string[];
	/** 触发压缩的 token 阈值（估算 tokens 超过此值则应压缩）。 */
	tokenThreshold: number;
	/** 可注入的阶段边界判断函数（Slice 1 默认 false，不硬编码阶段检测）。 */
	isAtStageBoundary?: () => boolean;
}

/** compact 的外部依赖（注入以便测试 mock）。 */
export interface CompactDeps {
	/** 生成 summary（测试用 mock 返回固定串；真对话用 pi-ai streamSimple/agent）。 */
	generateSummary: (messages: AgentMessage[]) => Promise<string>;
}

/** compact 的产物。 */
export interface CompactionResult {
	/** LLM 生成的旧历史摘要。 */
	summary: string;
	/** 保留历史起点的 session entryId（指向 turn 边界，不在 turn 中间）。 */
	firstKeptEntryId: string;
	/** 切点之后保留的消息（含切点本身）。 */
	keptMessages: AgentMessage[];
	/** 从被压缩历史中提取的文件操作集合。 */
	fileOps: FileOperations;
}

/**
 * 估算单条消息的 token 数。
 * 策略：pi-ai 未暴露 tokenizer，用 chars/4 近似（英文约 4 字符/token，中文偏保守）。
 * 与 pi harness 的 estimateTokens 同样基于字符启发式。
 */
export function estimateTokens(message: AgentMessage): number {
	let chars = 0;
	const role = (message as any).role;
	if (role === "user") {
		const content = (message as any).content;
		chars += typeof content === "string" ? content.length : stringifyContent(content).length;
	} else if (role === "assistant") {
		chars += stringifyContent((message as any).content).length;
	} else if (role === "toolResult") {
		chars += stringifyContent((message as any).content).length;
	}
	// 不足 1 token 计 1，避免空消息被忽略
	return Math.max(1, Math.ceil(chars / 4));
}

function stringifyContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return String(content ?? "");
	let out = "";
	for (const block of content as any[]) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text") out += block.text ?? "";
		else if (block.type === "thinking") out += block.thinking ?? "";
		else if (block.type === "toolCall") out += JSON.stringify(block.arguments ?? {});
		else if (block.type === "image") out += String((block.data ?? "").length);
	}
	return out;
}

/** 估算一组消息的总 token 数。 */
export function estimateTotalTokens(messages: AgentMessage[]): number {
	let total = 0;
	for (const m of messages) total += estimateTokens(m);
	return total;
}

/**
 * 切点选择结果。
 * cutIndex = 保留消息的第一条索引（被压缩的是 messages[0..cutIndex-1]）。
 * 切点对齐到 turn 边界（user 消息起点），不切在 turn 中间。
 */
export interface CutPoint {
	/** 保留历史的第一条消息索引。 */
	cutIndex: number;
}

/**
 * 找压缩切点：从末尾向前保留消息直到累计 token 超过 keepRecentTokens，
 * 然后把 cutIndex 对齐到 target 处或之前最近的一条 user 消息（turn 边界），
 * 使保留区从一个完整 turn 起始，切点不在 turn 中间。
 *
 * turn 定义：一条 user 消息 + 其后的 assistant / toolResult 消息，直到下一条 user。
 * turn 边界 = user 消息所在索引。若 target 处及之前无 user 消息，回退 target。
 */
export function findCutPoint(
	messages: AgentMessage[],
	keepRecentTokens: number,
): CutPoint {
	if (messages.length === 0) return { cutIndex: 0 };

	// 从末尾向前累计 token，找到第一个超过 keepRecentTokens 的位置。
	let acc = 0;
	let target = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		acc += estimateTokens(messages[i] as AgentMessage);
		if (acc > keepRecentTokens) {
			target = i + 1; // i 这条已超预算，从 i+1 开始保留
			break;
		}
	}
	// target 可能 0（全部都没超预算）或某索引。至少保留最后一条消息。
	if (target >= messages.length) target = messages.length - 1;

	// 对齐到 turn 边界：cutIndex 取 target 处或之前最近的一条 user 消息索引，
	// 使保留区从完整 turn 起始（不切在 turn 中间）。若 target 处及之前无 user
	// 消息（如开头就是 assistant），无法在 turn 边界切割，回退 target。
	let cutIndex = -1;
	for (let i = target; i >= 0; i--) {
		if ((messages[i] as any).role === "user") {
			cutIndex = i;
			break;
		}
	}
	if (cutIndex < 0) cutIndex = target;
	return { cutIndex };
}

/**
 * 从消息列表中提取文件操作集合。
 * 扫 AssistantMessage 的 toolCall 块，按工具名映射到 read/written/edited。
 * - read/grep/glob/ls → read
 * - write → written
 * - edit → edited
 * 路径取自 arguments.path（或 arguments.file_path，兼容常见命名）。
 */
export function extractFileOps(messages: AgentMessage[]): FileOperations {
	const fileOps: FileOperations = {
		read: new Set<string>(),
		written: new Set<string>(),
		edited: new Set<string>(),
	};
	for (const m of messages) {
		if ((m as any).role !== "assistant") continue;
		const content = (m as any).content;
		if (!Array.isArray(content)) continue;
		for (const block of content as any[]) {
			if (!block || block.type !== "toolCall") continue;
			const name: string = block.name;
			const args: Record<string, any> = block.arguments ?? {};
			const path = (args.path ?? args.file_path ?? args.filePath) as
				| string
				| undefined;
			if (!path || typeof path !== "string") continue;
			if (name === "write") fileOps.written.add(path);
			else if (name === "edit") fileOps.edited.add(path);
			else if (name === "read" || name === "grep" || name === "glob" || name === "ls")
				fileOps.read.add(path);
		}
	}
	return fileOps;
}

export interface Compactor {
	shouldCompact(ctx: CompactionContext): boolean;
	compact(ctx: CompactionContext, deps: CompactDeps): Promise<CompactionResult>;
}

export interface CompactorOptions {
	/** 压缩后保留近期历史的 token 预算。默认 tokenThreshold / 2。 */
	keepRecentTokens?: number;
	/** 阶段标记字符串：当末尾消息文本包含任一标记时触发压缩（token 阈值未超时）。
	 * 默认 undefined/空 → 不启用标记检测。caller 注入的 isAtStageBoundary 谓词优先。 */
	stageMarkers?: string[];
}

/** 取一条消息的文本内容（user 取 content，assistant/toolResult 取 stringifyContent）。 */
function messageText(message: AgentMessage): string {
	const role = (message as any).role;
	if (role === "user") {
		const content = (message as any).content;
		return typeof content === "string" ? content : stringifyContent(content);
	}
	return stringifyContent((message as any).content);
}

/** 创建默认 Compactor。 */
export function createCompactor(opts: CompactorOptions = {}): Compactor {
	const keepRecentTokens = opts.keepRecentTokens;
	const stageMarkers = opts.stageMarkers;
	return {
		shouldCompact(ctx) {
			const total = estimateTotalTokens(ctx.messages);
			if (total > ctx.tokenThreshold) return true;
			// 阶段边界触发：caller 注入的谓词优先（若注入且 true 则触发）。
			if (ctx.isAtStageBoundary?.()) return true;
			// 标记检测：若配置了 stageMarkers，检查末尾消息文本是否含任一标记。
			if (stageMarkers && stageMarkers.length > 0 && ctx.messages.length > 0) {
				const last = ctx.messages[ctx.messages.length - 1] as AgentMessage;
				const text = messageText(last);
				for (const marker of stageMarkers) {
					if (marker && text.includes(marker)) return true;
				}
			}
			return false;
		},
		async compact(ctx, deps) {
			const messages = ctx.messages;
			const budget = keepRecentTokens ?? Math.floor(ctx.tokenThreshold / 2);
			const { cutIndex } = findCutPoint(messages, budget);
			const messagesToSummarize = messages.slice(0, cutIndex);
			const keptMessages = messages.slice(cutIndex);
			const summary = await deps.generateSummary(messagesToSummarize);
			const firstKeptEntryId = ctx.entryIds[cutIndex] ?? "";
			const fileOps = extractFileOps(messagesToSummarize);
			return { summary, firstKeptEntryId, keptMessages, fileOps };
		},
	};
}
