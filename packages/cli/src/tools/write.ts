import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

/** write 工具参数 schema。见 ARCHITECTURE.md §5, §9。 */
const writeSchema = Type.Object({
  path: Type.String({ description: "要写入的文件路径（相对路径基于 cwd 解析）" }),
  content: Type.String({ description: "文件内容" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/** write 工具返回的 details（不进 LLM，供 UI/audit）。 */
export interface WriteToolDetails {
  path: string;
  bytes: number;
  created: boolean;
}

/**
 * 内置 write 工具：写文件，父目录不存在自动建。
 * content 进 LLM；details 供 UI/audit。文件已存在则覆盖。
 */
export function createWriteTool(cwd?: string): AgentTool<typeof writeSchema, WriteToolDetails> {
  // 红队 #6: cwd 默认必须在构造器内确定（防 resolve(undefined) throw）。
  const c = cwd ?? process.cwd();
  return {
    name: "write",
    label: "Write",
    description: "写入文件内容。父目录不存在自动创建；文件已存在则覆盖。",
    parameters: writeSchema,
    async execute(_toolCallId, { path, content }) {
      // 红队 #2: 绝对路径直用（isAbsolute 短路）是 by design，containment 靠 worktree 探索路径机制。
      const resolved = isAbsolute(path) ? path : resolve(c, path);
      const created = !existsSync(resolved);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
      return {
        content: [{ type: "text", text: `Wrote ${content.length} bytes to ${resolved}` }],
        details: { path: resolved, bytes: content.length, created },
      };
    },
  };
}
