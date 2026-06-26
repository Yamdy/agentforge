/**
 * Gate 接口 + LocalBuildGate(spec §4.2)。
 *
 * LocalBuildGate:依次 exec commands,任一非 0 退出 → passed=false(短路)。
 * 默认 commands = ["pnpm -r typecheck", "pnpm -r test"](可配 gateCommands 降单包)。
 * output = 合并 stdout+stderr(失败时含错误,供 notes 喂下轮 agent)。
 *
 * 未来若需 CI 支持(gh pr checks)重新评估接口(spec red-team 🟡4)。
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface GateResult {
	passed: boolean;
	output: string;
}

export interface Gate {
	run(): Promise<GateResult>;
}

export interface LocalBuildGateOptions {
	cwd: string;
	commands?: string[];
}

const DEFAULT_COMMANDS = ["pnpm -r typecheck", "pnpm -r test"];

export class LocalBuildGate implements Gate {
	private readonly cwd: string;
	private readonly commands: string[];

	constructor(opts: LocalBuildGateOptions) {
		this.cwd = opts.cwd;
		this.commands = opts.commands ?? DEFAULT_COMMANDS;
	}

	async run(): Promise<GateResult> {
		const outputs: string[] = [];
		for (const cmd of this.commands) {
			try {
				const { stdout, stderr } = await execAsync(cmd, {
					cwd: this.cwd,
					maxBuffer: 10 * 1024 * 1024,
				});
				outputs.push(stdout.toString(), stderr.toString());
			} catch (e: unknown) {
				const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
				outputs.push(
					err.stdout?.toString() ?? "",
					err.stderr?.toString() ?? "",
					err.message ?? String(e),
				);
				return { passed: false, output: outputs.filter(Boolean).join("\n") };
			}
		}
		return { passed: true, output: outputs.filter(Boolean).join("\n") };
	}
}
