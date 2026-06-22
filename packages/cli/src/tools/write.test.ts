import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteTool } from "./write.js";

describe("write tool", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined as unknown as string;
    }
  });

  it("writes a new file: created=true, content correct, bytes=length", async () => {
    dir = mkdtempSync(join(tmpdir(), "agentforge-write-"));
    const filePath = join(dir, "new.txt");
    const content = "hello world";

    const tool = createWriteTool();
    const result = await tool.execute("call-1", { path: filePath, content });

    expect(result.details).toEqual({ path: filePath, bytes: content.length, created: true });
    expect(result.content[0]).toEqual({ type: "text", text: `Wrote ${content.length} bytes to ${filePath}` });
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe(content);
  });

  it("overwrites existing file: created=false, content updated", async () => {
    dir = mkdtempSync(join(tmpdir(), "agentforge-write-"));
    const filePath = join(dir, "existing.txt");
    writeFileSync(filePath, "old content", "utf-8");
    const content = "new content";

    const tool = createWriteTool();
    const result = await tool.execute("call-2", { path: filePath, content });

    expect(result.details).toEqual({ path: filePath, bytes: content.length, created: false });
    expect(readFileSync(filePath, "utf-8")).toBe(content);
  });

  it("creates nested path when parent dirs do not exist", async () => {
    dir = mkdtempSync(join(tmpdir(), "agentforge-write-"));
    const filePath = join(dir, "a", "b", "c", "deep.txt");
    const content = "nested";

    const tool = createWriteTool();
    const result = await tool.execute("call-3", { path: filePath, content });

    expect(result.details).toEqual({ path: filePath, bytes: content.length, created: true });
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe(content);
  });
});
