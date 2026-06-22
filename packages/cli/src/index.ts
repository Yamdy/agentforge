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
import { runReplMode, type ReplInput } from "./repl.js";

async function main(): Promise<void> {
	const argv = process.argv.slice(2);

	// 最小检测：有 -p/--print 即 print 模式（runPrintMode 内部会精确解析）。
	const hasPrintFlag =
		argv.includes("-p") || argv.includes("--print");

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

	// REPL 模式：把 stdin 行缓冲成队列，runReplMode 同步消费（read 返回 null=EOF）。
	// readline 是异步的，故 bin 入口先收集所有行到队列，EOF 后一次性驱动循环。
	// （交互式逐行驱动留待 Slice 1+ 用 pi-tui；Slice 0 用批处理语义即可验证链路。）
	const lineQueue: string[] = [];

	const input: ReplInput = {
		read(): string | null {
			return lineQueue.length > 0 ? (lineQueue.shift() as string) : null;
		},
	};

	await new Promise<void>((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.on("line", (line: string) => {
			lineQueue.push(line);
		});
		rl.on("close", () => {
			resolve();
		});
	});

	await runReplMode(argv, {
		getApiKey,
		input,
		output: { write: (s) => process.stdout.write(s) },
	});
}

main().catch((err: unknown) => {
	console.error(
		"agentforge:",
		err instanceof Error ? err.message : String(err),
	);
	process.exit(1);
});
