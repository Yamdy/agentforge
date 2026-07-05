/**
 * provider 配置文件（~/.agentforge/providers.json）。per-provider 存 apiKey + model。
 *
 * 设计参考 pi 的 auth.json（C:\Users\90514\code\primo\pi\packages\coding-agent\src\core\auth-storage.ts）：
 *  - 0600 文件权限 + 父目录 0700（AUTH_FILE_WRITE_OPTIONS / ensureParentDir）
 *  - key resolution：config > env（agentforge 简化版；pi 是 --api-key > auth.json > env > models.json）
 *
 * 与 pi 的差异：agentforge 只依赖 pi-ai（不依赖 coding-agent），无法 import defaultModelPerProvider
 * / AuthStorage，故 model 一并存配置（option 2，自洽无漂移）。已核实 xiaomi-token-plan-cn /
 * deepseek 均为 pi-ai KnownProvider，model mimo-v2.5-pro / deepseek-v4-pro 均为 KnownModel，
 * baseURL 内置于 model（pi-ai getModel），无需配置。
 *
 * 配置缺失时返回 null，调用方回退 args.provider/model + getApiKeyFromEnv（向后兼容）。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 单个 provider 的凭证 + 默认 model。 */
export interface ProviderEntry {
	apiKey: string;
	model: string;
}

/** providers.json 顶层结构。default 可省（resolveProvider 回退第一个）。 */
export interface ProviderConfig {
	default?: string;
	providers: Record<string, ProviderEntry>;
}

/** resolveProvider 解析结果：provider 名 + 展平的 apiKey/model。 */
export interface ResolvedProvider {
	provider: string;
	apiKey: string;
	model: string;
}

const FILE_NAME = "providers.json";
const WRITE_OPTS = { encoding: "utf-8" as const, mode: 0o600 };
const DIR_MODE = 0o700;

/** 默认配置目录：~/.agentforge（与 instinct.ts:198 同目录）。 */
export function defaultProviderConfigDir(): string {
	return join(homedir(), ".agentforge");
}

/** providers.json 路径：configDir ?? ~/.agentforge。 */
export function providerConfigPath(opts?: { configDir?: string }): string {
	const dir = opts?.configDir ?? defaultProviderConfigDir();
	return join(dir, FILE_NAME);
}

/**
 * 读 providers.json。文件不存在 → null（向后兼容）；坏 JSON / 非法 shape → 抛错（含路径，便于排障）。
 */
export function loadProviderConfig(opts?: { configDir?: string }): ProviderConfig | null {
	const path = providerConfigPath(opts);
	if (!existsSync(path)) return null;
	let content: string;
	try {
		content = readFileSync(path, "utf-8");
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (e) {
		throw new Error(`Failed to parse ${path}: ${e instanceof Error ? e.message : e}`);
	}
	return validateProviderConfig(parsed, path);
}

/** 校验 + 收窄未类型化 JSON 为 ProviderConfig。非法 shape 抛错（指明字段）。 */
function validateProviderConfig(parsed: unknown, path: string): ProviderConfig {
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`${path}: expected object at root`);
	}
	const obj = parsed as Record<string, unknown>;
	const providers = obj.providers;
	if (typeof providers !== "object" || providers === null) {
		throw new Error(`${path}: missing "providers" object`);
	}
	const result: Record<string, ProviderEntry> = {};
	for (const [name, entry] of Object.entries(providers as Record<string, unknown>)) {
		if (typeof entry !== "object" || entry === null) {
			throw new Error(`${path}: provider "${name}": expected object`);
		}
		const e = entry as Record<string, unknown>;
		if (typeof e.apiKey !== "string" || typeof e.model !== "string") {
			throw new Error(`${path}: provider "${name}": apiKey and model must be strings`);
		}
		result[name] = { apiKey: e.apiKey, model: e.model };
	}
	const defaultName = typeof obj.default === "string" ? obj.default : undefined;
	return { ...(defaultName !== undefined ? { default: defaultName } : {}), providers: result };
}

/**
 * 解析 active provider：name → config.default → 第一个。未命中 → undefined。
 * 调用方据此注入 args.provider/model + getApiKey（key resolution: config > env）。
 */
export function resolveProvider(config: ProviderConfig, name?: string): ResolvedProvider | undefined {
	const providerName = name ?? config.default ?? Object.keys(config.providers)[0];
	if (!providerName) return undefined;
	const entry = config.providers[providerName];
	if (!entry) return undefined;
	return { provider: providerName, apiKey: entry.apiKey, model: entry.model };
}

/**
 * API key 脱敏（web 展示用，不回显完整 key）。长 key 前4…后4；短 key（≤8）全脱敏。
 */
export function maskApiKey(key: string): string {
	if (key.length <= 8) return "••••";
	return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * 写 providers.json（0600）+ 确保父目录（0700）。落地用户凭证用。
 * Windows 上 chmod 语义有限，chmodSync best-effort 不抛错（POSIX 才真正生效）。
 */
export function writeProviderConfig(config: ProviderConfig, opts?: { configDir?: string }): void {
	const dir = opts?.configDir ?? defaultProviderConfigDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: DIR_MODE });
	}
	const path = join(dir, FILE_NAME);
	writeFileSync(path, JSON.stringify(config, null, 2) + "\n", WRITE_OPTS);
	try {
		chmodSync(path, 0o600);
	} catch {
		/* Windows: best-effort */
	}
}
