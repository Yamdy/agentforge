/**
 * env-config：provider API key 从 process.env 读取（按 pi-ai env-api-keys 约定）。
 *
 * Slice 4-C（全换 MiMo）：抽出自 index.ts main 内联逻辑，便于单测。
 */
import { getEnvApiKey } from "@earendil-works/pi-ai";

/**
 * 从 process.env 读 provider 的 API key。
 *
 * 用 pi-ai getEnvApiKey 而非自拼 `${provider.toUpperCase()}_API_KEY`——
 * 后者对含 `-` 的 provider 名（如 xiaomi-token-plan-cn）产生非法 env 名
 * `XIAOMI-TOKEN-PLAN-CN_API_KEY`（bash 无法用 `VAR=x node` 设置，须 `env 'VAR=x'`），
 * 且与 pi-ai 约定（XIAOMI_TOKEN_PLAN_CN_API_KEY，见 pi-ai env-api-keys.js:97）不符。
 * getEnvApiKey 封装完整 provider→env 映射（含 anthropic OAUTH 优先级等特殊逻辑）。
 *
 * 类型桥接：pi-ai ProviderEnv = Record<string, string>，而 Node process.env 值类型为
 * string | undefined，故经 unknown 中转 cast（运行时 getEnvApiKey 已处理缺失 key）。
 */
export function getApiKeyFromEnv(provider: string): string | undefined {
	return getEnvApiKey(provider, process.env as unknown as Record<string, string>);
}
