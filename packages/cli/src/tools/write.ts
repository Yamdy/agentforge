import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

/** write 工具参数 schema。见 ARCHITECTURE.md §5, §9。 */
const writeSchema = Type.Object({
  path: Type.String({ description: "要写入的文件绝对路径" }),
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
export function createWriteTool(): AgentTool<typeof writeSchema, WriteToolDetails> {
  return {
    name: "write",
    label: "Write",
    description: "写入文件内容。父目录不存在自动创建；文件已存在则覆盖。",
    parameters: writeSchema,
    async execute(_toolCallId, { path, content }) {
      const created = !existsSync(path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return {
        content: [{ type: "text", text: `Wrote ${content.length} bytes to ${path}` }],
        details: { path, bytes: content.length, created },
      };
    },
  };
}
