import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadTool } from "./read.js";

describe("read tool", () => {
  it("reads full file content into content[0].text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentforge-read-"));
    const filePath = join(dir, "hello.txt");
    writeFileSync(filePath, "line1\nline2\nline3\n", "utf-8");

    const tool = createReadTool();
    const result = await tool.execute("call-1", { path: filePath });

    const fileContent = "line1\nline2\nline3\n";
    expect(result.content[0]).toEqual({ type: "text", text: "line1\nline2\nline3" });
    expect(result.details).toMatchObject({ path: filePath, size: fileContent.length });
  });

  it("slices from 1-indexed offset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentforge-read-"));
    const filePath = join(dir, "lines.txt");
    writeFileSync(filePath, "a\nb\nc\nd\ne\n", "utf-8");

    const tool = createReadTool();
    const result = await tool.execute("call-2", { path: filePath, offset: 3 });

    expect(result.content[0]).toEqual({ type: "text", text: "c\nd\ne" });
  });

  it("limits number of lines returned", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentforge-read-"));
    const filePath = join(dir, "lines.txt");
    writeFileSync(filePath, "a\nb\nc\nd\ne\n", "utf-8");

    const tool = createReadTool();
    const result = await tool.execute("call-3", { path: filePath, offset: 1, limit: 2 });

    expect(result.content[0]).toEqual({ type: "text", text: "a\nb" });
  });

  it("throws when file does not exist", async () => {
    const tool = createReadTool();
    await expect(tool.execute("call-4", { path: "/nonexistent/path/xyz.txt" })).rejects.toThrow();
  });

  it("exposes name/label/parameters schema metadata", () => {
    const tool = createReadTool();
    expect(tool.name).toBe("read");
    expect(tool.label).toBe("Read");
    expect(tool.parameters).toBeDefined();
  });

  it("resolves relative path against cwd", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "read-rel-"));
    writeFileSync(join(tmp, "f.ts"), "hello");
    const tool = createReadTool(tmp);
    const result = await tool.execute("call-rel", { path: "f.ts" });
    expect((result.content[0] as { text: string }).text).toBe("hello");
  });

  it("no-arg does not throw TypeError on relative path (red-team #6)", async () => {
    const tool = createReadTool();
    // 无参 → c=process.cwd()。相对路径 resolve 不 throw；文件不存在 → ENOENT(非 TypeError)。
    await expect(tool.execute("call-noarg", { path: "nonexistent-xyz.xyz" })).rejects.toThrow(/ENOENT/);
  });
});
