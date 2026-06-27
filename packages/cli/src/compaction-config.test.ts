import { describe, it, expect, vi } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
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
      [{ role: "user", content: "old", timestamp: 0 }] as AgentMessage[],
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
    const summary = await cfg.compactorDeps.generateSummary([] as AgentMessage[]);
    expect(summary).toBe("");
  });

  it("SUMMARIZE_PROMPT is a non-empty string", () => {
    expect(typeof SUMMARIZE_PROMPT).toBe("string");
    expect(SUMMARIZE_PROMPT.length).toBeGreaterThan(0);
  });

  it("SUMMARIZE_PROMPT contains anti-hallucination constraint (Approach A)", () => {
    // T9 + Slice 4-A T1 暴露 DeepSeek 对旧 prompt 幻觉；新 prompt 须明确禁止编造
    expect(SUMMARIZE_PROMPT).toMatch(/Do NOT invent/i);
    expect(SUMMARIZE_PROMPT).toMatch(/Do NOT continue the conversation/i);
  });

  it("generateSummary keeps systemPrompt channel + messages in order (Approach A: wording-only)", async () => {
    const { completeSimple } = await import("@earendil-works/pi-ai");
    (completeSimple as any).mockClear();
    const cfg = createCompactionConfig({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      getApiKey: () => "key",
    });
    const msgs: AgentMessage[] = [
      { role: "user", content: "q1", timestamp: 0 } as AgentMessage,
      { role: "assistant", content: [{ type: "text", text: "a1" }], timestamp: 1 } as AgentMessage,
    ];
    await cfg.compactorDeps.generateSummary(msgs);
    const call = (completeSimple as any).mock.calls.at(-1);
    // Approach A: systemPrompt = SUMMARIZE_PROMPT（channel 不变，未移到 user message）
    expect(call?.[1]?.systemPrompt).toBe(SUMMARIZE_PROMPT);
    // messages 原序，未在首插指令 user message
    expect(call?.[1]?.messages).toEqual(msgs as unknown as any[]);
  });

  it("returns disabled compactor (shouldCompact always false) when AGENTFORGE_DISABLE_COMPACTION=1", () => {
    const prev = process.env.AGENTFORGE_DISABLE_COMPACTION;
    process.env.AGENTFORGE_DISABLE_COMPACTION = "1";
    try {
      const cfg = createCompactionConfig({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        getApiKey: () => "key",
      });
      // 超阈值 ctx(正常会 compact),disabled 应 false。
      const ctx = { messages: [{ role: "user", content: "x", timestamp: 0 }], tokenThreshold: 0 } as any;
      expect(cfg.compactor.shouldCompact(ctx)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.AGENTFORGE_DISABLE_COMPACTION;
      else process.env.AGENTFORGE_DISABLE_COMPACTION = prev;
    }
  });

  it("compactor shouldCompact=true (normal) when AGENTFORGE_DISABLE_COMPACTION unset (对照:开关真生效)", () => {
    const prev = process.env.AGENTFORGE_DISABLE_COMPACTION;
    delete process.env.AGENTFORGE_DISABLE_COMPACTION;
    try {
      const cfg = createCompactionConfig({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        getApiKey: () => "key",
      });
      const ctx = { messages: [{ role: "user", content: "x", timestamp: 0 }], tokenThreshold: 0 } as any;
      expect(cfg.compactor.shouldCompact(ctx)).toBe(true);
    } finally {
      if (prev !== undefined) process.env.AGENTFORGE_DISABLE_COMPACTION = prev;
    }
  });
});
