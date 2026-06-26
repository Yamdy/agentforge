/**
 * 示例 task:run-test(spec §4.4)。
 *
 * prompt:跑 <sandbox> 测试报告结果。
 * setup:在 sandbox 写最小 package.json(使 sandbox 为合法 cwd)。
 * acceptance:exit-zero 跑 command 退出码 0。
 *
 * 注:spec §4.4 原写 `exit-zero(pnpm test)`,但示例 sandbox 无完整 pnpm 项目,
 * 强依赖 pnpm 会导致 acceptance 在裸 sandbox 不可过。改用 `node -e 0` 作 exit-zero
 * command——跨平台稳定、自包含,验 acceptance 逻辑即可(生产 task suite 用真实测试命令)。
 */
import fs from "node:fs";
import path from "node:path";
import type { Task } from "../types.js";

export const runTestTask: Task = {
	id: "run-test",
	prompt: "在 <sandbox> 目录运行测试,报告测试结果(通过/失败数)。",
	acceptanceChecks: [
		{ kind: "exit-zero", command: "node -e 0" },
	],
	async setup(sandbox: string): Promise<void> {
		// 写最小 package.json 使 sandbox 为合法 cwd;exit-zero command 自包含不依赖此文件。
		fs.writeFileSync(
			path.join(sandbox, "package.json"),
			JSON.stringify({ name: "run-test-fixture", version: "0.0.0" }, null, 2),
		);
	},
};
