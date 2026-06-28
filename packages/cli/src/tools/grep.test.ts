import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock exec from node:child_process. grep.ts 用 promisify(exec) → execAsync，
// 我们直接 mock exec 的 (error, {stdout, stderr}) 回调契约。
// 用 vi.hoisted 确保 execMock 在 vi.mock 提升时已定义。
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("node:child_process", () => ({
  exec: execMock,
}));

// 必须在 vi.mock 之后静态 import（vi.mock 被 hoist 到顶部）
import { createGrepTool } from "./grep.js";

// 辅助：模拟 exec 成功（code 0）
function mockExecSuccess(stdout: string) {
  execMock.mockImplementation(
    (_cmd: string, _opts: unknown, cb: (e: unknown, o: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout, stderr: "" });
    },
  );
}

// 辅助：模拟 exec 失败（带 code + stderr/stdout）
function mockExecFailure(code: number | undefined, stdout: string, stderr: string) {
  execMock.mockImplementation(
    (_cmd: string, _opts: unknown, cb: (e: unknown, o: { stdout: string; stderr: string }) => void) => {
      const err = { code, stdout, stderr, message: `exited ${code}` };
      cb(err, { stdout, stderr });
    },
  );
}

// 从 execMock 的调用记录里提取 cmd 字符串
function getCmd(): string {
  const call = execMock.mock.calls[0];
  return call ? (call[0] as string) : "";
}

// 从 execMock 的调用记录里提取 opts（第二参数）
function getOpts(): Record<string, unknown> {
  const call = execMock.mock.calls[0];
  return call ? (call[1] as Record<string, unknown>) : {};
}

describe("grep tool", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("exposes name/label/parameters schema metadata", () => {
    const tool = createGrepTool();
    expect(tool.name).toBe("grep");
    expect(tool.label).toBe("Grep");
    expect(tool.parameters).toBeDefined();
  });

  it("returns matching line content for a pattern", async () => {
    mockExecSuccess("a.txt:beta\n");
    const tool = createGrepTool();
    const result = await tool.execute("call-1", { pattern: "beta", path: "/tmp/dir" });
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("beta");
    expect(result.details).toMatchObject({ exitCode: 0 });
  });

  it("returns empty content without throwing when no match (exitCode 1)", async () => {
    mockExecFailure(1, "", "");
    const tool = createGrepTool();
    const result = await tool.execute("call-2", {
      pattern: "zzznotfound",
      path: "/tmp/dir",
    });
    expect((result.content[0] as { text: string }).text).toBe("");
    expect(result.details).toMatchObject({ exitCode: 1 });
  });

  it("matches case-insensitively with -i flag", async () => {
    mockExecSuccess("a.txt:Hello World\n");
    const tool = createGrepTool();
    const result = await tool.execute("call-3", {
      pattern: "HELLO",
      path: "/tmp/dir",
      "-i": true,
    });
    expect((result.content[0] as { text: string }).text).toContain("Hello World");
    expect(result.details).toMatchObject({ exitCode: 0 });
    expect(getCmd()).toMatch(/-i/);
  });

  it("filters by glob, only searching matching files", async () => {
    mockExecSuccess("match.ts:target\n");
    const tool = createGrepTool();
    const result = await tool.execute("call-4", {
      pattern: "target",
      path: "/tmp/dir",
      glob: "*.ts",
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("match.ts");
    expect(text).not.toContain("skip.js");
    expect(getCmd()).toMatch(/--glob \*\.ts/);
  });

  it("returns file list when output_mode is files_with_matches", async () => {
    mockExecSuccess("/tmp/dir/a.txt\n/tmp/dir/c.txt\n");
    const tool = createGrepTool();
    const result = await tool.execute("call-5", {
      pattern: "needle",
      path: "/tmp/dir",
      output_mode: "files_with_matches",
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("a.txt");
    expect(text).toContain("c.txt");
    expect(text).not.toContain("b.txt");
    expect(result.details).toMatchObject({ exitCode: 0 });
    expect(getCmd()).toMatch(/--files-with-matches/);
  });

  it("shows counts when output_mode is count", async () => {
    mockExecSuccess("/tmp/dir/a.txt:3\n");
    const tool = createGrepTool();
    const result = await tool.execute("call-6", {
      pattern: "foo",
      path: "/tmp/dir",
      output_mode: "count",
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("3");
    expect(result.details).toMatchObject({ exitCode: 0 });
    expect(getCmd()).toMatch(/--count/);
  });

  it("shows line numbers with -n flag", async () => {
    mockExecSuccess("/tmp/dir/a.txt:2:two\n");
    const tool = createGrepTool();
    const result = await tool.execute("call-7", {
      pattern: "two",
      path: "/tmp/dir",
      "-n": true,
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/:2:two/);
    expect(getCmd()).toMatch(/ -n /);
  });

  it("passes -C context lines to rg", async () => {
    mockExecSuccess("");
    const tool = createGrepTool();
    await tool.execute("call-8", {
      pattern: "x",
      path: "/tmp/dir",
      "-C": 3,
    });
    expect(getCmd()).toMatch(/-C 3/);
  });

  it("throws 'ripgrep (rg) not installed' when rg missing (ENOENT)", async () => {
    mockExecFailure(undefined, "", "rg: not found\n");
    const tool = createGrepTool();
    await expect(
      tool.execute("call-9", { pattern: "x", path: "/tmp/dir" }),
    ).rejects.toThrow(/ripgrep \(rg\) not installed/);
  });

  it("throws on other non-zero exit codes (with stderr)", async () => {
    mockExecFailure(2, "", "rg: regex error\n");
    const tool = createGrepTool();
    await expect(
      tool.execute("call-10", { pattern: "(", path: "/tmp/dir" }),
    ).rejects.toThrow(/regex error/);
  });

  it("passes the provided cwd to execAsync (worktree isolation)", async () => {
    // 验证 red-team #6：cwd 在构造器内捕获，execAsync opts.cwd 传给 rg。
    mockExecSuccess("f.ts:markerXYZ\n");
    const tmp = "/tmp/grep-cwd-isolated";
    const tool = createGrepTool(tmp);
    await tool.execute("call-cwd", { pattern: "markerXYZ" });
    expect(getOpts().cwd).toBe(tmp);
  });

  it("no-arg defaults to process.cwd() (backward compat)", async () => {
    mockExecSuccess("f.ts:marker\n");
    const tool = createGrepTool();
    await tool.execute("call-default", { pattern: "marker" });
    expect(getOpts().cwd).toBe(process.cwd());
  });
});
