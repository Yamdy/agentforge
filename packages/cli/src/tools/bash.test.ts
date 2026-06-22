import { describe, it, expect } from "vitest";
import { createBashTool } from "./bash.js";

describe("bash tool", () => {
  it("captures stdout of a successful command", async () => {
    const tool = createBashTool();
    const result = await tool.execute("call-1", { command: "echo hello" });

    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("hello");
    expect(result.details).toMatchObject({ command: "echo hello", exitCode: 0 });
  });

  it("captures stderr alongside stdout", async () => {
    const tool = createBashTool();
    // 写到 stderr 的可移植命令：sh -c 'echo err >&2'
    const result = await tool.execute("call-2", { command: "echo err >&2" });

    expect((result.content[0] as { text: string }).text).toContain("err");
  });

  it("throws on non-zero exit code", async () => {
    const tool = createBashTool();
    await expect(tool.execute("call-3", { command: "exit 3" })).rejects.toThrow();
  });

  it("exposes name/label/parameters schema metadata", () => {
    const tool = createBashTool();
    expect(tool.name).toBe("bash");
    expect(tool.label).toBe("Bash");
    expect(tool.parameters).toBeDefined();
  });

  it("records duration in details", async () => {
    const tool = createBashTool();
    const result = await tool.execute("call-4", { command: "echo done" });
    expect(typeof result.details.durationMs).toBe("number");
    expect(result.details.durationMs as number).toBeGreaterThanOrEqual(0);
  });
});
