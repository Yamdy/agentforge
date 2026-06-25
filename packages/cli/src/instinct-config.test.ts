import { describe, it, expect, vi } from "vitest";
import { createExtractRun, computeProjectHash } from "./instinct-config.js";

describe("createExtractRun", () => {
  it("calls completeSimple + parses JSON instincts", async () => {
    const completeSimple = vi.fn(async () => ({
      content: [{ type: "text", text: '{"instincts":[{"trigger":"t","action":"a","confidence":0.5,"domain":"x","evidence":[]}]}' }],
    }));
    const getApiKey = vi.fn(async () => "key");
    const run = createExtractRun({} as any, getApiKey, "xiaomi-token-plan-cn", completeSimple as any);
    const out = await run([{ timestamp: 1, projectHash: null, kind: "tool_call", data: {} }]);
    expect(completeSimple).toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].trigger).toBe("t");
  });

  it("returns [] on malformed JSON", async () => {
    const completeSimple = vi.fn(async () => ({ content: [{ type: "text", text: "not json" }] }));
    const run = createExtractRun({} as any, async () => "key", "p", completeSimple as any);
    expect(await run([])).toEqual([]);
  });
});

describe("computeProjectHash", () => {
  it("env override wins", () => {
    process.env.AGENTFORGE_PROJECT_DIR = "/some/dir";
    const h = computeProjectHash({ execSync: () => "" } as any);
    delete process.env.AGENTFORGE_PROJECT_DIR;
    expect(h).toMatch(/^[a-f0-9]{12}$/);
  });

  it("git remote → sha256 12", () => {
    const execSync = vi.fn((cmd: string) => (cmd.startsWith("git remote") ? "https://github.com/x/y.git\n" : ""));
    expect(computeProjectHash({ execSync } as any)).toMatch(/^[a-f0-9]{12}$/);
  });

  it("repo path fallback when no remote", () => {
    const execSync = vi.fn((cmd: string) => {
      if (cmd.startsWith("git remote")) throw new Error("no remote");
      return "/repo/path\n";
    });
    expect(computeProjectHash({ execSync } as any)).toMatch(/^[a-f0-9]{12}$/);
  });

  it("global null when all fail", () => {
    const execSync = vi.fn(() => {
      throw new Error("no git");
    });
    expect(computeProjectHash({ execSync } as any)).toBeNull();
  });
});
