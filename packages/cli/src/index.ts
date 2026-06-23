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

async function main(): Promise<void> {
	const argv = process.argv.slice(2);

	// 最小检测：有 -p/--print 即 print 模式（runPrintMode 内部会精确解析）。
	const hasPrintFlag =
		argv.includes("-p") || argv.includes("--print");
	const hasRpcFlag = argv.includes("--rpc");

	// getApiKey：从 process.env 透传（pi-ai 约定名）。
	// pi-ai env-api-keys 约定：provider 名大写 + _API_KEY。deepseek → DEEPSEEK_API_KEY。
	const getApiKey = (provider: string): string | undefined => {
		const envName = `${provider.toUpperCase()}_API_KEY`;
		return process.env[envName];
	};

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
