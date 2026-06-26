import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { recordAdr, listAdrs, type AdrRecord } from "./adr.js";

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
