import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const cliDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

describe("cli ui subcommand", () => {
	// 动态 import @agentforge/web 打破循环依赖：cli 启动时不加载 web，仅 ui 子命令分支内加载。
	// 子进程跑真实 dist/index.js ui --port 0，断言打印 session + open url 行后立即杀进程（不进 REPL）。
	it("ui 子命令起服并打印 session + open url，不进 REPL", async () => {
		// 提供 fake API key（getApiKey 从 env 读，绝不硬编码）。
		const env = { ...process.env, DEEPSEEK_API_KEY: "test-key" };
		const child = spawn(process.execPath, [cliDist, "ui", "--port", "0"], { env });

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d.toString()));
		child.stderr.on("data", (d) => (stderr += d.toString()));

		// 等待 open url 行出现（server listen 完成），最长 15s。
		const opened = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 15000);
			child.stderr.on("data", () => {
				if (stderr.includes("open: http://127.0.0.1:")) {
					clearTimeout(timer);
					resolve(true);
				}
			});
			child.on("error", () => { clearTimeout(timer); resolve(false); });
			child.on("exit", () => { clearTimeout(timer); resolve(stderr.includes("open: http://127.0.0.1:")); });
		});

		child.kill("SIGKILL");
		try { await new Promise<void>((r) => child.on("exit", () => r())); } catch { /* killed */ }

		expect(opened).toBe(true);
		expect(stderr).toMatch(/agentforge ui — session [0-9a-f-]+/);
		expect(stderr).toMatch(/open: http:\/\/127\.0\.0\.1:\d+/);
	}, 20000);

	it("非 ui 子命令（如 --print）不触发 ui 分支", async () => {
		// -p/--print 走 print 模式，不应打印 ui 的 open url 行。
		const env = { ...process.env, DEEPSEEK_API_KEY: "test-key" };
		const child = spawn(process.execPath, [cliDist, "-p", "hello"], { env });

		let stderr = "";
		child.stderr.on("data", (d) => (stderr += d.toString()));

		await new Promise<void>((resolve) => child.on("exit", () => resolve()));

		expect(stderr).not.toMatch(/open: http:\/\/127\.0\.0\.1/);
	}, 20000);
});
