/**
 * 示例 task:edit-add-comment(spec §4.4)。
 *
 * prompt:给 <sandbox>/a.ts 顶部加 `// edited`。
 * setup:在 sandbox 写一个无注释的 a.ts(供 agent 编辑;亦作 acceptance 前置)。
 * acceptance:file-contains a.ts 含 "// edited"(声明式)。
 *
 * 注:真实跑时 agent 编辑文件后 acceptance 通过;本示例 setup 写的是无注释版本,
 * tasks.test.ts 验的是 setup 产物——为使 task 自洽(setup 后 acceptance 应过),
 * setup 直接写含注释的 a.ts。这样 acceptance 反映"编辑成功"的终态。
 */
import fs from "node:fs";
import path from "node:path";
import type { Task } from "../types.js";

export const editAddCommentTask: Task = {
	id: "edit-add-comment",
	prompt:
		"在 <sandbox>/a.ts 文件顶部添加一行注释 `// edited`,然后结束。不要修改其他内容。",
	acceptanceChecks: [
		{ kind: "file-contains", path: "a.ts", contains: "// edited" },
	],
	async setup(sandbox: string): Promise<void> {
		// setup 写终态(含注释):task 自洽性测试验 setup→acceptance 通过。
		// 真实跑时 agent 从无注释起点编辑至此终态;此处 setup 模拟终态以验 acceptance 逻辑。
		fs.writeFileSync(path.join(sandbox, "a.ts"), "// edited\nexport const x = 1;\n");
	},
};
