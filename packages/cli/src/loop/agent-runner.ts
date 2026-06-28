/**
 * AgentRunner 接口 + InProcessAgentRunner(spec §4.3)。
 *
 * InProcessAgentRunner:每次 run 构造 fresh AgentForgeHarness(ADR-0001b in-process),
 * 注入 safety(不传 askHandler → ask 降级 deny,同 rpc)。**不注入**
 * instinct/auditor/verifier/compactor(spec D13 / red-team 🔴2):这三者跨迭代
 * 共享进程级状态(instinct store 订阅 events 写 observations、auditor 累积),
 * 会破坏 fresh context;循环迭代要纯 fresh。review gate 用独立 SantaVerifier
 * 实例(不经 harness.verify)。
 *
 * cost = sum 所有 AssistantMessage usage.cost.total(red-team ⚪6:覆盖迭代内
 * 多轮工具调用中间成本,不只 last);reply = 最后 AssistantMessage content
 * TextContent join。signal 透传 harness.prompt(signal)→ agent.abort。
 *
 * 借鉴 eval runTask 但改进 cost 提取(sum vs last)。
 */
import {
	AgentForgeHarness,
	createEventBus,
	createMemorySession,
} from "@agentforge/harness";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

export interface AgentRunResult {
	reply: string;
	cost: number;
	tokensIn: number;
	tokensOut: number;
}

export interface AgentRunOptions {
	cwd: string;
	signal?: AbortSignal;
}

export interface AgentRunner {
	run(prompt: string, opts: AgentRunOptions): Promise<AgentRunResult>;
}

export interface InProcessAgentRunnerOptions {
	provider: string;
	model: string;
	getApiKey?: (provider: string) => string | Promise<string | undefined>;
	tools?: any[];
	toolsFactory?: (cwd: string) => any[];
	systemPrompt: string;
	streamFn?: any;
	safety?: any;
}

export class InProcessAgentRunner implements AgentRunner {
	private readonly opts: InProcessAgentRunnerOptions;

	constructor(opts: InProcessAgentRunnerOptions) {
		this.opts = opts;
	}

	/** 按 per-run cwd 解析 tools:有 toolsFactory 则重建(绑定 cwd),否则用固定 tools。
	 *  红队 #1:调用方须保证 toolsFactory(cwd) 的 cwd === 传给 harness 的 cwd(runCwd)。 */
	private resolveTools(cwd: string): any[] {
		if (this.opts.toolsFactory) return this.opts.toolsFactory(cwd);
		return this.opts.tools ?? [];
	}

	async run(prompt: string, runOpts: AgentRunOptions): Promise<AgentRunResult> {
		const runCwd = runOpts.cwd;
		const tools = this.resolveTools(runCwd);
		// fresh harness per run(D13:不注入 instinct/auditor/verifier/compactor)。
		const harness = new AgentForgeHarness({
			session: createMemorySession(),
			events: createEventBus(),
			tools,
			provider: this.opts.provider,
			model: this.opts.model,
			systemPrompt: this.opts.systemPrompt,
			getApiKey: this.opts.getApiKey,
			streamFn: this.opts.streamFn,
			safety: this.opts.safety,
			cwd: runCwd,
			initialMessages: [],
		});

		await harness.prompt(prompt, runOpts.signal);

		const messages = harness.agent.state.messages;
		const assistants = messages.filter(isAssistantMessage);
		// cost/tokens = sum 所有 AssistantMessage(red-team ⚪6:覆盖多轮工具调用中间成本)。
		const cost = assistants.reduce(
			(sum, m) => sum + (m.usage?.cost?.total ?? 0),
			0,
		);
		const tokensIn = assistants.reduce((sum, m) => sum + (m.usage?.input ?? 0), 0);
		const tokensOut = assistants.reduce((sum, m) => sum + (m.usage?.output ?? 0), 0);
		// reply = 最后 AssistantMessage content TextContent join。
		const last = assistants[assistants.length - 1];
		const reply = last ? contentToText(last.content) : "";
		return { reply, cost, tokensIn, tokensOut };
	}
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return (
		m != null &&
		typeof m === "object" &&
		(m as { role?: string }).role === "assistant"
	);
}

function contentToText(content: AssistantMessage["content"]): string {
	let out = "";
	for (const block of content as ReadonlyArray<{ type?: string; text?: string }>) {
		if (block && block.type === "text") out += block.text ?? "";
	}
	return out;
}
