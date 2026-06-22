/**
 * Safety 模块。见 ARCHITECTURE.md §4.6。
 *
 * 工具执行权限：allow/deny/ask 规则引擎 + freeze mode（锁定可写目录）+ 破坏性命令拦截。
 * pi 无内置权限，完全自写。挂到 pi Agent 的 beforeToolCall（返回 deny 时 block）。
 */
import path from "node:path";
import fs from "node:fs";

export type SafetyVerdict = "allow" | "deny" | "ask";

export interface SafetyContext {
	toolName: string;
	args: unknown;
	cwd: string;
	frozenAllowDir?: string;
}

export interface SafetyRules {
	bashDenyPatterns: RegExp[];
	bashAskPatterns: RegExp[];
}

export const DEFAULT_SAFETY_RULES: SafetyRules = {
	bashDenyPatterns: [
		/rm\s+-rf/,
		/git\s+push\s+--force/,
		/git\s+push\s+-f/,
		/git\s+reset\s+--hard/,
		/DROP\s+TABLE/i,
		/DELETE\s+FROM/i,
		/chmod\s+-R\s+777/,
		/(\bcurl\b|\bwget\b).*\|\s*(sh|bash)/,
		/>\/dev\/(sd|nvme|disk)/,
	],
	bashAskPatterns: [/\bgit\s+push\b/, /\bnpm\s+publish\b/, /\brm\s+[^-]/],
};

export interface SafetyGuard {
	check(ctx: SafetyContext): SafetyVerdict;
	freeze(allowDir: string): void;
	unfreeze(): void;
}

/**
 * 创建 SafetyGuard。传入 rules 则完全覆盖默认（非合并）。
 */
export function createSafetyGuard(rules?: Partial<SafetyRules>): SafetyGuard {
	const effective: SafetyRules = rules
		? {
				bashDenyPatterns: rules.bashDenyPatterns ?? DEFAULT_SAFETY_RULES.bashDenyPatterns,
				bashAskPatterns: rules.bashAskPatterns ?? DEFAULT_SAFETY_RULES.bashAskPatterns,
			}
		: { ...DEFAULT_SAFETY_RULES };

	let frozenAllowDir: string | undefined;

	return {
		check(ctx: SafetyContext): SafetyVerdict {
			const { toolName, args } = ctx;
			if (toolName === "bash") {
				const command = (args as { command?: string })?.command ?? "";
				for (const p of effective.bashDenyPatterns) {
					if (p.test(command)) return "deny";
				}
				for (const p of effective.bashAskPatterns) {
					if (p.test(command)) return "ask";
				}
				return "allow";
			}
			if (toolName === "write") {
				const p = (args as { path?: string })?.path ?? "";
				if (frozenAllowDir) {
					const resolved = path.resolve(ctx.cwd, p);
					const allowed = path.resolve(ctx.cwd, frozenAllowDir);
					if (!resolved.startsWith(allowed)) return "deny";
				}
				if (fs.existsSync(path.resolve(ctx.cwd, p))) return "ask";
				return "allow";
			}
			if (toolName === "edit") {
				const p = (args as { path?: string })?.path ?? "";
				if (frozenAllowDir) {
					const resolved = path.resolve(ctx.cwd, p);
					const allowed = path.resolve(ctx.cwd, frozenAllowDir);
					if (!resolved.startsWith(allowed)) return "deny";
				}
				return "allow";
			}
			// read/grep/glob/ls 及其他工具：allow
			return "allow";
		},
		freeze(allowDir: string): void {
			frozenAllowDir = allowDir;
		},
		unfreeze(): void {
			frozenAllowDir = undefined;
		},
	};
}
