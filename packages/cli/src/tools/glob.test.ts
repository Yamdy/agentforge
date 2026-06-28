import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGlobTool } from "./glob.js";

describe("glob tool", () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      // Windows EBUSY: git/fs 句柄偶发持锁 temp dir,rmSync fail;temp dir 在 tmpdir,OS 清,吞错不 fail test。
      try { rmSync(d, { recursive: true, force: true }); } catch { /* EBUSY: OS cleans tmpdir */ }
    }
    dirs = [];
  });

  function makeDir(): string {
    const d = mkdtempSync(join(tmpdir(), "agentforge-glob-"));
    dirs.push(d);
    return d;
  }

  it('pattern "*.ts" matches top-level .ts files only (no recursion)', async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.ts"), "");
    writeFileSync(join(dir, "b.ts"), "");
    writeFileSync(join(dir, "c.txt"), "");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "deep.ts"), "");

    const tool = createGlobTool();
    const result = await tool.execute("call-1", { pattern: "*.ts", path: dir });

    const text = (result.content[0] as { type: string; text: string }).text;
    const lines = text ? text.split("\n").sort() : [];
    expect(lines).toEqual(["a.ts", "b.ts"]);
    expect(result.details.count).toBe(2);
  });

  it('pattern "**/*.ts" recursively matches all .ts files', async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "top.ts"), "");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "mid.ts"), "");
    mkdirSync(join(dir, "src", "deep"));
    writeFileSync(join(dir, "src", "deep", "low.ts"), "");
    writeFileSync(join(dir, "README.md"), "");

    const tool = createGlobTool();
    const result = await tool.execute("call-2", { pattern: "**/*.ts", path: dir });

    const text = (result.content[0] as { type: string; text: string }).text;
    const lines = text ? text.split("\n").sort() : [];
    expect(lines).toEqual(["src/deep/low.ts", "src/mid.ts", "top.ts"]);
    expect(result.details.count).toBe(3);
  });

  it('pattern "src/?ead.ts" matches single-char wildcard ?', async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "read.ts"), "");
    writeFileSync(join(dir, "src", "head.ts"), "");
    writeFileSync(join(dir, "src", "thread.ts"), "");
    writeFileSync(join(dir, "src", "readd.ts"), "");

    const tool = createGlobTool();
    const result = await tool.execute("call-3", { pattern: "src/?ead.ts", path: dir });

    const text = (result.content[0] as { type: string; text: string }).text;
    const lines = text ? text.split("\n").sort() : [];
    expect(lines).toEqual(["src/head.ts", "src/read.ts"]);
    expect(result.details.count).toBe(2);
  });

  it('pattern "src/*.{ts,js}" matches {a,b} brace expansion', async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "");
    writeFileSync(join(dir, "src", "b.js"), "");
    writeFileSync(join(dir, "src", "c.py"), "");
    writeFileSync(join(dir, "src", "d.tsx"), "");

    const tool = createGlobTool();
    const result = await tool.execute("call-4", { pattern: "src/*.{ts,js}", path: dir });

    const text = (result.content[0] as { type: string; text: string }).text;
    const lines = text ? text.split("\n").sort() : [];
    expect(lines).toEqual(["src/a.ts", "src/b.js"]);
    expect(result.details.count).toBe(2);
  });

  it("path option restricts search to that subdirectory", async () => {
    const dir = makeDir();
    mkdirSync(join(dir, "pkgA"));
    mkdirSync(join(dir, "pkgB"));
    writeFileSync(join(dir, "pkgA", "a.ts"), "");
    writeFileSync(join(dir, "pkgB", "b.ts"), "");

    const tool = createGlobTool();
    const result = await tool.execute("call-5", {
      pattern: "*.ts",
      path: join(dir, "pkgA"),
    });

    const text = (result.content[0] as { type: string; text: string }).text;
    const lines = text ? text.split("\n").sort() : [];
    expect(lines).toEqual(["a.ts"]);
    expect(result.details.count).toBe(1);
  });

  it("no matches returns count=0 and empty content text", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.ts"), "");

    const tool = createGlobTool();
    const result = await tool.execute("call-6", { pattern: "*.java", path: dir });

    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe("");
    expect(result.details.count).toBe(0);
    expect(result.details.truncated).toBeUndefined();
  });

  it("skips node_modules and .git directories", async () => {
    const dir = makeDir();
    writeFileSync(join(dir, "top.ts"), "");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "lib.ts"), "");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "config.ts"), "");
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "built.ts"), "");

    const tool = createGlobTool();
    const result = await tool.execute("call-7", { pattern: "**/*.ts", path: dir });

    const text = (result.content[0] as { type: string; text: string }).text;
    const lines = text ? text.split("\n").sort() : [];
    expect(lines).toEqual(["top.ts"]);
    expect(result.details.count).toBe(1);
  });

  it("truncates at 1000 matches and sets truncated=true", async () => {
    const dir = makeDir();
    for (let i = 0; i < 1200; i++) {
      writeFileSync(join(dir, `f${i}.ts`), "");
    }

    const tool = createGlobTool();
    const result = await tool.execute("call-8", { pattern: "*.ts", path: dir });

    expect(result.details.count).toBe(1000);
    expect(result.details.truncated).toBe(true);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text.split("\n").length).toBe(1000);
  }, 30000);

  it("exposes name/label/parameters schema metadata", () => {
    const tool = createGlobTool();
    expect(tool.name).toBe("glob");
    expect(tool.label).toBe("Glob");
    expect(tool.parameters).toBeDefined();
  });

  it("searches in the provided cwd", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "glob-cwd-"));
    dirs.push(tmp);
    writeFileSync(join(tmp, "a.ts"), "x");
    const tool = createGlobTool(tmp);
    const result = await tool.execute("call-cwd", { pattern: "*.ts" });
    expect((result.content[0] as { text: string }).text).toContain("a.ts");
  });
});
