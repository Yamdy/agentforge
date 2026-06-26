#!/usr/bin/env node
/**
 * Slice 7 eval CLI bin 入口(spec §4.5 / plan Task 7)。
 *
 * `agentforge-eval --suite <dir> --config a.json --config b.json [--repeats N] [--sandbox <dir>]`
 *
 * 实际逻辑在 cli.ts(runCli);本文件仅做 argv 提取 + 顶层错误处理。
 * 真实 LLM 跑需 provider API key(pi-ai env-api-keys 约定)。
 */
import { runCli } from "./cli.js";

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	try {
		await runCli(argv);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		process.stderr.write(`eval CLI error: ${msg}\n`);
		process.exitCode = 1;
	}
}

await main();
