import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const execAsync = promisify(exec);

/** bash 工具参数 schema。见 ARCHITECTURE.md §5, §9。 */
const bashSchema = Type.Object({
  command: Type.String({ description: "要执行的 shell 命令" }),
  timeout: Type.Optional(Type.Number({ description: "超时 ms" })),
});

export type BashToolInput = Static<typeof bashSchema>;

/** bash 工具返回的 details（不进 LLM，供 UI/audit）。 */
export interface BashToolDetails {
  command: string;
  exitCode: number | null;
  durationMs?: number;
}

/**
 * 内置 bash 工具：执行 shell 命令，返回 stdout+stderr。
 * content 进 LLM；details 供 UI/audit。非零退出码 throw（loop 转成 isError tool result）。
 */
export function createBashTool(cwd?: string): AgentTool<typeof bashSchema, BashToolDetails> {
  const c = cwd ?? process.cwd();
  return {
    name: "bash",
    label: "Bash",
    description: "执行 shell 命令，返回 stdout 与 stderr。非零退出码视为失败。",
    parameters: bashSchema,
    async execute(_toolCallId, { command, timeout }) {
      const startedAt = Date.now();
      const timeoutMs = timeout && timeout > 0 ? timeout : undefined;

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: c,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        });
        const durationMs = Date.now() - startedAt;
        const text = (stdout + (stderr ? stderr : "")).trimEnd();
        return {
          content: [{ type: "text", text }],
          details: { command, exitCode: 0, durationMs },
        };
      } catch (err: unknown) {
        const durationMs = Date.now() - startedAt;
        const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
        const stdout = e.stdout ?? "";
        const stderr = e.stderr ?? "";
        const combined = (stdout + (stderr ? stderr : "")).trimEnd();
        const exitCode =
          typeof e.code === "number" ? e.code : null;
        // 非零退出码：throw（保持失败语义一致，loop 转 isError）。
        const detail: BashToolDetails = { command, exitCode, durationMs };
        const msg = combined
          ? `${combined}\n\nCommand exited with code ${exitCode}`
          : `Command exited with code ${exitCode}`;
        const error = new Error(msg) as Error & { details?: BashToolDetails };
        error.details = detail;
        throw error;
      }
    },
  };
}
