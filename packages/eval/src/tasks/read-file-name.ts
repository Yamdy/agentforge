/**
 * 示例 task:read-file-name(spec §4.4)。
 *
 * prompt:读 <sandbox>/package.json 报告 name。
 * setup:在 sandbox 写一个含 name 的 package.json(供 agent 读;亦作 acceptance 前置)。
 * acceptance:file-contains package.json 的 name 子串(声明式,red-team ⚪ 7)。
 *
 * 注:prompt 中 <sandbox> 占位由 runner/CLI 在真实跑时替换;本示例 task 自洽性
 * (setup 产物满足 acceptance)由 tasks.test.ts 验证。
 */
import fs from "node:fs";
import path from "node:path";
import type { Task } from "../types.js";

export const readFileTask: Task = {
	id: "read-file-name",
	prompt:
		"读 <sandbox>/package.json 文件,报告其中的 name 字段值。仅报告 name,不要做其他操作。",
	acceptanceChecks: [
		{ kind: "file-contains", path: "package.json", contains: "agentforge-eval-fixture" },
	],
	async setup(sandbox: string): Promise<void> {
		fs.writeFileSync(
			path.join(sandbox, "package.json"),
			JSON.stringify({ name: "agentforge-eval-fixture", version: "0.0.0" }, null, 2),
		);
	},
};
