// packages/cli/src/loop/agent-deps.ts
/**
 * loop 模式 agent 依赖构造(spec §4.3 / Step 5)。
 * 复用 cli 现有 tools/safety/systemPrompt 构造(print-mode 同源),注入
 * InProcessAgentRunner 让 agent 真改文件(Step 5:带 tools 真改验证)。
 *
 * index.ts loop 路由调用,传入 runLoopMode opts.tools/systemPrompt/safety;
 * loop-mode 默认 [](reply-only),Step 5 注入后 agent 可 read/edit/write/bash/grep/glob。
 * safety 不传 askHandler → ask 降级 deny(同 print/rpc,无交互通道)。
 */
import {
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createGlobTool,
} from "../tools/index.js";
import { createSystemPromptWithSkills, defaultSkillDirs } from "../system-prompt.js";
import { createSafetyGuard } from "@agentforge/harness";
import { DEFAULT_SYSTEM_PROMPT } from "../print-mode.js";

export interface LoopAgentDeps {
	tools: any[];
	systemPrompt: string;
	safety: any;
}

export function createLoopAgentDeps(): LoopAgentDeps {
	return {
		tools: [
			createReadTool(),
			createBashTool(),
			createEditTool(),
			createWriteTool(),
			createGrepTool(),
			createGlobTool(),
		],
		systemPrompt: createSystemPromptWithSkills(
			DEFAULT_SYSTEM_PROMPT,
			defaultSkillDirs(),
		),
		safety: createSafetyGuard(),
	};
}
