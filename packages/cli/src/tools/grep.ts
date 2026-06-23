import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const execAsync = promisify(exec);

/** grep 工具参数 schema。基于 ripgrep (rg)。见 ARCHITECTURE.md §5。 */
const grepSchema = Type.Object({
  pattern: Type.String({ description: "正则表达式" }),
  path: Type.Optional(Type.String({ description: "搜索目录或文件，默认 cwd" })),
  glob: Type.Optional(Type.String({ description: "文件名 glob 过滤" })),
  output_mode: Type.Optional(
    Type.Union(
      [Type.Literal("content"), Type.Literal("files_with_matches"), Type.Literal("count")],
      { description: "默认 content" },
    ),
  ),
  "-n": Type.Optional(Type.Boolean({ description: "显示行号" })),
  "-i": Type.Optional(Type.Boolean({ description: "忽略大小写" })),
  "-C": Type.Optional(Type.Number({ description: "上下文行数" })),
});

export type GrepToolInput = Static<typeof grepSchema>;

/** grep 工具返回的 details（不进 LLM，供 UI/audit）。 */
export interface GrepToolDetails {
  exitCode: number;
  truncated?: boolean;
}

/**
 * 内置 grep 工具：基于 ripgrep (rg) 搜索。
 * content 进 LLM；details 供 UI/audit。
 * rg 无匹配退出码=1（非错误）：返回空 content，不 throw。
 * rg 不存在 → throw "ripgrep (rg) not installed"。
 *
 * 环境要求：PATH 需有真实 rg 可执行文件（经 node:child_process exec 调用）。
 * Claude Code 内置 bash 的 rg 是 shell function（路由 claude.exe 包装器），node exec 不可调——
 * 会话内真对话时 grep 会 throw，LLM 收到 error 可改用 bash 工具替代；用户独立终端运行
 * agentforge 需自装 ripgrep（cargo install ripgrep / scoop install ripgrep）。glob 工具无此依赖。
 * 详见 ARCHITECTURE.md §5。
 */
export function createGrepTool(): AgentTool<typeof grepSchema, GrepToolDetails> {
  return {
    name: "grep",
    label: "Grep",
    description: "基于 ripgrep 的正则搜索。无匹配返回空（rg 退出码 1 非错误）。",
    parameters: grepSchema,
    async execute(_toolCallId, params) {
      const { pattern, path, glob, output_mode } = params;

      const cmd: string[] = ["rg", pattern];

      if (output_mode === "files_with_matches") {
        cmd.push("--files-with-matches");
      } else if (output_mode === "count") {
        cmd.push("--count");
      }
      // 默认 content：rg 默认输出匹配行，不加 flag。

      if (params["-n"]) cmd.push("-n");
      if (params["-i"]) cmd.push("-i");
      if (params["-C"] !== undefined) {
        cmd.push("-C", String(params["-C"]));
      }
      if (glob) cmd.push("--glob", glob);
      if (path) cmd.push(path);

      try {
        const { stdout } = await execAsync(cmd.join(" "), {
          maxBuffer: 10 * 1024 * 1024,
        });
        return {
          content: [{ type: "text", text: stdout.trimEnd() }],
          details: { exitCode: 0 },
        };
      } catch (err: unknown) {
        const e = err as {
          stdout?: string;
          stderr?: string;
          code?: number | string;
          message?: string;
        };
        const code = typeof e.code === "number" ? e.code : undefined;
        const stderr = e.stderr ?? "";
        const stdout = e.stdout ?? "";

        // rg 无匹配退出码=1（非错误）：返回空 content，不 throw。
        if (code === 1) {
          return {
            content: [{ type: "text", text: "" }],
            details: { exitCode: 1 },
          };
        }

        // rg 不存在（ENOENT / code 未定义且 stderr 含 not found）
        if (
          code === undefined &&
          (/not found/i.test(stderr) || /not found/i.test(e.message ?? ""))
        ) {
          throw new Error("ripgrep (rg) not installed");
        }

        // 其他非零退出码 → throw（带 stderr）
        const combined = (stdout + (stderr ? stderr : "")).trimEnd();
        const msg = combined
          ? `${combined}\n\nrg exited with code ${code}`
          : `rg exited with code ${code}`;
        throw new Error(msg);
      }
    },
  };
}
