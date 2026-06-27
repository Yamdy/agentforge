#!/usr/bin/env node
/**
 * agentforge cli 入口。见 ARCHITECTURE.md §5/§8，Slice 0 Task 7/9。
 *
 * 模式：
 *  - print 模式（-p/--print <prompt>）：单轮对话，输出最终 assistant 文本。
 *  - REPL 模式（无 -p，默认）：readline 循环，每行 prompt，--resume 恢复历史 session。
 *
 * API key 从 process.env 读（环境变量名按 pi-ai 约定，如 DEEPSEEK_API_KEY），
 * 绝不硬编码。真对话时不传 streamFn 走默认 provider 流；测试通过 deps 注入 mock。
 */
import * as readline from "node:readline";

import { runPrintMode } from "./print-mode.js";
import { runReplMode, makeReadlineAskHandler, makeReadlineBridge } from "./repl.js";
import { runRpcMode } from "./rpc.js";
import { getApiKeyFromEnv } from "./env-config.js";

async function main(): Promise<void> {
	const argv = process.argv.slice(2);

	// 最小检测：有 -p/--print 即 print 模式（runPrintMode 内部会精确解析）。
	const hasPrintFlag =
		argv.includes("-p") || argv.includes("--print");
	const hasRpcFlag = argv.includes("--rpc");

	// getApiKey：从 process.env 读（按 pi-ai env-api-keys 约定，见 env-config.ts）。
	// 用 getApiKeyFromEnv 而非自拼 env 名——含 `-` 的 provider（如 xiaomi-token-plan-cn）
	// 须按 pi-ai 映射读 XIAOMI_TOKEN_PLAN_CN_API_KEY（非非法的 XIAOMI-TOKEN-PLAN-CN_API_KEY）。
	const getApiKey = getApiKeyFromEnv;

	// loop 子命令(优先于 -p/--rpc flag):agentforge loop --prompt ... --max-runs ...
	// spec D5:子命令清晰,未来 agentforge rfc-dag 同构。
	const hasLoopSubcommand = argv[0] === "loop";
	if (hasLoopSubcommand) {
		const { runLoopMode } = await import("./loop/loop-mode.js");
		const { createLoopAgentDeps } = await import("./loop/agent-deps.js");
		// Step 5:注入 tools/systemPrompt/safety(复用 print-mode 同源构造),
		// 让 loop agent 真改文件(覆盖 reply-only 默认 [])。
		const { tools, systemPrompt, safety } = createLoopAgentDeps();
		await runLoopMode(argv.slice(1), {
			getApiKey: async (p: string) => getApiKeyFromEnv(p),
			provider: "deepseek",
			model: "deepseek-chat",
			tools,
			systemPrompt,
			safety,
		});
		return;
	}

	if (hasPrintFlag) {
		// 不传 streamFn → 走 Agent 默认 streamSimple → 真实 SSE 流。
		const output = await runPrintMode(argv, { getApiKey });
		process.stdout.write(output + "\n");
		return;
	}

	if (hasRpcFlag) {
		// RPC 模式（Slice 3.5）：stdin 逐行 JSON-RPC，stdout JSONL。
		// makeReadlineBridge 桥接 readline 事件与 runRpcMode 的 async read()（A6）。
		const bridge = makeReadlineBridge();
		const rl = readline.createInterface({ input: process.stdin });
		rl.on("line", (line: string) => bridge.push(line));
		rl.on("close", () => bridge.push(null));
		await runRpcMode(argv, {
			getApiKey,
			input: bridge,
			output: { write: (s) => process.stdout.write(s) },
		});
		return;
	}

	// REPL 模式（T7：readline 逐行驱动，ADR-0001a）。
	// makeReadlineBridge 桥接 readline 事件与 runReplMode 的 async read()（A6）：
	// rl.on("line") push(line)；rl.on("close") push(null)（EOF 唤醒等待者）。
	// 这样 runReplMode 可在 EOF 前就逐行 prompt，而非批处理后一次性驱动。
	const bridge = makeReadlineBridge();
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	rl.on("line", (line: string) => {
		bridge.push(line);
	});
	rl.on("close", () => {
		bridge.push(null);
	});

	await runReplMode(argv, {
		getApiKey,
		input: bridge,
		output: { write: (s) => process.stdout.write(s) },
		// T8：REPL 模式有交互通道，传真实 readline ask handler。
		// safety.check 返回 "ask" 时提示用户 y/n，y 放行否则阻断。
		safetyAskHandler: makeReadlineAskHandler(rl),
	});
}

main().catch((err: unknown) => {
	console.error(
		"agentforge:",
		err instanceof Error ? err.message : String(err),
	);
	process.exit(1);
});
