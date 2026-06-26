/**
 * ADR 模块（Slice 5 Task 6）。
 *
 * recordAdr 写 `docs/adr/<NNNN>-<slug>.md`（markdown 模板）并返回路径；
 * listAdrs 读回目录下所有 *.md 解析为 AdrRecord。
 *
 * 设计要点（red-team Advisory 7）：ADR 模块 **不 emit** 任何事件
 * （adr_recorded 无 consumer，仅 theater）。recordAdr 只写文件返路径。
 * IO 错误 try/catch：recordAdr 失败不抛（返空串）；listAdrs 失败返 []。
 *
 * 见 docs/superpowers/specs/2026-06-25-slice5-audit-adr-council-design.md §4.2。
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** ADR 记录（见 spec §4.2）。 */
export interface AdrRecord {
  /** NNNN 形式 id。 */
  id: string;
  title: string;
  context: string;
  decision: string;
  alternatives: string[];
  consequences: string;
}

/** 默认 ADR 输出子目录（相对 opts.dir 根）。 */
const ADR_SUBDIR = path.join("docs", "adr");

/**
 * 从 title 派生 slug（kebab-case）。
 * 规则：小写 → 非字母数字/连字符序列替为单连字符 → 去首尾连字符。
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 渲染 ADR markdown 模板。包含 Context/Decision/Alternatives/Consequences 段。
 */
function renderMarkdown(record: AdrRecord): string {
  const alts =
    record.alternatives.length > 0
      ? record.alternatives.map((a) => `- ${a}`).join("\n")
      : "- (none)";
  return [
    `# ADR ${record.id}: ${record.title}`,
    "",
    "## Context",
    "",
    record.context,
    "",
    "## Decision",
    "",
    record.decision,
    "",
    "## Alternatives",
    "",
    alts,
    "",
    "## Consequences",
    "",
    record.consequences,
    "",
  ].join("\n");
}

/**
 * 写 ADR markdown 文件到 `<dir>/docs/adr/<id>-<slug>.md`，返回绝对路径。
 * 无 emit。IO 错 try/catch：失败时返空串（不抛）。
 */
export function recordAdr(record: AdrRecord, opts?: { dir?: string }): string {
  try {
    const root = opts?.dir ?? process.cwd();
    const dir = path.join(root, ADR_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    const slug = slugify(record.title);
    const filename = `${record.id}-${slug}.md`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, renderMarkdown(record), "utf8");
    return filepath;
  } catch {
    return "";
  }
}

/**
 * 读 `<dir>/docs/adr/*.md` 解析为 AdrRecord 列表。IO 错返 []。
 * 解析：从 markdown 还原 id/title/context/decision/alternatives/consequences。
 */
export function listAdrs(opts?: { dir?: string }): AdrRecord[] {
  try {
    const root = opts?.dir ?? process.cwd();
    const dir = path.join(root, ADR_SUBDIR);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    const records: AdrRecord[] = [];
    for (const f of files) {
      const rec = parseAdrFile(path.join(dir, f));
      if (rec) records.push(rec);
    }
    return records;
  } catch {
    return [];
  }
}

/** 从 markdown 文件解析回 AdrRecord。解析失败返 null。 */
function parseAdrFile(filepath: string): AdrRecord | null {
  try {
    const content = fs.readFileSync(filepath, "utf8");
    const basename = path.basename(filepath, ".md");
    // <id>-<slug>.md → id 取首个连字符前。
    const id = basename.split("-")[0] ?? "";

    // 标题行：# ADR <id>: <title>
    const titleMatch = content.match(/^#\s+ADR\s+\S+:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : basename;

    const section = (name: string): string => {
      // 匹配 ## <name> 到下一个 ## 或文末。
      const re = new RegExp(`^##\\s+${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "m");
      const m = content.match(re);
      return m ? m[1].trim() : "";
    };

    const context = section("Context");
    const decision = section("Decision");
    const alternativesRaw = section("Alternatives");
    const alternatives = alternativesRaw
      .split("\n")
      .map((l) => l.replace(/^-\s*/, "").trim())
      .filter((l) => l.length > 0 && l !== "(none)");
    const consequences = section("Consequences");

    return { id, title, context, decision, alternatives, consequences };
  } catch {
    return null;
  }
}
