import { describe, it, expect, vi } from "vitest";
import { createCompactionConfig, SUMMARIZE_PROMPT } from "./compaction-config.js";

vi.mock("@earendil-works/pi-ai", () => ({
  getModel: () => ({
    contextWindow: 128000,
    id: "deepseek-v4-pro",
    provider: "deepseek",
  }),
  completeSimple: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "mocked summary" }],
  }),
}));

describe("createCompactionConfig", () => {
  it("returns 4 fields with modelContextWindow from getModel", () => {
    const cfg = createCompactionConfig({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      getApiKey: () => "key",
    });
    expect(cfg.modelContextWindow).toBe(128000);
    expect(cfg.compactor).toBeDefined();
    expect(cfg.compactorDeps).toBeDefined();
    expect(cfg.budgetThresholds).toBeDefined();
  });

  it("generateSummary awaits async getApiKey and calls completeSimple, returns text", async () => {
    const { completeSimple } = await import("@earendil-works/pi-ai");
    const cfg = createCompactionConfig({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      getApiKey: async () => "async-key",
    });
    const summary = await cfg.compactorDeps.generateSummary(
      [{ role: "user", content: "old", timestamp: 0 }] as any,
    );
    expect(completeSimple).toHaveBeenCalled();
    expect(summary).toBe("mocked summary");
    // 验证 await 了异步 getApiKey：传给 completeSimple 的 options.apiKey 是解析后的字符串
    const call = (completeSimple as any).mock.calls.at(-1);
    expect(call?.[2]?.apiKey).toBe("async-key");
  });

  it("generateSummary returns empty string when no text block", async () => {
    const { completeSimple } = await import("@earendil-works/pi-ai");
    (completeSimple as any).mockResolvedValueOnce({ content: [] });
    const cfg = createCompactionConfig({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      getApiKey: () => "key",
    });
    const summary = await cfg.compactorDeps.generateSummary([] as any);
    expect(summary).toBe("");
  });

  it("SUMMARIZE_PROMPT is a non-empty string", () => {
    expect(typeof SUMMARIZE_PROMPT).toBe("string");
    expect(SUMMARIZE_PROMPT.length).toBeGreaterThan(0);
  });
});
