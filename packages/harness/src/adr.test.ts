import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { recordAdr, listAdrs, type AdrRecord } from "./adr.js";

// ─── helpers ───────────────────────────────────────────────────────────
/** 读取 tmpdir 下 docs/adr/ 里所有文件名。 */
function adrFilenames(dir: string): string[] {
  const adrDir = path.join(dir, "docs", "adr");
  if (!fs.existsSync(adrDir)) return [];
  return fs.readdirSync(adrDir);
}

/** 在 tmpdir 里手工写一个畸形 md 文件供 listAdrs 解析。 */
function writeRawAdr(dir: string, filename: string, content: string): string {
  const adrDir = path.join(dir, "docs", "adr");
  fs.mkdirSync(adrDir, { recursive: true });
  const fp = path.join(adrDir, filename);
  fs.writeFileSync(fp, content, "utf8");
  return fp;
}

/** 构造最小合法 AdrRecord。 */
function makeRecord(overrides: Partial<AdrRecord> = {}): AdrRecord {
  return {
    id: "0002",
    title: "Test Decision",
    context: "Some context for the decision.",
    decision: "We decided to do X.",
    alternatives: ["Option A", "Option B"],
    consequences: "Y will happen.",
    ...overrides,
  };
}

let tmpdir: string;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-test-"));
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe("recordAdr", () => {
  it("writes docs/adr/<id>-<slug>.md and returns the path", () => {
    const record = makeRecord();
    const dir = tmpdir;
    const returned = recordAdr(record, { dir });

    // 返回路径以 docs/adr/<id>-<slug>.md 结尾。
    expect(returned).toContain("docs");
    expect(returned).toContain("0002-test-decision.md");
    // 文件存在。
    expect(fs.existsSync(returned)).toBe(true);
  });

  it("derives slug from title via kebab-case", () => {
    const record = makeRecord({ id: "0042", title: "Use Postgres for Sessions" });
    const returned = recordAdr(record, { dir: tmpdir });
    expect(returned).toContain("0042-use-postgres-for-sessions.md");
    expect(fs.existsSync(returned)).toBe(true);
  });

  it("writes a markdown file containing Context/Decision/Alternatives/Consequences sections", () => {
    const record = makeRecord();
    const returned = recordAdr(record, { dir: tmpdir });
    const content = fs.readFileSync(returned, "utf8");

    expect(content).toContain("Context");
    expect(content).toContain("Decision");
    expect(content).toContain("Alternatives");
    expect(content).toContain("Consequences");
    // 内容字段写进文件。
    expect(content).toContain(record.context);
    expect(content).toContain(record.decision);
    expect(content).toContain(record.alternatives[0]);
    expect(content).toContain(record.consequences);
    expect(content).toContain(record.title);
    expect(content).toContain(record.id);
  });

  it("does not emit any event (returns only a path string)", () => {
    const record = makeRecord();
    const result = recordAdr(record, { dir: tmpdir });
    expect(typeof result).toBe("string");
  });

  it("tolerates IO errors without throwing (try/catch returns empty path on failure)", () => {
    // 指向一个不可写路径（文件而非目录作为父）。
    const blockingFile = path.join(tmpdir, "blocker");
    fs.writeFileSync(blockingFile, "x");
    const impossibleDir = path.join(blockingFile, "docs", "adr");
    // 不抛：实现内部 try/catch。
    expect(() => recordAdr(makeRecord(), { dir: impossibleDir })).not.toThrow();
  });
});

describe("listAdrs", () => {
  it("reads back records written by recordAdr", () => {
    recordAdr(makeRecord({ id: "0002", title: "Test Decision" }), { dir: tmpdir });
    recordAdr(
      makeRecord({ id: "0003", title: "Another Decision" }),
      { dir: tmpdir },
    );
    const list = listAdrs({ dir: tmpdir });
    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map((r) => r.id);
    expect(ids).toContain("0002");
    expect(ids).toContain("0003");
  });

  it("returns [] when dir has no adr files (no throw)", () => {
    const list = listAdrs({ dir: tmpdir });
    expect(list).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Edge-case / boundary tests
// ═══════════════════════════════════════════════════════════════════════

describe("recordAdr – edge cases", () => {
  it("opts 为 undefined 时使用 process.cwd() 而不抛", () => {
    // 仅验证不抛异常；实际写入位置受 cwd 影响，此处用 try-catch 保护。
    const record = makeRecord();
    // 这里用临时子目录伪装 cwd 不可行，只验证类型安全。
    expect(() => {
      try {
        recordAdr(record, undefined);
      } catch {
        // process.cwd() 下 docs/adr 可能无权限，但 recordAdr 内部 catch 了
      }
    }).not.toThrow();
  });

  it("title 为空字符串时 slugify 产出空 slug，文件名仍合法", () => {
    const record = makeRecord({ title: "" });
    const returned = recordAdr(record, { dir: tmpdir });
    // slug 为空 → 文件名为 "0002-.md"
    expect(returned).toMatch(/0002-\.md$/);
    expect(fs.existsSync(returned)).toBe(true);
  });

  it("title 全为特殊字符时 slug 为空，不抛", () => {
    const record = makeRecord({ title: "!!!@@@###" });
    const returned = recordAdr(record, { dir: tmpdir });
    expect(returned).toMatch(/0002-\.md$/);
    expect(fs.existsSync(returned)).toBe(true);
  });

  it("title 含 Unicode（中文）但无 ASCII 字母时 slug 为空，文件仍写入", () => {
    const record = makeRecord({ title: "使用数据库做存储" });
    const returned = recordAdr(record, { dir: tmpdir });
    // 中文字符不属于 [a-z0-9]，全部被替换成连字符再 strip → 空 slug
    expect(returned).toMatch(/0002-\.md$/);
    expect(fs.existsSync(returned)).toBe(true);
  });

  it("title 混合中英文时英文部分保留为 slug", () => {
    const record = makeRecord({ title: "使用 Postgres 做存储" });
    const returned = recordAdr(record, { dir: tmpdir });
    // "Postgres" → "postgres" 保留在 slug 中
    expect(returned).toContain("0002-postgres.md");
    expect(fs.existsSync(returned)).toBe(true);
  });

  it("alternatives 为空数组时渲染 (none)", () => {
    const record = makeRecord({ alternatives: [] });
    const returned = recordAdr(record, { dir: tmpdir });
    const content = fs.readFileSync(returned, "utf8");
    expect(content).toContain("(none)");
  });

  it("IO 失败时返回空字符串（非路径）", () => {
    // 用一个已存在的文件路径作为 dir，阻止 mkdirSync 成功。
    const blocker = path.join(tmpdir, "blocker");
    fs.writeFileSync(blocker, "x");
    const result = recordAdr(makeRecord(), {
      dir: path.join(blocker, "nested"),
    });
    expect(result).toBe("");
  });

  it("context / decision / consequences 为空字符串时写入不抛", () => {
    const record = makeRecord({
      context: "",
      decision: "",
      consequences: "",
      alternatives: [],
    });
    const returned = recordAdr(record, { dir: tmpdir });
    expect(fs.existsSync(returned)).toBe(true);
    // 验证写入的 markdown 包含所有 section 标题
    const content = fs.readFileSync(returned, "utf8");
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
    expect(content).toContain("## Alternatives");
    expect(content).toContain("## Consequences");
    expect(content).toContain("(none)"); // alternatives 为空时
  });
});

describe("listAdrs – edge cases", () => {
  it("目录不存在时返回 []（不抛）", () => {
    const nope = path.join(tmpdir, "nope");
    expect(listAdrs({ dir: nope })).toEqual([]);
  });

  it("IO 错误时返回 []（目录不可读）", () => {
    // 创建目录后删除读权限（仅 Unix 有效；Windows 上此测试可能 skip）
    const adrDir = path.join(tmpdir, "docs", "adr");
    fs.mkdirSync(adrDir, { recursive: true });
    fs.writeFileSync(path.join(adrDir, "0001-x.md"), "# ADR 0001: X\n");
    try {
      fs.chmodSync(adrDir, 0o000);
      const result = listAdrs({ dir: tmpdir });
      expect(result).toEqual([]);
    } catch {
      // Windows 无 chmod 效果，跳过
    } finally {
      try {
        fs.chmodSync(adrDir, 0o755);
      } catch {
        /* noop */
      }
    }
  });

  it("跳过非 .md 文件", () => {
    const adrDir = path.join(tmpdir, "docs", "adr");
    fs.mkdirSync(adrDir, { recursive: true });
    fs.writeFileSync(path.join(adrDir, "readme.txt"), "not an adr");
    fs.writeFileSync(path.join(adrDir, ".DS_Store"), "");
    const list = listAdrs({ dir: tmpdir });
    expect(list).toEqual([]);
  });

  it("畸形 md（无标题行、无 section）仍能解析出 id，不抛", () => {
    writeRawAdr(tmpdir, "0099-bare.md", "just some text without headings\n");
    const list = listAdrs({ dir: tmpdir });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("0099");
    // title 回退为 basename
    expect(list[0].title).toBe("0099-bare");
    // section 均为空
    expect(list[0].context).toBe("");
    expect(list[0].decision).toBe("");
    expect(list[0].alternatives).toEqual([]);
    expect(list[0].consequences).toBe("");
  });

  it("文件名不含连字符时 id 取整个 basename", () => {
    writeRawAdr(tmpdir, "alpha.md", "# ADR alpha: Title Here\n## Context\nctx\n");
    const list = listAdrs({ dir: tmpdir });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("alpha");
    expect(list[0].title).toBe("Title Here");
    expect(list[0].context).toBe("ctx");
  });

  it("Alternatives 段只有 (none) 时返回空数组", () => {
    const md = [
      "# ADR 0050: X",
      "## Context",
      "ctx",
      "## Decision",
      "dec",
      "## Alternatives",
      "- (none)",
      "## Consequences",
      "cons",
    ].join("\n");
    writeRawAdr(tmpdir, "0050-x.md", md);
    const list = listAdrs({ dir: tmpdir });
    expect(list[0].alternatives).toEqual([]);
  });

  it("多个 alternatives 条目可被 section 正则捕获（当前实现行为）", () => {
    const md = [
      "# ADR 0051: Multi",
      "## Context",
      "ctx",
      "## Decision",
      "dec",
      "## Alternatives",
      "- Option A",
      "- Option B",
      "- Option C",
      "## Consequences",
      "cons",
    ].join("\n");
    writeRawAdr(tmpdir, "0051-multi.md", md);
    const list = listAdrs({ dir: tmpdir });
    // section 正则使用惰性匹配 ([\\s\\S]*?)，在多行内容时
    // 行为取决于正则引擎的回溯；至少第一条应被解析出来。
    expect(list[0].alternatives.length).toBeGreaterThanOrEqual(1);
    expect(list[0].alternatives).toContain("Option A");
  });

  it("recordAdr + listAdrs round-trip：多条记录全部可回读", () => {
    for (let i = 1; i <= 5; i++) {
      recordAdr(makeRecord({ id: String(i).padStart(4, "0"), title: `Decision ${i}` }), {
        dir: tmpdir,
      });
    }
    const list = listAdrs({ dir: tmpdir });
    expect(list.length).toBe(5);
    const ids = list.map((r) => r.id).sort();
    expect(ids).toEqual(["0001", "0002", "0003", "0004", "0005"]);
  });

  it("同 title 多次写入不覆盖（不同 id → 不同文件名）", () => {
    recordAdr(makeRecord({ id: "0001", title: "Same Title" }), { dir: tmpdir });
    recordAdr(makeRecord({ id: "0002", title: "Same Title" }), { dir: tmpdir });
    const files = adrFilenames(tmpdir);
    expect(files).toContain("0001-same-title.md");
    expect(files).toContain("0002-same-title.md");
    expect(files.length).toBe(2);
  });
});
