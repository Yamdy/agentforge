import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

/** read 工具参数 schema。见 ARCHITECTURE.md §5, §9。 */
const readSchema = Type.Object({
  path: Type.String({ description: "要读取的文件路径（相对路径基于 cwd 解析）" }),
  offset: Type.Optional(Type.Number({ description: "起始行(1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "最多行数" })),
});

export type ReadToolInput = Static<typeof readSchema>;

/** read 工具返回的 details（不进 LLM，供 UI/audit）。 */
export interface ReadToolDetails {
  path: string;
  size: number;
  truncation?: { reason: "offset" | "limit"; shownLines: number; totalLines: number };
}

/**
 * 内置 read 工具：读文件，按 offset/limit 切片。
 * content 进 LLM；details 供 UI/audit。文件不存在或 offset 越界 throw。
 */
export function createReadTool(cwd?: string): AgentTool<typeof readSchema, ReadToolDetails> {
  // 红队 #6: cwd 默认必须在构造器内确定（防 resolve(undefined) throw）。
  const c = cwd ?? process.cwd();
  return {
    name: "read",
    label: "Read",
    description: "读取文件内容。支持 offset（1-indexed 起始行）与 limit（最多行数）切片。",
    parameters: readSchema,
    async execute(_toolCallId, { path, offset, limit }) {
      // 红队 #2: 绝对路径直用（isAbsolute 短路）是 by design，containment 靠 worktree 探索路径机制。
      const resolved = isAbsolute(path) ? path : resolve(c, path);
      const buffer = await readFile(resolved);
      const text = buffer.toString("utf-8");
      const allLines = text.split("\n");
      // 末尾换行产生空尾行，去掉以匹配行数语义。
      const trimmed = allLines[allLines.length - 1] === "" ? allLines.slice(0, -1) : allLines;
      const totalLines = trimmed.length;

      const startLine = offset ? Math.max(0, offset - 1) : 0;
      if (startLine >= trimmed.length && trimmed.length > 0) {
        throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
      }
      if (trimmed.length === 0 && startLine > 0) {
        throw new Error(`Offset ${offset} is beyond end of file (0 lines total)`);
      }

      let selected: string[];
      let truncation: ReadToolDetails["truncation"] | undefined;
      if (limit !== undefined) {
        const endLine = Math.min(startLine + limit, trimmed.length);
        selected = trimmed.slice(startLine, endLine);
        if (endLine < trimmed.length) {
          truncation = { reason: "limit", shownLines: selected.length, totalLines };
        }
      } else {
        selected = trimmed.slice(startLine);
        if (startLine > 0) {
          truncation = { reason: "offset", shownLines: selected.length, totalLines };
        }
      }

      const outputText = selected.join("\n");
      return {
        content: [{ type: "text", text: outputText }],
        details: { path: resolved, size: text.length, truncation },
      };
    },
  };
}
