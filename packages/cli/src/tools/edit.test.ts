import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditTool } from "./edit.js";

describe("edit tool", () => {
  let dir: string;
  // 每个测试自建临时目录并在 afterEach 清理，避免跨测试污染。
  const makeDir = () => {
    dir = mkdtempSync(join(tmpdir(), "agentforge-edit-"));
    return dir;
  };
  const cleanup = () => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined as unknown as string;
    }
  };

  it("replaces a unique old_string and updates the file with replacements=1", async () => {
    makeDir();
    try {
      const filePath = join(dir, "a.txt");
      writeFileSync(filePath, "hello world\nfoo bar\n", "utf-8");

      const tool = createEditTool();
      const result = await tool.execute("call-1", {
        path: filePath,
        old_string: "foo bar",
        new_string: "baz qux",
      });

      expect(result.content[0]).toEqual({
        type: "text",
        text: `Edited ${filePath} (1 replacement)`,
      });
      expect(result.details).toEqual({ path: filePath, replacements: 1 });

      const updated = await readFile(filePath, "utf-8");
      expect(updated).toBe("hello world\nbaz qux\n");
    } finally {
      cleanup();
    }
  });

  it("throws when old_string is not found and replace_all is false", async () => {
    makeDir();
    try {
      const filePath = join(dir, "b.txt");
      writeFileSync(filePath, "alpha beta\n", "utf-8");

      const tool = createEditTool();
      await expect(
        tool.execute("call-2", {
          path: filePath,
          old_string: "gamma",
          new_string: "delta",
        }),
      ).rejects.toThrow(/old_string must be unique in file \(found 0 occurrences\)/);
    } finally {
      cleanup();
    }
  });

  it("throws when old_string appears 2 times and replace_all is false (not unique)", async () => {
    makeDir();
    try {
      const filePath = join(dir, "c.txt");
      writeFileSync(filePath, "dup\ndup\nthird\n", "utf-8");

      const tool = createEditTool();
      await expect(
        tool.execute("call-3", {
          path: filePath,
          old_string: "dup",
          new_string: "one",
        }),
      ).rejects.toThrow(/old_string must be unique in file \(found 2 occurrences\)/);
    } finally {
      cleanup();
    }
  });

  it("replaces all occurrences when replace_all is true and reports replacements=2", async () => {
    makeDir();
    try {
      const filePath = join(dir, "d.txt");
      writeFileSync(filePath, "dup\ndup\nthird\n", "utf-8");

      const tool = createEditTool();
      const result = await tool.execute("call-4", {
        path: filePath,
        old_string: "dup",
        new_string: "one",
        replace_all: true,
      });

      expect(result.content[0]).toEqual({
        type: "text",
        text: `Edited ${filePath} (2 replacements)`,
      });
      expect(result.details).toEqual({ path: filePath, replacements: 2 });

      const updated = await readFile(filePath, "utf-8");
      expect(updated).toBe("one\none\nthird\n");
    } finally {
      cleanup();
    }
  });

  it("throws when the file does not exist", async () => {
    const tool = createEditTool();
    await expect(
      tool.execute("call-5", {
        path: "/nonexistent/path/does-not-exist.txt",
        old_string: "foo",
        new_string: "bar",
      }),
    ).rejects.toThrow();
  });

  it("resolves relative path against cwd (worktree isolation)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "edit-rel-"));
    try {
      writeFileSync(join(tmp, "f.ts"), "old");
      const tool = createEditTool(tmp);
      await tool.execute("call-rel", { path: "f.ts", old_string: "old", new_string: "new" });
      expect(readFileSync(join(tmp, "f.ts"), "utf-8")).toBe("new");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses absolute path as-is (isAbsolute short-circuit, by design)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "edit-abs-"));
    try {
      const abs = join(tmp, "f.ts");
      writeFileSync(abs, "old");
      const tool = createEditTool(tmp);
      await tool.execute("call-abs", { path: abs, old_string: "old", new_string: "new" });
      expect(readFileSync(abs, "utf-8")).toBe("new");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("no-arg does not throw TypeError on relative path (red-team #6 regression)", async () => {
    const tool = createEditTool();
    // 无参 → c=process.cwd()。相对路径 resolve(process.cwd(), path) 不 throw;
    // 文件不存在 → readFile ENOENT(非 TypeError)。
    await expect(
      tool.execute("call-noarg", { path: "nonexistent-xyz.xyz", old_string: "x", new_string: "y" }),
    ).rejects.toThrow(/ENOENT/);
  });
});
