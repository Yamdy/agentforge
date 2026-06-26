import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";

/**
 * @internal Slice 0 脚手架验证：pi 核心依赖可加载。
 * Task 5 将以正式 AgentForgeHarness 类替换。
 */
export const _piAgentCoreAvailable = typeof Agent === "function";
export const _piAiAvailable = typeof getModel === "function";

/**
 * 本模块的加载 URL。用于 vitest alias 防回归测试（见 cli/src/resolve.test.ts）：
 * 断言含 "harness/src" 以确保 @agentforge/harness 经 vitest alias 解析到源码而非 dist。
 */
export const __MODULE_URL__ = import.meta.url;

export * from "./events.js";
export * from "./session.js";
export * from "./jsonl-storage.js";
export * from "./compaction.js";
export * from "./skills.js";
export * from "./context-budget.js";
export * from "./safety.js";
export * from "./harness.js";
export * from "./verification.js";
export * from "./instinct.js";
export * from "./audit.js";
export * from "./adr.js";
