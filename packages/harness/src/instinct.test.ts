import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstinctStore, deriveId, formatInstinctsForSystemPrompt, type Instinct } from "./instinct.js";

function tmpDataDir() { return mkdtempSync(join(tmpdir(), "instinct-")); }

describe("deriveId", () => {
  it("lowercases + replaces non-alnum with - + truncates 40", () => {
    expect(deriveId("When Running Tests Fails on Import")).toBe("when-running-tests-fails-on-import");
    expect(deriveId("when ".repeat(20) + "x")).toMatch(/^when-when/);
    expect(deriveId("when ".repeat(20) + "x").length).toBeLessThanOrEqual(40);
  });
  it("trims leading/trailing dash", () => {
    expect(deriveId("!!! hi !!!")).toBe("hi");
  });
});

describe("formatInstinctsForSystemPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatInstinctsForSystemPrompt([])).toBe("");
  });
  it("formats <learned_instincts> block", () => {
    const instincts: Instinct[] = [
      { id: "prefer-filter", trigger: "when running tests in a package", action: "use pnpm --filter <pkg> test", confidence: 0.7, domain: "testing", scope: "project", projectHash: "abc", evidence: ["obs1"], createdAt: 1, updatedAt: 1 },
    ];
    const block = formatInstinctsForSystemPrompt(instincts);
    expect(block).toContain("<learned_instincts>");
    expect(block).toContain("when running tests in a package → use pnpm --filter <pkg> test");
    expect(block).toContain("0.7");
    expect(block).toContain("</learned_instincts>");
  });
});

describe("InstinctStore.observe", () => {
  it("tool_execution_end (no error) → tool_call observation", () => {
    const dir = tmpDataDir();
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: false } as any);
    const lines = readFileSync(join(dir, "projects/abc/observations.jsonl"), "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const obs = JSON.parse(lines[0]);
    expect(obs.kind).toBe("tool_call");
    expect(obs.projectHash).toBe("abc");
    expect(obs.data.toolName).toBe("bash");
    expect(obs.data.isError).toBe(false);
  });
  it("tool_execution_end isError → tool_call + tool_error", () => {
    const dir = tmpDataDir();
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "read", result: {}, isError: true } as any);
    const lines = readFileSync(join(dir, "projects/abc/observations.jsonl"), "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).kind).toBe("tool_call");
    expect(JSON.parse(lines[1]).kind).toBe("tool_error");
  });
  it("message_end user/assistant → user_message/assistant_message, content truncated ~500", () => {
    const dir = tmpDataDir();
    const store = createInstinctStore({ projectHash: null, dataDir: dir });
    const long = "x".repeat(600);
    store.observe({ type: "message_end", message: { role: "user", content: long } } as any);
    store.observe({ type: "message_end", message: { role: "assistant", content: "hi" } } as any);
    const lines = readFileSync(join(dir, "observations.jsonl"), "utf-8").trim().split("\n"); // global fallback
    expect(JSON.parse(lines[0]).kind).toBe("user_message");
    expect(JSON.parse(lines[0]).data.content.length).toBe(500);
    expect(JSON.parse(lines[1]).kind).toBe("assistant_message");
  });
  it("ignores unrelated events", () => {
    const dir = tmpDataDir();
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    store.observe({ type: "agent_start" } as any);
    store.observe({ type: "context_budget", components: {}, total: 0, suggestions: [], headroom: 0 } as any);
    expect(existsSync(join(dir, "projects/abc/observations.jsonl"))).toBe(false);
  });
  it("observe IO failure swallowed (no throw)", () => {
    const store = createInstinctStore({ projectHash: "abc", dataDir: "/nonexistent-root/no-perm" });
    expect(() => store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: false } as any)).not.toThrow();
  });
});

describe("InstinctStore.loadInstincts", () => {
  it("reads project + global instincts, unfiltered", () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    mkdirSync(join(dir, "instincts"), { recursive: true });
    const projInst: Instinct = { id: "p1", trigger: "t1", action: "a1", confidence: 0.3, domain: "x", scope: "project", projectHash: "abc", evidence: [], createdAt: 1, updatedAt: 1 };
    const globalInst: Instinct = { id: "g1", trigger: "t2", action: "a2", confidence: 0.9, domain: "x", scope: "global", projectHash: null, evidence: [], createdAt: 1, updatedAt: 1 };
    writeFileSync(join(dir, "projects/abc/instincts/p1.json"), JSON.stringify(projInst));
    writeFileSync(join(dir, "instincts/g1.json"), JSON.stringify(globalInst));
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    const all = store.loadInstincts();
    expect(all).toHaveLength(2);
    expect(all.map(i => i.id).sort()).toEqual(["g1", "p1"]);
  });
  it("returns empty when no files", () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    expect(store.loadInstincts()).toEqual([]);
  });
  it("ignores malformed instinct json (best-effort)", () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    writeFileSync(join(dir, "projects/abc/instincts/bad.json"), "{not json");
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir });
    expect(store.loadInstincts()).toEqual([]);
  });
});

describe("InstinctStore.extract", () => {
  it("creates new instinct (clamp confidence)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    const extractRun = vi.fn(async () => [{ trigger: "when tests fail on import", action: "check alias config", confidence: 0.99, domain: "testing", evidence: ["obs1"] }]);
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: true } as any);
    await store.extract();
    const files = readdirSync(join(dir, "projects/abc/instincts"));
    expect(files).toHaveLength(1);
    const inst = JSON.parse(readFileSync(join(dir, "projects/abc/instincts", files[0]), "utf-8")) as Instinct;
    expect(inst.confidence).toBe(0.9); // clamp 0.99→0.9
    expect(inst.scope).toBe("project");
    expect(inst.id).toBe(deriveId("when tests fail on import"));
  });
  it("merges on trigger equal: confidence +0.1 cap 0.9, evidence append dedup cap 5", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    const existing: Instinct = { id: "when-tests-fail-on-import", trigger: "when tests fail on import", action: "check alias", confidence: 0.5, domain: "testing", scope: "project", projectHash: "abc", evidence: ["e1"], createdAt: 1, updatedAt: 1 };
    writeFileSync(join(dir, "projects/abc/instincts/when-tests-fail-on-import.json"), JSON.stringify(existing));
    const extractRun = vi.fn(async () => [{ trigger: "when tests fail on import", action: "check alias", confidence: 0.5, domain: "testing", evidence: ["e2"] }]);
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: true } as any);
    await store.extract();
    const inst = JSON.parse(readFileSync(join(dir, "projects/abc/instincts/when-tests-fail-on-import.json"), "utf-8")) as Instinct;
    expect(inst.confidence).toBe(0.6); // 0.5 + 0.1
    expect(inst.evidence).toEqual(["e1", "e2"]);
  });
  it("id collision but different trigger → not merged, suffix -2", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    mkdirSync(join(dir, "projects/abc/instincts"), { recursive: true });
    // Both triggers kebab to the SAME 40-char id: "when-running-tests-fail-on-import-in-pro"
    // (slice(0,40) cuts off "...ject alpha"/"...ject beta" — only "pro" survives)
    const existing: Instinct = { id: "when-running-tests-fail-on-import-in-pro", trigger: "when running tests fail on import in project alpha", action: "a1", confidence: 0.5, domain: "testing", scope: "project", projectHash: "abc", evidence: ["e1"], createdAt: 1, updatedAt: 1 };
    writeFileSync(join(dir, "projects/abc/instincts/when-running-tests-fail-on-import-in-pro.json"), JSON.stringify(existing));
    // 不同 trigger 但同 id（40 字符前缀碰撞）
    const extractRun = vi.fn(async () => [{ trigger: "when running tests fail on import in project beta", action: "a2", confidence: 0.5, domain: "testing", evidence: ["e2"] }]);
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: true } as any);
    await store.extract();
    const files = readdirSync(join(dir, "projects/abc/instincts")).map((f) => f.replace(/\.json$/, ""));
    expect(files.sort()).toEqual(["when-running-tests-fail-on-import-in-pro", "when-running-tests-fail-on-import-in-pro-2"]);
  });
  it("extractRun failure → stderr, no throw, no persistence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const extractRun = vi.fn(async () => { throw new Error("llm boom"); });
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun });
    store.observe({ type: "tool_execution_end", toolCallId: "1", toolName: "bash", result: {}, isError: true } as any);
    await expect(store.extract()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    expect(readdirSync(join(dir, "projects/abc/instincts"))).toEqual([]);
    errSpy.mockRestore();
  });
  it("observations exceed ctx 80% → truncate oldest + warn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "instinct-"));
    const extractRun = vi.fn(async (obs: any[]) => [{ trigger: "t", action: "a", confidence: 0.5, domain: "x", evidence: [] }]);
    const store = createInstinctStore({ projectHash: "abc", dataDir: dir, extractRun, modelContextWindow: 100 });
    for (let i = 0; i < 50; i++) store.observe({ type: "message_end", message: { role: "user", content: "x".repeat(200) } } as any);
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await store.extract();
    expect(extractRun).toHaveBeenCalled();
    const passedObs = extractRun.mock.calls[0][0] as any[];
    expect(passedObs.length).toBeLessThan(50);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
