import { describe, it, expect } from "vitest";
import { deriveId, formatInstinctsForSystemPrompt, type Instinct } from "./instinct.js";

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
