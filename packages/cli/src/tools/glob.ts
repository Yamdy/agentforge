import { readdirSync, type Dirent } from "node:fs";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

/** glob 工具参数 schema。见 ARCHITECTURE.md §5。 */
const globSchema = Type.Object({
  pattern: Type.String({ description: "glob 模式，支持 ** * ? {a,b}" }),
  path: Type.Optional(Type.String({ description: "搜索根目录，默认 cwd" })),
});

export type GlobToolInput = Static<typeof globSchema>;

/** glob 工具返回的 details（不进 LLM，供 UI/audit）。 */
export interface GlobToolDetails {
  count: number;
  truncated?: boolean;
}

const MAX_FILES = 1000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

/**
 * glob 模式转 RegExp。
 * - ** → .*（跨目录）  * → [^/]*（单层）  ? → [^/]  {a,b} → (a|b)
 * - 起始无 ** 时，pattern 隐含锚定 baseDir（相对路径匹配）
 */
export function globToRegExp(pattern: string): RegExp {
  // 先转义正则特殊字符，但保留 glob 元字符 * ? { } 。
  let i = 0;
  let out = "";
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** 跨目录（吞噬相邻 /）
        out += ".*";
        i += 2;
        // 跳过紧跟的 /（**/ 中的 / 由 .* 吸收）
        if (pattern[i] === "/") i += 1;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (ch === "{") {
      // {a,b} → (a|b)，组内字面量转义
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        out += "\\{";
        i += 1;
        continue;
      }
      const inner = pattern.slice(i + 1, end);
      const parts = inner.split(",").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      out += "(?:" + parts.join("|") + ")";
      i = end + 1;
      continue;
    }
    // 转义正则元字符（排除已处理的 * ? { } 与 / ）
    if ("\\^$.|+()[]".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
    i += 1;
  }
  return new RegExp("^(?:" + out + ")$");
}

/**
 * 递归收集 baseDir 下相对路径（/ 分隔），跳过 node_modules / .git / dist。
 */
function collectFiles(baseDir: string): string[] {
  const results: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), prefix + entry.name + "/");
      } else {
        results.push(prefix + entry.name);
      }
    }
  };
  walk(baseDir, "");
  return results;
}

// node:path join 用相对路径分隔符（Windows 为 \），统一转 /。
function join(a: string, b: string): string {
  return (a.endsWith("/") ? a + b : a + "/" + b).split("\\").join("/");
}

/**
 * 内置 glob 工具：按 glob 模式匹配文件路径。
 * content 进 LLM；details 供 UI/audit。匹配数上限 1000，超出 truncated=true。
 */
export function createGlobTool(cwd?: string): AgentTool<typeof globSchema, GlobToolDetails> {
  const c = cwd ?? process.cwd();
  return {
    name: "glob",
    label: "Glob",
    description: "按 glob 模式匹配文件路径（支持 ** * ? {a,b}）。返回相对 baseDir 的路径列表。",
    parameters: globSchema,
    async execute(_toolCallId, { pattern, path }) {
      const baseDir = path ?? c;
      const all = collectFiles(baseDir);
      const rx = globToRegExp(pattern);
      const matched = all.filter((p) => rx.test(p)).sort();
      const truncated = matched.length > MAX_FILES;
      const files = truncated ? matched.slice(0, MAX_FILES) : matched;
      const text = files.join("\n");
      return {
        content: [{ type: "text", text }],
        details: { count: files.length, truncated: truncated ? true : undefined },
      };
    },
  };
}
