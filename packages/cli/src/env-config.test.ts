import { describe, it, expect, vi, afterEach } from "vitest";
import { getApiKeyFromEnv } from "./env-config.js";

describe("env-config — getApiKeyFromEnv", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("reads XIAOMI_TOKEN_PLAN_CN_API_KEY for xiaomi-token-plan-cn (含 `-` provider 名按 pi-ai 约定映射，非自拼的 `XIAOMI-TOKEN-PLAN-CN_API_KEY`)", () => {
		vi.stubEnv("XIAOMI_TOKEN_PLAN_CN_API_KEY", "mimo-key");
		expect(getApiKeyFromEnv("xiaomi-token-plan-cn")).toBe("mimo-key");
	});

	it("reads DEEPSEEK_API_KEY for deepseek (回归保护，deepseek 行为不变)", () => {
		vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
		expect(getApiKeyFromEnv("deepseek")).toBe("ds-key");
	});

	it("returns undefined when no env key set", () => {
		expect(getApiKeyFromEnv("xiaomi-token-plan-cn")).toBeUndefined();
	});
});
