import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { getApiKeyFromEnv } from "./env-config.js";

describe("env-config — getApiKeyFromEnv", () => {
	beforeAll(() => {
		// 模拟 source .env:process.env 残留真 key(复现 gate 在 source .env 后 fail 的场景)。
		process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY = "leaked-real";
	});
	afterAll(() => {
		delete process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY;
	});
	beforeEach(() => {
		// 问题 B 修复:隔离真实 env。source .env 后 process.env 残留真 key,导致
		// "returns undefined" 用例 fail → pnpm -r test fail → gate 永失败 → unit 无法 merge。
		// 每个 it 前清真实 key(stubEnv 的 stub 仍优先,afterEach unstubAllEnvs 清 stub)。
		delete process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY;
		delete process.env.DEEPSEEK_API_KEY;
	});
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
		// beforeAll 设了 leaked-real,无 beforeEach delete → getApiKeyFromEnv 返回 leaked-real → fail
		expect(getApiKeyFromEnv("xiaomi-token-plan-cn")).toBeUndefined();
	});
});
