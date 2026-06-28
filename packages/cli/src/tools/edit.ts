import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

/** edit 工具参数 schema。见 ARCHITECTURE.md §5, §9。 */
const editSchema = Type.Object({
  path: Type.String({ description: "要编辑的文件路径（相对路径基于 cwd 解析）" }),
  old_string: Type.String({ description: "要替换的精确文本（必须唯一，除非 replace_all）" }),
  new_string: Type.String({ description: "替换后的文本" }),
  replace_all: Type.Optional(
    Type.Boolean({ description: "替换所有出现，默认 false" }),
  ),
});

export type EditToolInput = Static<typeof editSchema>;

/** edit 工具返回的 details（不进 LLM，供 UI/audit）。 */
export interface EditToolDetails {
  path: string;
  replacements: number;
}

/**
 * 内置 edit 工具：精确字符串替换。
 * content 进 LLM；details 供 UI/audit。文件不存在 / old_string 不唯一 / 不存在时 throw
 * （loop 转成 isError tool result）。
 */
export function createEditTool(cwd?: string): AgentTool<typeof editSchema, EditToolDetails> {
  // 红队 #6: cwd 默认必须在构造器内确定（防 resolve(undefined) throw）。
  const c = cwd ?? process.cwd();
  return {
    name: "edit",
    label: "Edit",
    description: "精确字符串替换编辑文件。old_string 默认必须唯一，replace_all=true 时全部替换。",
    parameters: editSchema,
    async execute(_toolCallId, { path, old_string, new_string, replace_all }) {
      // 红队 #2: 绝对路径直用（isAbsolute 短路）是 by design，containment 靠 worktree 探索路径机制。
      const resolved = isAbsolute(path) ? path : resolve(c, path);
      // 读文件；不存在→throw（loop 转 isError）。
      const content = await readFile(resolved, "utf-8");

      // 统计 old_string 出现次数。
      const occurrences = content.split(old_string).length - 1;

      let newContent: string;
      let replacements: number;

      if (replace_all === true) {
        if (occurrences === 0) {
          throw new Error(`old_string not found in ${resolved}`);
        }
        newContent = content.split(old_string).join(new_string);
        replacements = occurrences;
      } else {
        // replace_all 为 false 或 undefined：必须唯一。
        if (occurrences !== 1) {
          throw new Error(
            `old_string must be unique in file (found ${occurrences} occurrences)`,
          );
        }
        newContent = content.replace(old_string, new_string);
        replacements = 1;
      }

      await writeFile(resolved, newContent, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: `Edited ${resolved} (${replacements} replacement${replacements === 1 ? "" : "s"})`,
          },
        ],
        details: { path: resolved, replacements },
      };
    },
  };
}
