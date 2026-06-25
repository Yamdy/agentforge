import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
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
