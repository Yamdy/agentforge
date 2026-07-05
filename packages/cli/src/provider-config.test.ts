/**
 * provider-config 单测。配置文件 ~/.agentforge/providers.json 的加载/解析/脱敏/写入。
 *
 * 格式（option 2，per-provider 存 key+model）：
 *   { "default": "xiaomi-token-plan-cn",
 *     "providers": { "xiaomi-token-plan-cn": { "apiKey": "...", "model": "..." } } }
 *
 * 借鉴 pi auth-storage.ts：0600 权限 + 父目录 0700 + 缺失回退 env（见 resolveProvider 优先级）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

import {
	defaultProviderConfigDir,
	providerConfigPath,
	loadProviderConfig,
	resolveProvider,
	maskApiKey,
	writeProviderConfig,
	type ProviderConfig,
} from "./provider-config.js";

function tmpConfigDir(): string {
	return mkdtempSync(join(tmpdir(), "af-provider-config-"));
}

const sampleConfig: ProviderConfig = {
	default: "xiaomi-token-plan-cn",
	providers: {
		"xiaomi-token-plan-cn": { apiKey: "tp-test1234567890abcdef", model: "mimo-v2.5-pro" },
		deepseek: { apiKey: "sk-test1234567890abcdef", model: "deepseek-v4-pro" },
	},
};

describe("provider-config paths", () => {
	it("defaultProviderConfigDir 返回 ~/.agentforge（与 instinct 同目录）", () => {
		expect(defaultProviderConfigDir()).toBe(join(homedir(), ".agentforge"));
	});

	it("providerConfigPath 拼接 <dir>/providers.json", () => {
		expect(providerConfigPath({ configDir: "/tmp/af" })).toBe(join("/tmp/af", "providers.json"));
		expect(providerConfigPath()).toBe(join(homedir(), ".agentforge", "providers.json"));
	});
});

describe("loadProviderConfig", () => {
	it("文件不存在 → null（向后兼容，回退 env）", () => {
		expect(loadProviderConfig({ configDir: tmpConfigDir() })).toBe(null);
	});

	it("合法文件 → 返回 ProviderConfig", () => {
		const dir = tmpConfigDir();
		writeFileSync(join(dir, "providers.json"), JSON.stringify(sampleConfig), "utf-8");
		const got = loadProviderConfig({ configDir: dir });
		expect(got).not.toBeNull();
		expect(got?.default).toBe("xiaomi-token-plan-cn");
		expect(got?.providers["xiaomi-token-plan-cn"]).toEqual({ apiKey: sampleConfig.providers["xiaomi-token-plan-cn"].apiKey, model: "mimo-v2.5-pro" });
		expect(got?.providers.deepseek.model).toBe("deepseek-v4-pro");
	});

	it("default 可省略", () => {
		const dir = tmpConfigDir();
		writeFileSync(join(dir, "providers.json"), JSON.stringify({ providers: sampleConfig.providers }), "utf-8");
		const got = loadProviderConfig({ configDir: dir });
		expect(got?.default).toBeUndefined();
		expect(Object.keys(got?.providers ?? {})).toHaveLength(2);
	});

	it("坏 JSON → 抛清晰错误", () => {
		const dir = tmpConfigDir();
		writeFileSync(join(dir, "providers.json"), "{ not json", "utf-8");
		expect(() => loadProviderConfig({ configDir: dir })).toThrow(/providers\.json/);
	});

	it("providers 非 object → 抛错", () => {
		const dir = tmpConfigDir();
		writeFileSync(join(dir, "providers.json"), JSON.stringify({ providers: "nope" }), "utf-8");
		expect(() => loadProviderConfig({ configDir: dir })).toThrow(/providers/);
	});

	it("entry 缺 apiKey/model → 抛错", () => {
		const dir = tmpConfigDir();
		writeFileSync(join(dir, "providers.json"), JSON.stringify({ providers: { deepseek: { apiKey: "sk-1" } } }), "utf-8");
		expect(() => loadProviderConfig({ configDir: dir })).toThrow(/deepseek/);
	});
});

describe("resolveProvider", () => {
	it("name 指定 → 返回该 provider 的 key+model", () => {
		const r = resolveProvider(sampleConfig, "deepseek");
		expect(r).toEqual({ provider: "deepseek", apiKey: sampleConfig.providers.deepseek.apiKey, model: "deepseek-v4-pro" });
	});

	it("无 name → 用 config.default", () => {
		const r = resolveProvider(sampleConfig);
		expect(r?.provider).toBe("xiaomi-token-plan-cn");
		expect(r?.model).toBe("mimo-v2.5-pro");
	});

	it("无 name 且无 default → 第一个 provider", () => {
		const config: ProviderConfig = { providers: { deepseek: { apiKey: "sk", model: "deepseek-v4-pro" } } };
		expect(resolveProvider(config)?.provider).toBe("deepseek");
	});

	it("name 不存在 → undefined", () => {
		expect(resolveProvider(sampleConfig, "nope")).toBeUndefined();
	});

	it("空 providers → undefined", () => {
		expect(resolveProvider({ providers: {} })).toBeUndefined();
	});
});

describe("maskApiKey", () => {
	it("长 key → 前4…后4", () => {
		expect(maskApiKey("tp-test1234567890abcdef")).toBe("tp-t…cdef");
	});

	it("短 key（≤8）→ 全脱敏", () => {
		expect(maskApiKey("sk-1234")).toBe("••••");
		expect(maskApiKey("")).toBe("••••");
	});
});

describe("writeProviderConfig", () => {
	it("写文件后 loadProviderConfig 往返一致", () => {
		const dir = tmpConfigDir();
		writeProviderConfig(sampleConfig, { configDir: dir });
		const got = loadProviderConfig({ configDir: dir });
		expect(got).toEqual(sampleConfig);
	});

	it("父目录不存在时自动创建（0700）", () => {
		const dir = join(tmpConfigDir(), "nested", "deep");
		expect(existsSync(dir)).toBe(false);
		writeProviderConfig(sampleConfig, { configDir: dir });
		expect(existsSync(join(dir, "providers.json"))).toBe(true);
	});

	it("文件权限 0600（ POSIX；Windows best-effort 不抛错）", () => {
		const dir = tmpConfigDir();
		writeProviderConfig(sampleConfig, { configDir: dir });
		const path = join(dir, "providers.json");
		// Windows 上 stat.mode 不反映 chmod；仅断言文件存在且可读（chmodSync 不抛错即 best-effort 通过）。
		expect(existsSync(path)).toBe(true);
		if (process.platform !== "win32") {
			// eslint-disable-next-line no-bitwise
			expect(statSync(path).mode & 0o777).toBe(0o600);
		}
	});
});
