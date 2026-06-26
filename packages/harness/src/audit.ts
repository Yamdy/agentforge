/**
 * Audit 模块（Slice 5 Task 1）。
 *
 * 两层 red-team checker 的容器：`tool-execution`(层 7) 与 `answer-shaping`(层 9)。
 * Task 1 仅提供 Finding/Auditor 接口 + createAuditor 骨架：
 *   - activeLayers 报告已注册层（red-team Important 4）
 *   - scan/subscribe 为 stub（T2/T4 填充真实逻辑）
 * 默认注册 2 层；defer 层不注册（返 []）。
 *
 * 见 docs/superpowers/specs/2026-06-25-slice5-audit-adr-council-design.md §4.1。
 */
import type { AgentState, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai/base";
import type { HarnessEvent } from "@agentforge/shared";
import type { EventBus } from "./events.js";

/** 单条审计发现。severity 取 red-team 分级；sourceLayer 标识产生层。 */
export interface Finding {
	severity: "critical" | "high" | "medium" | "low";
	title: string;
	mechanism: string;
	sourceLayer: string; // "tool-execution" / "answer-shaping"
	rootCause: string;
	evidenceRefs: string[]; // event 引用（toolCallId / message index）
	confidence: number; // 0-1
	recommendedFix: string;
}

/** Auditor 接口：scan 同步产出 findings；subscribe 挂载事件累积。 */
export interface Auditor {
	scan(state: AgentState, events: HarnessEvent[]): Finding[];
	subscribe(events: EventBus): void;
	readonly activeLayers: string[];
}

/** 默认注册的两层 checker（T2/T4 实现）。 */
const DEFAULT_LAYERS = ["tool-execution", "answer-shaping"];

/**
 * tool-execution checker（层 7）。
 *
 * 扫描 state.messages 中 assistant message 的 ToolCall blocks，排除：
 *   - aborted turn（stopReason === "aborted"）：pi 已滤除，但防御性再查
 *   - in-flight（pendingToolCalls 含该 toolCall.id）
 * 对每个剩余 toolCall.id 检查 events 是否有同 toolCallId 的 `tool_execution_end`。
 * 无 → critical finding（幻觉执行）。evidenceRefs=[toolCallId]。
 *
 * 见 spec §4.1 + red-team Important 3 修正。
 */
function toolExecutionChecker(state: AgentState, events: HarnessEvent[]): Finding[] {
	const findings: Finding[] = [];
	const pending = state.pendingToolCalls ?? new Set<string>();

	// 收集所有已执行的 toolCallId（来自 tool_execution_end events）。
	const executed = new Set<string>();
	for (const ev of events) {
		if (ev && (ev as any).type === "tool_execution_end" && typeof (ev as any).toolCallId === "string") {
			executed.add((ev as any).toolCallId);
		}
	}

	for (const msg of state.messages as AgentMessage[]) {
		// 只看 assistant message（pi AssistantMessage：role + content 数组 + stopReason）。
		if (!msg || (msg as any).role !== "assistant") continue;
		const assistant = msg as AssistantMessage;
		// 排除 aborted turn。
		if (assistant.stopReason === "aborted") continue;
		const content = Array.isArray(assistant.content) ? assistant.content : [];
		for (const block of content) {
			if (!block || (block as any).type !== "toolCall") continue;
			const id = (block as any).id as string | undefined;
			if (!id) continue;
			// 排除 in-flight（pendingToolCalls 含该 id）。
			if (pending.has(id)) continue;
			// 有对应 execution event 则跳过。
			if (executed.has(id)) continue;
			// 幻觉执行：assistant 已完成 turn（非 aborted、非 in-flight）但 toolCall 无 execution event。
			findings.push({
				severity: "critical",
				title: "Hallucinated tool execution",
				mechanism:
					"Assistant emitted a toolCall block but no corresponding tool_execution_end event was observed",
				sourceLayer: "tool-execution",
				rootCause:
					"Assistant message contains a toolCall id with no matching tool_execution_end event; the tool was never executed (or its execution was lost)",
				evidenceRefs: [id],
				confidence: 0.9,
				recommendedFix:
					"Verify tool dispatch wiring (beforeToolCall/execute path) emitted tool_execution_end for this toolCallId; guard against assistant fabricating tool calls without execution",
			});
		}
	}
	return findings;
}

/**
 * answer-shaping checker（层 9）。
 *
 * 检测 final assistant response：自 messages 末尾向前找最后一条「不含 toolCall block」的
 * assistant message（即最终答案）。若其 content 为空或纯空白 → medium finding（截断/空答）。
 * 若不存在这样的 assistant message（所有 assistant 消息都含 toolCall，或无 assistant 消息）
 * → 不报（尚无最终答案可审）。
 *
 * 见 spec §4.1 + red-team。
 */
function answerShapingChecker(state: AgentState): Finding[] {
	const findings: Finding[] = [];
	const messages = (state.messages ?? []) as AgentMessage[];

	// 自末尾向前找最后一条 assistant message 且不含 toolCall block。
	let finalAnswer: AssistantMessage | null = null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || (msg as any).role !== "assistant") continue;
		const assistant = msg as AssistantMessage;
		const content = Array.isArray(assistant.content) ? assistant.content : [];
		const hasToolCall = content.some(
			(b) => b && (b as any).type === "toolCall",
		);
		if (!hasToolCall) {
			finalAnswer = assistant;
			break;
		}
	}
	if (!finalAnswer) return findings;

	// content → string：拼合所有 text block，trim 后判空。
	const content = Array.isArray(finalAnswer.content) ? finalAnswer.content : [];
	const text = content
		.map((b) => (b && (b as any).type === "text" ? String((b as any).text ?? "") : ""))
		.join("");
	if (text.trim().length === 0) {
		findings.push({
			severity: "medium",
			title: "Empty or blank final assistant response",
			mechanism:
				"Final assistant message (no toolCall) has empty or whitespace-only content",
			sourceLayer: "answer-shaping",
			rootCause:
				"Assistant completed a turn without producing a substantive answer; the final response is empty or blank (possible truncation or model failure to answer)",
			evidenceRefs: [],
			confidence: 0.8,
			recommendedFix:
				"Verify model output was not truncated (stopReason/maxTokens) and that the assistant actually addressed the user's request; retry or surface the empty response",
		});
	}
	return findings;
}

/** 环形 buffer 容量上限。溢出时丢弃最旧事件并 emit 一次 low finding。 */
const BUFFER_CAP = 1000;

/**
 * 创建 Auditor。默认注册 `tool-execution` + `answer-shaping` 两层；
 * 可经 `opts.layers` 覆盖。scan 聚合已注册层 checker 并（若已 subscribe）emit
 * `audit_finding` per finding；subscribe 累积 events 到环形 buffer（cap 1000，
 * 溢出 emit 一次 low finding，见 spec §4.1 + red-team Important 5）。
 *
 * subscribe 后 scan 的语义：harness.prompt 末尾调 `scan(state, recentEvents)`。
 * 若 subscribe 已绑定 bus，则 scan 同时把 findings 经 bus emit 为 audit_finding
 * （per finding）。scan 入参 `events` 优先；若调用方未传（空数组）且 subscribe
 * 已累积 events，则使用 subscribe 累积的 buffer 作为 recentEvents（spec §4.4：
 * recentEvents 从 subscribe buffer 取）。
 */
export function createAuditor(opts?: { layers?: string[] }): Auditor {
	const layers = opts?.layers ?? DEFAULT_LAYERS;
	const enabled = new Set(layers);

	let bus: EventBus | null = null;
	// 环形 buffer：用数组 + 起始偏移实现；溢出时丢弃最旧。
	let buffer: HarnessEvent[] = [];
	let bufferOffset = 0; // 已被丢弃的元素数（逻辑起始索引）
	let overflowReported = false;

	const pushEvent = (event: HarnessEvent): void => {
		if (buffer.length < BUFFER_CAP) {
			buffer.push(event);
			return;
		}
		// 溢出：丢弃最旧（覆盖 offset 位置），推进 offset。
		buffer[bufferOffset] = event;
		bufferOffset = (bufferOffset + 1) % BUFFER_CAP;
		// 溢出信号：仅 emit 一次 low finding（red-team Important 5）。
		if (!overflowReported && bus) {
			overflowReported = true;
			bus.emit({
				type: "audit_finding",
				severity: "low",
				finding: {
					severity: "low",
					title: "event buffer overflow, oldest events dropped",
					mechanism:
						"audit subscribe ring buffer exceeded capacity; oldest events were overwritten",
					sourceLayer: "audit-buffer",
					rootCause:
						"more than 1000 events accumulated in the audit event buffer without a scan draining it",
					evidenceRefs: [],
					confidence: 1,
					recommendedFix:
						"scan more frequently (after each prompt) or increase buffer capacity; oldest audit events are being lost",
				} satisfies Finding,
			});
		}
	};

	const snapshotBuffer = (): HarnessEvent[] => {
		if (buffer.length <= BUFFER_CAP) {
			return buffer.slice();
		}
		// 环形：从 offset 开始读 BUFFER_CAP 个。
		const out: HarnessEvent[] = [];
		for (let i = 0; i < BUFFER_CAP; i++) {
			out.push(buffer[(bufferOffset + i) % BUFFER_CAP]);
		}
		return out;
	};

	return {
		activeLayers: layers,
		scan(state: AgentState, events: HarnessEvent[]): Finding[] {
			// recentEvents 优先用入参；入参为空时回落到 subscribe buffer（spec §4.4）。
			const recent =
				events && events.length > 0 ? events : snapshotBuffer();
			const findings: Finding[] = [];
			if (enabled.has("tool-execution")) {
				findings.push(...toolExecutionChecker(state, recent));
			}
			if (enabled.has("answer-shaping")) {
				findings.push(...answerShapingChecker(state));
			}
			// 若已 subscribe，emit audit_finding per finding（spec §4.4）。
			if (bus) {
				for (const f of findings) {
					bus.emit({
						type: "audit_finding",
						severity: f.severity,
						finding: f,
					});
				}
			}
			return findings;
		},
		subscribe(events: EventBus): void {
			bus = events;
			// 累积所有 emit 的事件到环形 buffer（通配符订阅）。
			events.on("*", (event) => {
				pushEvent(event);
			});
		},
	};
}
