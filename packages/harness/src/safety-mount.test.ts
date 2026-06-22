/**
 * T2: harness 挂载 Safety 的 TDD 测试。
 * 见 ARCHITECTURE.md §4.6 + harness.ts beforeToolCall 改造。
 *
 * 测试策略：beforeToolCall 闭包在构造时绑定到 pi Agent，外部不可直接调用。
 * 故把安全裁决逻辑暴露为 harness 的可测方法 `applySafety(ctx)`，
 * 构造时 beforeToolCall 闭包转发到此方法。测试直接调 `harness.applySafety`
 * 验证 verdict → block/undefined 映射，并断言 safety.check 收到正确参数。
 */
import { describe, it, expect, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import { AgentForgeHarness } from "./harness.js";
import { createEventBus } from "./events.js";
import { createMemorySession } from "./session.js";
import type { SafetyGuard, SafetyContext } from "./safety.js";

const noopTool: AgentTool = {
	name: "noop",
	label: "Noop",
	description: "does nothing",
	parameters: {} as any,
	execute: async () => ({
		content: [{ type: "text", text: "ok" }],
		details: {},
	}),
};

/** mock streamFn 占位（构造 harness 需要，测试不驱动 prompt）。 */
function noopStreamFn() {
	return {} as any;
}

function makeHarness(opts: {
	safety?: SafetyGuard;
	safetyAskHandler?: (ctx: SafetyContext) => boolean | Promise<boolean>;
	cwd?: string;
} = {}) {
	const events = createEventBus();
	const session = createMemorySession();
	const harness = new AgentForgeHarness({
		session,
		events,
		tools: [noopTool],
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		systemPrompt: "test",
		streamFn: noopStreamFn,
		safety: opts.safety,
		safetyAskHandler: opts.safetyAskHandler,
		cwd: opts.cwd,
	});
	return { harness, events, session };
}

/** 构造一个 mock SafetyGuard，check 返回指定 verdict。 */
function mockSafety(verdict: "allow" | "deny" | "ask"): SafetyGuard {
	return {
		check: vi.fn(() => verdict),
		freeze: vi.fn(),
		unfreeze: vi.fn(),
	};
}

describe("AgentForgeHarness safety mounting (T2)", () => {
	describe("applySafety", () => {
		it("returns undefined when no safety guard is configured (backward compat)", async () => {
			const { harness } = makeHarness();
			const result = await harness.applySafety({
				toolName: "bash",
				args: { command: "ls" },
			});
			expect(result).toBeUndefined();
		});

		it("returns { block: true, reason: 'safety:deny' } when safety.check returns deny", async () => {
			const safety = mockSafety("deny");
			const { harness } = makeHarness({ safety });
			const result = await harness.applySafety({
				toolName: "bash",
				args: { command: "rm -rf /" },
			});
			expect(result).toEqual({ block: true, reason: "safety:deny" });
		});

		it("returns undefined when safety.check returns allow", async () => {
			const safety = mockSafety("allow");
			const { harness } = makeHarness({ safety });
			const result = await harness.applySafety({
				toolName: "bash",
				args: { command: "ls" },
			});
			expect(result).toBeUndefined();
		});

		it("returns undefined when safety.check returns ask and safetyAskHandler returns true", async () => {
			const safety = mockSafety("ask");
			const handler = vi.fn(() => true);
			const { harness } = makeHarness({ safety, safetyAskHandler: handler });
			const result = await harness.applySafety({
				toolName: "bash",
				args: { command: "git push" },
			});
			expect(result).toBeUndefined();
		});

		it("returns { block: true, reason: 'safety:ask-denied' } when safety.check returns ask and safetyAskHandler returns false", async () => {
			const safety = mockSafety("ask");
			const handler = vi.fn(() => false);
			const { harness } = makeHarness({ safety, safetyAskHandler: handler });
			const result = await harness.applySafety({
				toolName: "bash",
				args: { command: "git push" },
			});
			expect(result).toEqual({ block: true, reason: "safety:ask-denied" });
		});

		it("returns { block: true, reason: 'safety:ask-no-handler' } when safety.check returns ask and no safetyAskHandler (degrade to deny)", async () => {
			const safety = mockSafety("ask");
			const { harness } = makeHarness({ safety });
			const result = await harness.applySafety({
				toolName: "bash",
				args: { command: "git push" },
			});
			expect(result).toEqual({ block: true, reason: "safety:ask-no-handler" });
		});

		it("passes correct toolName, args, and cwd to safety.check", async () => {
			const safety = mockSafety("allow");
			const { harness } = makeHarness({ safety, cwd: "/tmp/proj" });
			await harness.applySafety({
				toolName: "write",
				args: { path: "/tmp/proj/a.txt" },
			});
			expect(safety.check).toHaveBeenCalledTimes(1);
			const ctx = (safety.check as any).mock.calls[0][0] as SafetyContext;
			expect(ctx.toolName).toBe("write");
			expect(ctx.args).toEqual({ path: "/tmp/proj/a.txt" });
			expect(ctx.cwd).toBe("/tmp/proj");
		});

		it("defaults cwd to process.cwd() when not provided", async () => {
			const safety = mockSafety("allow");
			const { harness } = makeHarness({ safety });
			await harness.applySafety({
				toolName: "bash",
				args: { command: "ls" },
			});
			const ctx = (safety.check as any).mock.calls[0][0] as SafetyContext;
			expect(ctx.cwd).toBe(process.cwd());
		});

		it("supports async safetyAskHandler", async () => {
			const safety = mockSafety("ask");
			const handler = vi.fn(async () => true);
			const { harness } = makeHarness({ safety, safetyAskHandler: handler });
			const result = await harness.applySafety({
				toolName: "bash",
				args: { command: "git push" },
			});
			expect(result).toBeUndefined();
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});
});
