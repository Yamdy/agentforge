# 配置模块设计

> 本文档定义 AgentForge 的配置系统设计，遵循事件驱动 + Zod 架构哲学，融入轻量 DI 体系。

---

## 0. 实现状态

> **最后更新**: 2026-04-27

| 功能 | 状态 | 实现位置 | 说明 |
|------|------|---------|------|
| **L1 API 基础** | ✅ 已实现 | `src/l1/index.ts` | JSON/JSONC 配置加载 + Zod 验证 |
| **L1 Schema** | ✅ 已实现 | `src/l1/index.ts` | Agent 基础配置 (name/model/tools/...) |
| **Token Counter** | ✅ 已实现 | `src/token-counter.ts` | js-tiktoken BPE 精确计数 |
| 配置文件搜索路径 | 📝 待实现 | - | env/cwd/user/system 多路径 |
| 环境变量解析 | 📝 待实现 | - | `AGENTFORGE_*` 前缀覆盖 |
| JSONC 完整解析 | 📝 待实现 | - | 当前为简单正则，需 `jsonc-parser` 库 |
| 热更新 (file watching) | 📝 待实现 | - | 回调通知 |
| Provider Profiles | 📝 待实现 | - | 多配置切换 |
| HITL 配置 | 📝 待实现 | - | 权限/超时/默认行为 |
| 可观测性配置 | 📝 待实现 | - | tracing/metrics/logging |
| MCP 服务器配置 | 📝 待实现 | - | stdio/http/ws 传输 |
| 工作流配置 | 📝 待实现 | - | 流程定义 |

### L1 API 使用示例

```typescript
// agent.json
{
  "name": "assistant",
  "model": { "provider": "openai", "model": "gpt-4o" },
  "systemPrompt": "You are a helpful assistant.",
  "maxSteps": 10,
  "tools": ["read", "write", "bash"]
}

// 使用
import { loadAgent, runPrompt } from 'agentforge';

const agent = await loadAgent('agent.json');
const result = await agent.run('Hello!');

// 或一行搞定
const response = await runPrompt('agent.json', 'Hello!');
```

---

## 1. 设计背景

### 1.1 需求来源

AgentForge 需要配置系统支持以下场景：

| 场景 | 描述 |
|------|------|
| **多环境部署** | 开发/测试/生产环境使用不同 LLM 和参数 |
| **多模型切换** | 同一会话内切换不同模型（如 Sonnet → Opus） |
| **Agent 模板** | 预定义 Agent 配置，快速创建实例 |
| **热更新** | 运行时修改配置，无需重启服务 |
| **多租户** | 不同用户使用不同的 Provider 和凭证 |

### 1.2 设计约束

基于 AgentForge 架构铁律：

| 约束 | 说明 |
|------|------|
| **禁止 Effect-TS** | 使用 Promise/AsyncGenerator + 纯 TypeScript 模块 |
| **Zod 数据契约** | 配置 Schema 作为 Tier 2 契约 |
| **轻量 DI** | 配置融入 `ApplicationServices`，不引入 IoC 容器 |
| **懒加载** | 避免模块加载时的 I/O 操作 |
| **分层校验** | 外部配置文件 Tier 1 强校验，内部传递 Tier 3 仅 TypeScript 类型 |

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         配置模块架构                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐     ┌─────────────────┐     ┌───────────────┐ │
│  │   配置来源       │     │   加载层         │     │   使用层      │ │
│  ├─────────────────┤     ├─────────────────┤     ├───────────────┤ │
│  │                 │     │                 │     │               │ │
│  │ • agentforge   │ ──► │ • ConfigLoader  │ ──► │ Application  │ │
│  │   .config.jsonc│     │   (懒加载+缓存)  │     │ Services     │ │
│  │                 │     │                 │     │               │ │
│  │ • 环境变量      │ ──► │ • EnvResolver   │ ──► │ ContextBuilder│ │
│  │   AGENTFORGE_* │     │   (前缀覆盖)      │     │               │ │
│  │                 │     │                 │     │               │ │
│  │ • CLI 参数      │ ──► │ • CLIMerger     │ ──► │ createAgent() │ │
│  │   --model etc  │     │   (运行时合并)    │     │               │ │
│  │                 │     │                 │     │               │ │
│  └─────────────────┘     └─────────────────┘     └───────────────┘ │
│          │                       │                       │         │
│          │                       ▼                       │         │
│          │             ┌─────────────────┐               │         │
│          │             │  Zod Schema     │               │         │
│          │             │  (Tier 1/2 契约) │               │         │
│          │             └─────────────────┘               │         │
│          │                       │                       │         │
│          │                       ▼                       │         │
│          │             ┌─────────────────┐               │         │
│          │             │  热更新通知      │               │         │
│          │             │ 回调通知           │             │         │
│          │             └─────────────────┘               │         │
│          │                       │                       │         │
│          └───────────────────────┴───────────────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 配置 Schema 定义

### 3.1 核心配置 Schema

```typescript
// src/core/config/schema.ts
import { z } from 'zod';

// ========== 模型配置 (discriminated union) ==========

export const ModelConfigSchema = z.discriminatedUnion('provider', [
  // Anthropic Claude
  z.object({
    provider: z.literal('anthropic'),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
  }),
  // OpenAI GPT
  z.object({
    provider: z.literal('openai'),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    organization: z.string().optional(),
  }),
  // Google Gemini
  z.object({
    provider: z.literal('google'),
    model: z.string(),
    apiKey: z.string().optional(),
  }),
  // 自定义 OpenAI 兼容端点
  z.object({
    provider: z.literal('custom'),
    baseUrl: z.string(),
    model: z.string(),
    apiKey: z.string().optional(),
    headers: z.record(z.string()).optional(),
  }),
]);

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ========== 工具配置 ==========

export const ToolConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  timeout: z.number().positive().optional(),
  retries: z.number().int().min(0).max(5).optional(),
  permissions: z.array(z.enum(['read', 'write', 'execute'])).optional(),
});

export type ToolConfig = z.infer<typeof ToolConfigSchema>;

// ========== Agent 配置 ==========

export const AgentConfigSchema = z.object({
  // 身份
  name: z.string().min(1),
  description: z.string().optional(),
  
  // 模型（可覆盖默认）
  model: ModelConfigSchema.optional(),
  
  // 行为
  maxSteps: z.number().int().positive().default(10),
  timeout: z.number().positive().optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  
  // 工具
  tools: z.union([
    z.array(z.string()),  // 工具名列表
    z.array(ToolConfigSchema),  // 详细配置
  ]).default([]),
  
  // 权限
  permissions: z.record(z.enum(['ask', 'allow', 'deny'])).optional(),
  
  // 子系统
  subagents: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
  
  // 标签（用于分类）
  tags: z.array(z.string()).optional(),
  
  // 扩展字段
  options: z.record(z.unknown()).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ========== Provider Profile (多配置切换) ==========

export const ProviderProfileSchema = z.object({
  label: z.string(),
  provider: z.string(),
  authSource: z.enum(['api_key', 'oauth', 'subscription', 'none']),
  defaultModel: z.string(),
  baseUrl: z.string().optional(),
  credentialSlot: z.string().optional(),  // 独立凭证槽
  allowedModels: z.array(z.string()).optional(),
  contextWindowTokens: z.number().positive().optional(),
});

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

// ========== 检查点配置 ==========

export const CheckpointConfigSchema = z.object({
  enabled: z.boolean().default(true),
  storage: z.enum(['memory', 'sqlite', 'filesystem']).default('memory'),
  path: z.string().optional(),
  autoSave: z.boolean().default(false),
  interval: z.number().positive().default(60000),  // ms
});

export type CheckpointConfig = z.infer<typeof CheckpointConfigSchema>;

// ========== HITL 配置 ==========

export const HITLConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeout: z.number().positive().default(300000),  // 5分钟
  defaultAction: z.enum(['ask', 'allow', 'deny']).default('ask'),
  permissions: z.record(z.enum(['ask', 'allow', 'deny'])).optional(),
});

export type HITLConfig = z.infer<typeof HITLConfigSchema>;

// ========== 可观测配置 ==========

export const ObservabilityConfigSchema = z.object({
  tracing: z.object({
    enabled: z.boolean().default(false),
    exporter: z.enum(['console', 'otel', 'none']).default('none'),
    endpoint: z.string().optional(),
    sampleRate: z.number().min(0).max(1).default(1),
  }).default({}),
  
  metrics: z.object({
    enabled: z.boolean().default(false),
    prefix: z.string().default('agentforge.'),
    tags: z.record(z.string()).default({}),
  }).default({}),
  
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    format: z.enum(['json', 'text']).default('text'),
  }).default({}),
});

export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;

// ========== 根配置 ==========

export const AppConfigSchema = z.object({
  // JSON Schema 引用
  $schema: z.string().optional(),
  
  // 版本（向后兼容）
  version: z.string().default('1.0.0'),
  
  // 默认模型
  defaultModel: ModelConfigSchema,
  
  // Agent 模板
  agents: z.record(AgentConfigSchema).default({}),
  
  // Provider Profile
  profiles: z.record(ProviderProfileSchema).default({}),
  
  // 检查点
  checkpoint: CheckpointConfigSchema.default({}),
  
  // HITL
  hitl: HITLConfigSchema.default({}),
  
  // 可观测性
  observability: ObservabilityConfigSchema.default({}),
  
  // MCP 服务器
  mcpServers: z.record(z.object({
    type: z.enum(['stdio', 'http', 'ws']),
    command: z.array(z.string()).optional(),  // stdio
    url: z.string().optional(),  // http/ws
    enabled: z.boolean().default(true),
    timeout: z.number().positive().default(5000),
  })).default({}),
  
  // 工作流
  workflows: z.record(z.unknown()).default({}),
  
  // 技能路径
  skillPaths: z.array(z.string()).default([]),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
```

### 3.2 配置文件位置

```typescript
// src/core/config/paths.ts
import path from 'path';
import os from 'os';
import { existsSync } from 'fs';

/**
 * 配置文件搜索路径（优先级从高到低）:
 * 
 * 1. AGENTFORGE_CONFIG 环境变量指定的路径
 * 2. 当前目录 .agentforge/config.jsonc
 * 3. 当前目录 agentforge.config.jsonc
 * 4. 用户目录 ~/.agentforge/config.jsonc
 * 5. 系统目录 /etc/agentforge/config.jsonc (Linux/macOS)
 *    或 %ProgramData%\agentforge\config.jsonc (Windows)
 */

const CONFIG_FILENAMES = [
  'agentforge.config.jsonc',
  'agentforge.config.json',
  'config.jsonc',
  'config.json',
];

export function getConfigPaths(): string[] {
  const paths: string[] = [];
  
  // 1. 环境变量指定
  const envConfig = process.env.AGENTFORGE_CONFIG;
  if (envConfig) {
    paths.push(envConfig);
  }
  
  // 2. 当前目录
  const cwd = process.cwd();
  for (const name of CONFIG_FILENAMES) {
    paths.push(path.join(cwd, '.agentforge', name));
    paths.push(path.join(cwd, name));
  }
  
  // 3. 用户目录
  const userConfigDir = process.env.AGENTFORGE_CONFIG_DIR 
    ?? path.join(os.homedir(), '.agentforge');
  for (const name of CONFIG_FILENAMES) {
    paths.push(path.join(userConfigDir, name));
  }
  
  // 4. 系统目录
  if (process.platform === 'win32') {
    const programData = process.env.ProgramData ?? 'C:\\ProgramData';
    for (const name of CONFIG_FILENAMES) {
      paths.push(path.join(programData, 'agentforge', name));
    }
  } else {
    for (const name of CONFIG_FILENAMES) {
      paths.push(path.join('/etc', 'agentforge', name));
    }
  }
  
  return paths;
}

export function findConfigFile(): string | undefined {
  for (const p of getConfigPaths()) {
    if (existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

export function getUserConfigDir(): string {
  return process.env.AGENTFORGE_CONFIG_DIR 
    ?? path.join(os.homedir(), '.agentforge');
}

export function getUserDataDir(): string {
  return process.env.AGENTFORGE_DATA_DIR 
    ?? path.join(os.homedir(), '.agentforge', 'data');
}
```

---

## 4. 配置加载器

### 4.1 JSONC 解析器

```typescript
// src/core/config/parser.ts
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';

/**
 * 解析 JSONC (JSON with Comments)
 * 支持尾逗号、注释、多行字符串
 */
export function parseJsonc<T = unknown>(
  text: string,
  filepath: string,
): T {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parseJsonc(text, errors, {
    allowTrailingComma: true,
    allowEmptyContent: false,
  });
  
  if (errors.length > 0) {
    const lines = text.split('\n');
    const errorMessages = errors.map((e) => {
      const beforeOffset = text.substring(0, e.offset).split('\n');
      const line = beforeOffset.length;
      const column = beforeOffset[beforeOffset.length - 1]!.length + 1;
      const problemLine = lines[line - 1];
      
      return `  ${printParseErrorCode(e.error)} at line ${line}, column ${column}\n` +
             `  ${problemLine ?? ''}\n` +
             `  ${' '.repeat(column + 1)}^`;
    });
    
    throw new ConfigParseError(filepath, errorMessages.join('\n'));
  }
  
  return data as T;
}

export class ConfigParseError extends Error {
  constructor(
    public readonly filepath: string,
    public readonly details: string,
  ) {
    super(`Failed to parse config file: ${filepath}\n${details}`);
    this.name = 'ConfigParseError';
  }
}
```

### 4.2 配置加载器

```typescript
// src/core/config/loader.ts
// (事件广播使用 AgentEventEmitter)
import { existsSync, readFileSync, watch } from 'fs';
import { z } from 'zod';
import { AppConfigSchema, AppConfig } from './schema.js';
import { parseJsonc, ConfigParseError } from './parser.js';
import { findConfigFile } from './paths.js';
import { getDefaultConfig } from './defaults.js';

// ========== 全局缓存（懒加载单例） ==========

let _configCache: AppConfig | null = null;
let _configPath: string | undefined;
const _configChanges$ = new ReplaySubject<AppConfig>(1);
let _watcher: ReturnType<typeof watch> | null = null;

// ========== 加载器 ==========

/**
 * 加载配置（懒加载 + 缓存）
 * 
 * Tier 1 校验：外部配置文件强校验 + 兜底降级
 */
export function loadConfig(
  explicitPath?: string,
  options?: { noCache?: boolean },
): AppConfig {
  // 缓存命中
  if (_configCache && !options?.noCache) {
    return _configCache;
  }
  
  // 查找配置文件
  const configPath = explicitPath ?? findConfigFile();
  _configPath = configPath;
  
  // 无配置文件 → 返回默认配置
  if (!configPath || !existsSync(configPath)) {
    const defaultConfig = getDefaultConfig();
    _configCache = applyEnvOverrides(defaultConfig);
    _configChanges$.next(_configCache);
    return _configCache;
  }
  
  // 读取并解析
  let rawConfig: unknown;
  try {
    const content = readFileSync(configPath, 'utf-8');
    rawConfig = parseJsonc(content, configPath);
  } catch (err) {
    if (err instanceof ConfigParseError) {
      console.error(`Config parse error: ${err.message}`);
      // 兜底降级
      _configCache = applyEnvOverrides(getDefaultConfig());
      _configChanges$.next(_configCache);
      return _configCache;
    }
    throw err;
  }
  
  // Zod 校验（Tier 1）
  const result = AppConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    console.warn('Config validation errors:', result.error.issues);
    // 兜底降级：使用默认配置 + 警告
    _configCache = applyEnvOverrides(getDefaultConfig());
    _configChanges$.next(_configCache);
    return _configCache;
  }
  
  // 应用环境变量覆盖
  _configCache = applyEnvOverrides(result.data);
  _configChanges$.next(_configCache);
  return _configCache;
}

/**
 * 监听配置变更（热更新）
 * 
 * 符合 AgentForge: 使用 RxJS Subject
 */
export function watchConfig(destroy$: Observable<void>): Observable<AppConfig> {
  // 启动文件监听
  if (!_watcher && _configPath) {
    try {
      _watcher = watch(_configPath, (eventType) => {
        if (eventType === 'change') {
          try {
            clearConfigCache();
            loadConfig(_configPath);
          } catch (err) {
            console.error('Config reload failed:', err);
          }
        }
      });
    } catch {
      // 文件监听不可用（如权限不足）
    }
  }
  
  return this.configChanges?.pipe(takeUntil(destroy$));
// 替换为:
  if (this.configChanges) {
    const sub = this.configChanges.subscribe(callback);
    destroySignal.addEventListener('abort', () => sub.unsubscribe());
  }
}

/**
 * 清除缓存（测试用）
 */
export function clearConfigCache(): void {
  _configCache = null;
  _watcher?.close();
  _watcher = null;
}

/**
 * 强制重新加载
 */
export function reloadConfig(): AppConfig {
  clearConfigCache();
  return loadConfig(_configPath, { noCache: true });
}
```

### 4.3 环境变量覆盖

```typescript
// src/core/config/env.ts

const ENV_PREFIX = 'AGENTFORGE_';

/**
 * 环境变量优先级（从高到低）:
 * 
 * 1. AGENTFORGE_MODEL - 默认模型
 * 2. ANTHROPIC_MODEL / OPENAI_MODEL - Provider 特定模型
 * 3. ANTHROPIC_API_KEY / OPENAI_API_KEY - API 密钥
 * 4. ANTHROPIC_BASE_URL / OPENAI_BASE_URL - 自定义端点
 */

const ENV_VAR_MAPPING = {
  // 模型相关
  model: 'AGENTFORGE_MODEL',
  apiKey: ['AGENTFORGE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  baseUrl: ['AGENTFORGE_BASE_URL', 'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL'],
  
  // 行为相关
  maxSteps: 'AGENTFORGE_MAX_STEPS',
  timeout: 'AGENTFORGE_TIMEOUT',
  temperature: 'AGENTFORGE_TEMPERATURE',
  
  // 检查点
  checkpointEnabled: 'AGENTFORGE_CHECKPOINT_ENABLED',
  checkpointStorage: 'AGENTFORGE_CHECKPOINT_STORAGE',
  
  // 可观测
  tracingEnabled: 'AGENTFORGE_TRACING_ENABLED',
  logLevel: 'AGENTFORGE_LOG_LEVEL',
} as const;

/**
 * 解析环境变量
 */
function resolveEnvVar(key: string | readonly string[]): string | undefined {
  const keys = Array.isArray(key) ? key : [key];
  
  for (const k of keys) {
    // 1. 检查带前缀版本
    const prefixed = k.startsWith(ENV_PREFIX) ? k : `${ENV_PREFIX}${k.toUpperCase()}`;
    if (process.env[prefixed]) {
      return process.env[prefixed];
    }
    
    // 2. 检查原始名称（如 ANTHROPIC_API_KEY）
    if (process.env[k]) {
      return process.env[k];
    }
  }
  
  return undefined;
}

/**
 * 解析布尔值
 */
function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * 解析数字
 */
function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

/**
 * 应用环境变量覆盖
 */
export function applyEnvOverrides(config: AppConfig): AppConfig {
  const updates: Partial<AppConfig> = {};
  
  // 模型配置
  const model = resolveEnvVar('model');
  const apiKey = resolveEnvVar(ENV_VAR_MAPPING.apiKey);
  const baseUrl = resolveEnvVar(ENV_VAR_MAPPING.baseUrl);
  
  if (model || apiKey || baseUrl) {
    updates.defaultModel = {
      ...config.defaultModel,
      model: model ?? config.defaultModel.model,
      apiKey: apiKey ?? config.defaultModel.apiKey,
      baseUrl: baseUrl ?? config.defaultModel.baseUrl,
    } as typeof config.defaultModel;
  }
  
  // 行为配置
  const maxSteps = parseNumber(resolveEnvVar('maxSteps'));
  const timeout = parseNumber(resolveEnvVar('timeout'));
  const temperature = parseNumber(resolveEnvVar('temperature'));
  
  if (maxSteps !== undefined || timeout !== undefined || temperature !== undefined) {
    // 应用到默认 Agent
    updates.agents = {
      ...config.agents,
      default: {
        ...config.agents.default,
        maxSteps: maxSteps ?? config.agents.default?.maxSteps,
        timeout: timeout ?? config.agents.default?.timeout,
        temperature: temperature ?? config.agents.default?.temperature,
      } as AgentConfig,
    };
  }
  
  // 检查点配置
  const checkpointEnabled = parseBoolean(resolveEnvVar('checkpointEnabled'));
  const checkpointStorage = resolveEnvVar('checkpointStorage');
  
  if (checkpointEnabled !== undefined || checkpointStorage) {
    updates.checkpoint = {
      ...config.checkpoint,
      enabled: checkpointEnabled ?? config.checkpoint.enabled,
      storage: (checkpointStorage as 'memory' | 'sqlite' | 'filesystem') ?? config.checkpoint.storage,
    };
  }
  
  // 可观测配置
  const tracingEnabled = parseBoolean(resolveEnvVar('tracingEnabled'));
  const logLevel = resolveEnvVar('logLevel');
  
  if (tracingEnabled !== undefined || logLevel) {
    updates.observability = {
      ...config.observability,
      tracing: {
        ...config.observability.tracing,
        enabled: tracingEnabled ?? config.observability.tracing.enabled,
      },
      logging: {
        ...config.observability.logging,
        level: (logLevel as 'debug' | 'info' | 'warn' | 'error') ?? config.observability.logging.level,
      },
    };
  }
  
  return { ...config, ...updates };
}
```

---

## 5. Provider Profile 系统

### 5.1 Profile 定义

```typescript
// src/core/config/profiles.ts
import { ProviderProfile } from './schema.js';

/**
 * 内置 Provider Profile
 * 
 * 设计参考: OpenHarness 的多配置切换系统
 */
export const BUILTIN_PROFILES: Record<string, ProviderProfile> = {
  // Anthropic Claude
  'claude-api': {
    label: 'Claude API',
    provider: 'anthropic',
    authSource: 'api_key',
    defaultModel: 'claude-sonnet-4-6',
  },
  
  // OpenAI GPT
  'openai-api': {
    label: 'OpenAI API',
    provider: 'openai',
    authSource: 'api_key',
    defaultModel: 'gpt-4o',
  },
  
  // Google Gemini
  'gemini-api': {
    label: 'Google Gemini',
    provider: 'google',
    authSource: 'api_key',
    defaultModel: 'gemini-2.5-flash',
  },
  
  // DeepSeek
  'deepseek-api': {
    label: 'DeepSeek',
    provider: 'openai',  // OpenAI 兼容
    authSource: 'api_key',
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  
  // Moonshot Kimi
  'moonshot-api': {
    label: 'Moonshot (Kimi)',
    provider: 'openai',  // OpenAI 兼容
    authSource: 'api_key',
    defaultModel: 'kimi-k2.5',
    baseUrl: 'https://api.moonshot.cn/v1',
  },
  
  // MiniMax
  'minimax-api': {
    label: 'MiniMax',
    provider: 'openai',  // OpenAI 兼容
    authSource: 'api_key',
    defaultModel: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimax.io/v1',
  },
  
  // 本地 Ollama
  'ollama-local': {
    label: 'Ollama Local',
    provider: 'custom',
    authSource: 'none',
    defaultModel: 'llama3',
    baseUrl: 'http://localhost:11434/v1',
  },
};

/**
 * 合并用户 Profile 和内置 Profile
 */
export function mergeProfiles(
  userProfiles: Record<string, ProviderProfile>,
): Record<string, ProviderProfile> {
  return { ...BUILTIN_PROFILES, ...userProfiles };
}

/**
 * 解析 Profile 名称
 * 
 * 支持: "claude-api" 或 "anthropic/claude-sonnet-4-6"
 */
export function parseProfileName(
  profileName: string,
  config: AppConfig,
): { profile: ProviderProfile; model: string } {
  // 直接匹配 Profile 名称
  const profiles = mergeProfiles(config.profiles);
  if (profiles[profileName]) {
    return {
      profile: profiles[profileName]!,
      model: profiles[profileName]!.defaultModel,
    };
  }
  
  // 解析 "provider/model" 格式
  if (profileName.includes('/')) {
    const [provider, model] = profileName.split('/') as [string, string];
    const matchingProfile = Object.values(profiles).find(
      (p) => p.provider === provider,
    );
    
    if (matchingProfile) {
      return { profile: matchingProfile, model };
    }
  }
  
  // 回退到默认 Profile
  return {
    profile: BUILTIN_PROFILES['claude-api']!,
    model: config.defaultModel.model,
  };
}
```

### 5.2 认证解析

```typescript
// src/core/config/auth.ts
import { ProviderProfile } from './schema.js';

/**
 * 认证解析结果
 * 
 * 设计参考: OpenHarness 的 ResolvedAuth
 */
export interface ResolvedAuth {
  provider: string;
  authKind: 'api_key' | 'oauth' | 'subscription' | 'none';
  value: string;
  source: 'env' | 'file' | 'keyring' | 'none';
}

/**
 * Provider → 环境变量映射
 */
const AUTH_ENV_MAPPING: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  moonshot: ['MOONSHOT_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
};

/**
 * 解析认证信息
 */
export function resolveAuth(profile: ProviderProfile): ResolvedAuth {
  const { provider, authSource } = profile;
  
  // 无需认证
  if (authSource === 'none') {
    return {
      provider,
      authKind: 'none',
      value: '',
      source: 'none',
    };
  }
  
  // 1. 检查环境变量
  const envKeys = AUTH_ENV_MAPPING[provider] ?? [];
  for (const key of envKeys) {
    const value = process.env[key];
    if (value) {
      return {
        provider,
        authKind: 'api_key',
        value,
        source: 'env',
      };
    }
  }
  
  // 2. 检查文件存储
  // TODO: 实现 ~/.agentforge/credentials.json 读取
  
  // 3. 检查 Keyring
  // TODO: 实现系统密钥链读取
  
  throw new Error(
    `No credentials found for provider "${provider}". ` +
    `Set ${envKeys[0] ?? 'API_KEY'} environment variable.`,
  );
}
```

---

## 6. DI 集成

### 6.1 ApplicationServices 扩展

```typescript
// src/core/config/integration.ts
import { ApplicationServices } from '../context.js';
import { AppConfig } from './schema.js';
import { LLMAdapterFactory } from '../interfaces.js';
import { loadConfig, watchConfig } from './loader.js';

/**
 * 扩展 ApplicationServices 接口
 */
declare module '../context.js' {
  interface ApplicationServices {
    /** 应用配置 */
    config?: AppConfig;
    
    /** 配置变更通知 */
    configChanges?: (handler: (config: AppConfig) => void) => () => void;
  }
}

/**
 * 创建 ApplicationServices（带配置）
 */
export function createApplicationServices(
  configOverrides?: Partial<AppConfig>,
): ApplicationServices {
  // 加载配置
  const config = configOverrides 
    ? { ...loadConfig(), ...configOverrides }
    : loadConfig();
  
  return {
    config,
    tracer: undefined,
    metrics: undefined,
    schemaRegistry: new SchemaRegistry(),
    llmFactory: createLLMAdapterFactory(config),
    toolRegistry: new SimpleToolRegistry(),
  };
}
```

### 6.2 ContextBuilder 集成

```typescript
// src/core/config/context-builder.ts
import { ContextBuilder } from '../context-builder.js';
import { AgentConfig } from './schema.js';
import { parseProfileName } from './profiles.js';
import { resolveAuth } from './auth.js';

declare module '../context-builder.js' {
  interface ContextBuilder {
    /** 从配置文件加载 Agent */
    withAgentConfig(name: string): this;
    
    /** 使用 Profile */
    withProfile(profileName: string): this;
  }
}

ContextBuilder.prototype.withAgentConfig = function(name: string) {
  const config = loadConfig();
  const agentConfig = config.agents[name];
  
  if (!agentConfig) {
    throw new Error(`Agent "${name}" not found in config`);
  }
  
  // 设置 Agent 名称
  this.context.agentName = agentConfig.name;
  
  // 创建 LLM（使用 Agent 特定配置或默认）
  const modelConfig = agentConfig.model ?? config.defaultModel;
  this.context.llm = this.appServices?.llmFactory.create(modelConfig);
  
  // 注册工具
  if (agentConfig.tools && this.context.tools) {
    for (const tool of agentConfig.tools) {
      if (typeof tool === 'string') {
        this.context.tools.register(resolveBuiltinTool(tool));
      } else {
        this.context.tools.register({
          name: tool.name,
          description: '',
          inputSchema: z.object({}),
          execute: async () => '',
        });
      }
    }
  }
  
  return this;
};

ContextBuilder.prototype.withProfile = function(profileName: string) {
  const config = loadConfig();
  const { profile, model } = parseProfileName(profileName, config);
  const auth = resolveAuth(profile);
  
  // 创建模型配置
  const modelConfig = {
    provider: profile.provider as any,
    model,
    apiKey: auth.authKind === 'api_key' ? auth.value : undefined,
    baseUrl: profile.baseUrl,
  };
  
  this.context.llm = this.appServices?.llmFactory.create(modelConfig);
  
  return this;
};
```

---

## 7. API 层集成

### 7.1 createAgent 配置扩展

```typescript
// src/api/create-agent.ts
import { AppConfig, AgentConfig } from '../core/config/schema.js';

export interface CreateAgentOptions {
  /** Agent 名称 */
  name: string;
  
  /** 模型配置（可覆盖配置文件） */
  model?: ModelConfig | string;
  
  /** Profile 名称（如 "claude-api"） */
  profile?: string;
  
  /** 工具列表 */
  tools?: Array<string | Tool>;
  
  /** 最大步数 */
  maxSteps?: number;
  
  /** 超时（毫秒） */
  timeout?: number;
  
  /** 系统提示 */
  systemPrompt?: string;
  
  /** 温度 */
  temperature?: number;
  
  /** 预设（生产/开发） */
  preset?: 'production' | 'development';
}

export function createAgent(options: CreateAgentOptions): Agent {
  // 加载全局配置
  const appConfig = loadConfig();
  
  // 解析模型配置
  let modelConfig: ModelConfig;
  
  if (typeof options.model === 'string') {
    // "anthropic/claude-sonnet-4-6" 格式
    const [provider, model] = options.model.split('/');
    modelConfig = { provider: provider as any, model };
  } else if (options.profile) {
    // 使用 Profile
    const { profile, model } = parseProfileName(options.profile, appConfig);
    const auth = resolveAuth(profile);
    modelConfig = {
      provider: profile.provider as any,
      model,
      apiKey: auth.authKind === 'api_key' ? auth.value : undefined,
      baseUrl: profile.baseUrl,
    };
  } else if (options.model) {
    modelConfig = options.model;
  } else {
    modelConfig = appConfig.defaultModel;
  }
  
  // 构建上下文
  const ctx = ContextBuilder.create()
    .withAgentName(options.name)
    .withLLM(appServices.llmFactory.create(modelConfig))
    .withTools(options.tools ?? [])
    .build();
  
  // 创建 Agent
  const agent = new Agent({
    name: options.name,
    maxSteps: options.maxSteps ?? appConfig.agents.default?.maxSteps ?? 10,
    systemPrompt: options.systemPrompt,
  }, ctx);
  
  // 应用预设
  if (options.preset === 'production') {
    agent.use(productionPreset());
  }
  
  return agent;
}
```

---

## 8. 默认配置

```typescript
// src/core/config/defaults.ts
import { AppConfig } from './schema.js';

export function getDefaultConfig(): AppConfig {
  return {
    version: '1.0.0',
    
    defaultModel: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    
    agents: {
      default: {
        name: 'default',
        maxSteps: 10,
        tools: [],
      },
    },
    
    profiles: {},
    
    checkpoint: {
      enabled: true,
      storage: 'memory',
      autoSave: false,
      interval: 60000,
    },
    
    hitl: {
      enabled: true,
      timeout: 300000,
      defaultAction: 'ask',
    },
    
    observability: {
      tracing: {
        enabled: false,
        exporter: 'none',
      },
      metrics: {
        enabled: false,
        prefix: 'agentforge.',
      },
      logging: {
        level: 'info',
        format: 'text',
      },
    },
    
    mcpServers: {},
    workflows: {},
    skillPaths: [],
  };
}
```

---

## 9. 配置文件示例

### 9.1 基础配置

```jsonc
// agentforge.config.jsonc
{
  "$schema": "https://agentforge.dev/config.json",
  
  // 默认模型
  "defaultModel": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6"
  },
  
  // Agent 模板
  "agents": {
    "coder": {
      "name": "coder",
      "model": { "provider": "openai", "model": "gpt-4o" },
      "tools": ["read", "write", "bash"],
      "maxSteps": 20,
      "systemPrompt": "You are a coding assistant. Write clean, tested code."
    },
    
    "explorer": {
      "name": "explorer",
      "model": { "provider": "openai", "model": "gpt-4o-mini" },
      "tools": ["grep", "glob"],
      "maxSteps": 10,
      "systemPrompt": "Search the codebase and report findings."
    }
  },
  
  // Provider Profile
  "profiles": {
    "claude-api": {
      "label": "Claude API",
      "provider": "anthropic",
      "authSource": "api_key",
      "defaultModel": "claude-sonnet-4-6"
    },
    
    "custom-openai": {
      "label": "Custom OpenAI Endpoint",
      "provider": "openai",
      "authSource": "api_key",
      "baseUrl": "https://api.custom.com/v1",
      "credentialSlot": "custom-slot"
    }
  }
}
```

### 9.2 生产环境配置

```jsonc
// agentforge.config.prod.jsonc
{
  "$schema": "https://agentforge.dev/config.json",
  
  "defaultModel": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6"
  },
  
  "checkpoint": {
    "enabled": true,
    "storage": "sqlite",
    "path": "/var/lib/agentforge/checkpoints.db",
    "autoSave": true,
    "interval": 30000
  },
  
  "observability": {
    "tracing": {
      "enabled": true,
      "exporter": "otel",
      "endpoint": "http://otel-collector:4317"
    },
    "metrics": {
      "enabled": true,
      "prefix": "agentforge.prod."
    },
    "logging": {
      "level": "warn",
      "format": "json"
    }
  }
}
```

---

## 10. 设计约束清单

| 约束 | 描述 | 违反后果 |
|------|------|---------|
| **禁止 Effect-TS** | 不使用 ServiceMap.Service 或 Layer | 与 Agent 生命周期冲突 |
| **懒加载** | 模块导入时不执行 I/O | 影响冷启动性能 |
| **缓存单例** | 配置只加载一次 | 重复 I/O 开销 |
| **Tier 1 兜底** | 校验失败返回默认配置，不崩溃 | Agent 无法启动 |
| **Tier 3 简化** | 内部传递仅 TypeScript 类型 | 运行时开销 |
| **分层合并** | CLI > ENV > 文件 > 默认 | 优先级混乱 |
| **热更新回调** | 使用回调通知变更 | 无法响应配置变化 |
| **DI 融入** | 配置作为 ApplicationServices 一部分 | 依赖注入不一致 |

---

---

## 11. 多实例配置隔离

### 11.1 问题场景

用户电脑上可能同时运行多个基于 AgentForge 构建的应用：

```
┌─────────────────────────────────────────────────────────────────────┐
│                      用户电脑上的多 Agent 场景                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ~/projects/                                                         │
│  ├── app-coder/           # Agent 应用 A                             │
│  │   ├── agentforge.config.jsonc   ← 配置 A                         │
│  │   └── .agentforge/              ← 工作区数据 A                    │
│  │                                                                  │
│  ├── app-reviewer/        # Agent 应用 B                             │
│  │   ├── agentforge.config.jsonc   ← 配置 B                         │
│  │   └── .agentforge/              ← 工作区数据 B                    │
│  │                                                                  │
│  └── app-explorer/        # Agent 应用 C                             │
│      └── agentforge.config.jsonc   ← 配置 C                         │
│                                                                      │
│  ~/.agentforge/          # 全局配置                                   │
│  ├── settings.json       ← 共享设置 (API Keys, Provider Profile)    │
│  └── credentials.json    ← 共享凭证 (避免重复配置)                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**核心问题**：
1. **共享什么？** - API Keys、Provider Profile、凭证（用户不想配置多次）
2. **隔离什么？** - Agent 定义、模型偏好、工具配置、会话数据
3. **如何合并？** - 全局默认 + 项目覆盖

### 11.2 其他框架解决方案

| 框架 | 隔离机制 | 共享配置 | 实例配置 |
|------|---------|---------|---------|
| **AgentScope** | `ContextVar` 每线程/协程 | 无显式共享 | 所有配置按上下文隔离 |
| **DeepAgents** | `DEEPAGENTS_CLI_` 环境变量前缀 | 标准环境变量 | 前缀覆盖 |
| **Mastra** | 独立 `Mastra` 实例 | 无 - 显式配置每实例 | 构造函数传入完整配置 |
| **OpenCode** | Global + Instance (ALS) | `~/.config/opencode/` | 项目 `.opencode/` |
| **OpenHarness** | Profile 系统 | `~/.openharness/settings.json` | `active_profile` 切换 |

### 11.3 AgentForge 推荐方案：三层目录 + Instance ALS

```typescript
// src/core/config/isolation.ts
import { AsyncLocalStorage } from 'async_hooks';
import path from 'path';
import os from 'os';

// ========== 全局配置（共享） ==========

export function getGlobalConfigDir(): string {
  return process.env.AGENTFORGE_CONFIG_DIR 
    ?? path.join(os.homedir(), '.agentforge');
}

export function getGlobalSettingsPath(): string {
  return path.join(getGlobalConfigDir(), 'settings.json');
}

export function getCredentialsPath(): string {
  return path.join(getGlobalConfigDir(), 'credentials.json');
}

// ========== 项目配置（隔离） ==========

export function getProjectConfigDir(projectDir: string): string {
  return path.join(projectDir, '.agentforge');
}

export function getProjectConfigPath(projectDir: string): string {
  return path.join(getProjectConfigDir(projectDir), 'config.jsonc');
}

// ========== 实例隔离（ALS） ==========

export interface InstanceContext {
  /** 项目目录（实例标识） */
  projectDir: string;
  /** 工作区目录 */
  workspaceDir: string;
  /** 应用实例（包含配置） */
  app: ApplicationServices;
}

const instanceALS = new AsyncLocalStorage<InstanceContext>();

export const Instance = {
  /** 获取当前实例上下文 */
  get current(): InstanceContext {
    const ctx = instanceALS.getStore();
    if (!ctx) {
      throw new Error('No instance context. Wrap code in Instance.provide()');
    }
    return ctx;
  },

  /** 在实例上下文中执行代码 */
  async provide<R>(
    projectDir: string,
    fn: () => Promise<R>,
  ): Promise<R> {
    // 1. 加载配置（合并全局 + 项目）
    const config = await loadMergedConfig(projectDir);
    
    // 2. 创建 ApplicationServices
    const app = createApplicationServices(config);
    
    // 3. 构建 InstanceContext
    const ctx: InstanceContext = {
      projectDir,
      workspaceDir: config.workspaceDir ?? projectDir,
      app,
    };
    
    // 4. 在 ALS 中执行
    return instanceALS.run(ctx, fn);
  },

  /** 获取当前实例的配置 */
  get config(): AppConfig {
    return this.current.app.config!;
  },

  /** 检查路径是否属于当前实例 */
  containsPath(filepath: string): boolean {
    const { projectDir, workspaceDir } = this.current;
    const resolved = path.resolve(filepath);
    return resolved.startsWith(projectDir) || resolved.startsWith(workspaceDir);
  },
};
```

### 11.4 目录结构

```
~/.agentforge/                    # 全局配置（共享）
├── settings.json                 # 全局设置（模型偏好、日志级别）
├── credentials.json              # API Keys（mode 600）
├── profiles/                     # Provider Profile
│   ├── claude-api.json
│   └── openai-api.json
└── data/                         # 全局缓存

<project>/.agentforge/            # 项目配置（隔离）
├── config.jsonc                  # 项目设置
├── agents/                       # Agent 定义
│   ├── coder.md
│   └── reviewer.md
├── sessions/                     # 会话数据
└── checkpoints/                  # 检查点
```

### 11.5 使用示例

```typescript
// 多实例并发运行
import { Instance } from 'agentforge';

async function main() {
  // 并发运行两个项目
  await Promise.all([
    // 项目 A
    Instance.provide('/projects/app-coder', async () => {
      const agent = createAgent({ name: 'coder' });
      await agent.run('Fix the bug');
    }),
    
    // 项目 B（完全隔离）
    Instance.provide('/projects/app-reviewer', async () => {
      const agent = createAgent({ name: 'reviewer' });
      await agent.run('Review PR #42');
    }),
  ]);
}
```

### 11.6 配置合并优先级

```
优先级（从高到低）:
1. CLI 参数          --model, --timeout
2. 环境变量          AGENTFORGE_*, ANTHROPIC_API_KEY
3. 项目配置          .agentforge/config.jsonc
4. 全局配置          ~/.agentforge/settings.json
5. 默认值            getDefaultConfig()
```

### 11.7 设计约束

| 约束 | 描述 |
|------|------|
| **ALS 而非 Effect-TS** | AgentForge 明确禁止 Effect-TS |
| **项目目录作为实例 ID** | 简单直观，与 git worktree 兼容 |
| **凭证全局共享** | 用户不想配置多次 API Key |
| **Agent 定义项目隔离** | 不同项目可能需要不同的 Agent |
| **会话数据可配置** | 全局共享或项目隔离均可 |

---

## 12. Server/SDK 架构设计

### 12.1 设计目标

基于对 Mastra、AgentScope、OpenCode、OpenHarness 的深度分析，AgentForge Server/SDK 设计目标：

| 目标 | 描述 | 参考框架 |
|------|------|---------|
| **多框架适配** | 支持 Hono/Express/Fastify | Mastra |
| **实时通信** | SSE 事件流 + WebSocket PTY | OpenCode |
| **实例隔离** | ALS 实现请求级配置 | OpenCode |
| **资源抽象** | Client SDK 资源模式 | Mastra |
| **多 Agent 协调** | ChatRoom 广播模式 | AgentScope |

### 12.2 核心架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AgentForge Server 架构                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      HTTP 框架层                                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │   │
│  │  │  Hono    │  │ Express  │  │ Fastify  │  │  Koa     │        │   │
│  │  │ Adapter  │  │ Adapter  │  │ Adapter  │  │ Adapter  │        │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │   │
│  └───────┼─────────────┼─────────────┼─────────────┼────────────────┘   │
│          │             │             │             │                    │
│          └─────────────┴─────────────┴─────────────┘                    │
│                                    │                                    │
│  ┌─────────────────────────────────┴───────────────────────────────────┐ │
│  │                    ServerCore (框架无关)                           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │ │
│  │  │ RouteRegistry│  │ AuthMiddleware│  │ StreamHandler│               │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │ │
│  │  │ InstanceMgr │  │ SessionStore│  │ RateLimiter │                 │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                    │                                    │
│  ┌─────────────────────────────────┴───────────────────────────────────┐ │
│  │                         AgentForge Core                             │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │ │
│  │  │ Agent Loop  │  │ Observable  │  │ Plugin Hook │                 │ │
│  │  │ (expand)    │  │ EventStream │  │ System      │                 │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.3 Server 抽象基类

```typescript
// src/server/core/base.ts
import { z } from 'zod';
// (使用 AgentEventEmitter 进行事件分发)
import { AppConfig } from '../../core/config/schema.js';
import { ApplicationServices } from '../../core/context.js';

/**
 * HTTP 请求参数（框架无关）
 */
export interface ParsedRequestParams {
  urlParams: Record<string, string>;
  queryParams: Record<string, string | string[]>;
  body: unknown;
  headers: Record<string, string | undefined>;
}

/**
 * 路由响应类型
 */
export type ResponseType = 'json' | 'stream' | 'sse' | 'mcp-http' | 'mcp-sse';

/**
 * 服务端路由定义
 */
export interface ServerRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
  path: string;
  responseType: ResponseType;
  
  // Zod Schema (Tier 2 契约)
  pathParamSchema?: z.ZodSchema;
  queryParamSchema?: z.ZodSchema;
  bodySchema?: z.ZodSchema;
  responseSchema?: z.ZodSchema;
  
  // 处理器
  handler: (params: ParsedRequestParams & ServerContext) => Promise<unknown>;
  
  // 元数据
  openapi?: {
    summary?: string;
    description?: string;
    tags?: string[];
    deprecated?: boolean;
  };
  
  // 认证/授权
  requiresAuth?: boolean;
  requiresPermission?: string;
}

/**
 * 服务端上下文
 */
export interface ServerContext {
  /** 应用实例 */
  app: ApplicationServices;
  /** 请求级实例上下文 */
  instance: InstanceContext;
  /** 请求 ID（链路追踪） */
  requestId: string;
  /** 中止信号 */
  abortSignal: AbortSignal;
  /** 原始请求（框架特定） */
  rawRequest?: unknown;
}

/**
 * Server 抽象基类
 * 
 * @template TApp - HTTP 框架应用类型
 * @template TRequest - 请求类型
 * @template TResponse - 响应类型
 */
export abstract class ForgeServer<TApp, TRequest, TResponse> {
  protected config: AppConfig;
  protected app: ApplicationServices;
  protected httpApp: TApp;
  protected prefix: string;
  protected routes: readonly ServerRoute[];
  
  constructor(options: {
    app: ApplicationServices;
    httpApp: TApp;
    prefix?: string;
  }) {
    this.app = options.app;
    this.config = options.app.config!;
    this.httpApp = options.httpApp;
    this.prefix = options.prefix ?? '/api';
    this.routes = SERVER_ROUTES;
    
    // 注册到 ApplicationServices
    options.app.server = this as unknown as ForgeServer<unknown, unknown, unknown>;
  }
  
  // ========== 抽象方法（框架特定实现） ==========
  
  /** 注册路由 */
  abstract registerRoute(route: ServerRoute): Promise<void>;
  
  /** 获取请求参数 */
  abstract getParams(request: TRequest): Promise<ParsedRequestParams>;
  
  /** 发送响应 */
  abstract sendResponse(
    route: ServerRoute,
    response: TResponse,
    result: unknown
  ): Promise<void>;
  
  /** 流式响应 */
  abstract stream(
    route: ServerRoute,
    response: TResponse,
    source$: Observable<unknown>
  ): Promise<void>;
  
  // ========== 通用逻辑 ==========
  
  /** 初始化 */
  async init(): Promise<void> {
    // 注册中间件
    this.registerContextMiddleware();
    this.registerAuthMiddleware();
    this.registerLoggingMiddleware();
    
    // 注册路由
    for (const route of this.routes) {
      await this.registerRoute(route);
    }
  }
  
  /** 校验请求 */
  protected async validateRequest(
    route: ServerRoute,
    params: ParsedRequestParams
  ): Promise<void> {
    // Path params
    if (route.pathParamSchema && params.urlParams) {
      params.urlParams = await route.pathParamSchema.parseAsync(params.urlParams);
    }
    
    // Query params
    if (route.queryParamSchema && params.queryParams) {
      params.queryParams = await route.queryParamSchema.parseAsync(params.queryParams);
    }
    
    // Body
    if (route.bodySchema && params.body !== undefined) {
      params.body = await route.bodySchema.parseAsync(params.body);
    }
  }
  
  // 子类可覆盖
  protected registerContextMiddleware(): void {}
  protected registerAuthMiddleware(): void {}
  protected registerLoggingMiddleware(): void {}
}
```

### 12.4 Hono 适配器实现

```typescript
// src/server/adapters/hono.ts
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { Context } from 'hono';
import { ForgeServer, ServerRoute, ParsedRequestParams, ServerContext } from '../core/base.js';
import { Instance, InstanceContext } from '../../core/config/isolation.js';
import { v4 as uuid } from 'uuid';

interface HonoVariables {
  instance: InstanceContext;
  requestId: string;
}

export class HonoForgeServer extends ForgeServer<Hono, Request, Context> {
  private hono: Hono<{ Variables: HonoVariables }>;
  
  constructor(options: {
    app: ApplicationServices;
    prefix?: string;
  }) {
    const hono = new Hono<{ Variables: HonoVariables }>();
    super({ ...options, httpApp: hono });
    this.hono = hono;
  }
  
  async registerRoute(route: ServerRoute): Promise<void> {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
    const fullPath = `${this.prefix}${route.path}`;
    
    this.hono[method](fullPath, async (c: Context) => {
      const params = await this.getParams(c.req);
      
      // 校验
      await this.validateRequest(route, params);
      
      // 构建 ServerContext
      const ctx: ServerContext = {
        app: this.app,
        instance: c.get('instance'),
        requestId: c.get('requestId'),
        abortSignal: c.req.raw.signal,
        rawRequest: c.req,
      };
      
      try {
        const result = await route.handler({ ...params, ...ctx });
        
        if (route.responseType === 'stream' || route.responseType === 'sse') {
          return this.stream(route, c, result as Observable<unknown>);
        }
        
        return this.sendResponse(route, c, result);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
      }
    });
  }
  
  async getParams(request: Request): Promise<ParsedRequestParams> {
    const url = new URL(request.url);
    
    // URL params (需从路由提取，Hono 提供 c.req.param())
    // 这里简化处理
    const urlParams: Record<string, string> = {};
    
    // Query params
    const queryParams: Record<string, string | string[]> = {};
    url.searchParams.forEach((value, key) => {
      const existing = queryParams[key];
      if (existing) {
        queryParams[key] = Array.isArray(existing) 
          ? [...existing, value] 
          : [existing, value];
      } else {
        queryParams[key] = value;
      }
    });
    
    // Body
    let body: unknown;
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else if (contentType.includes('multipart/form-data')) {
      body = await request.formData();
    }
    
    // Headers
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    return { urlParams, queryParams, body, headers };
  }
  
  async sendResponse(
    route: ServerRoute,
    response: Context,
    result: unknown
  ): Promise<Response> {
    return response.json(result, 200);
  }
  
  async stream(
    route: ServerRoute,
    response: Context,
    source$: Observable<unknown>
  ): Promise<Response> {
    const isSSE = route.responseType === 'sse';
    
    if (isSSE) {
      response.header('Content-Type', 'text/event-stream');
      response.header('Cache-Control', 'no-cache');
      response.header('Connection', 'keep-alive');
      response.header('X-Accel-Buffering', 'no');
    }
    
    return stream(response, async (s) => {
      await new Promise<void>((resolve, reject) => {
        const subscription = source$.subscribe({
          next: async (value) => {
            const data = JSON.stringify(value);
            if (isSSE) {
              await s.write(`data: ${data}\n\n`);
            } else {
              await s.write(data + '\x1E'); // 使用 RS 分隔符
            }
          },
          complete: async () => {
            if (isSSE) {
              await s.write('data: [DONE]\n\n');
            }
            await s.close();
            resolve();
          },
          error: (err) => {
            reject(err);
          }
        });
        
        // 处理客户端断开
        response.req.raw.signal.addEventListener('abort', () => {
          subscription.unsubscribe();
          resolve();
        });
      });
    });
  }
  
  protected registerContextMiddleware(): void {
    this.hono.use('*', async (c, next) => {
      const requestId = c.req.header('x-request-id') ?? uuid();
      c.set('requestId', requestId);
      
      // 从请求中提取实例信息
      const projectDir = c.req.header('x-project-dir') ?? process.cwd();
      const instance = Instance.current; // ALS 中获取
      
      c.set('instance', instance ?? {
        projectDir,
        workspaceDir: projectDir,
        app: this.app,
      });
      
      await next();
    });
  }
}

// ========== 便捷工厂 ==========

export function createHonoServer(options: {
  app: ApplicationServices;
  prefix?: string;
}): Hono {
  const server = new HonoForgeServer(options);
  server.init();
  return server.httpApp;
}
```

### 12.5 路由定义

```typescript
// src/server/routes/index.ts
import { z } from 'zod';
import { ServerRoute } from '../core/base.js';

// ========== Agents 路由组 ==========
export const AGENTS_ROUTES: readonly ServerRoute[] = [
  {
    method: 'GET',
    path: '/agents',
    responseType: 'json',
    handler: async ({ app }) => {
      return Object.fromEntries(app.agents ?? []);
    },
    openapi: { summary: 'List all agents', tags: ['agents'] },
  },
  {
    method: 'POST',
    path: '/agents/:agentId/run',
    responseType: 'stream',
    bodySchema: z.object({
      input: z.string(),
      options: z.object({
        maxSteps: z.number().optional(),
        timeout: z.number().optional(),
      }).optional(),
    }),
    handler: async ({ body, urlParams, app, instance, abortSignal }) => {
      const { input, options } = body as { input: string; options?: unknown };
      const agentId = urlParams['agentId']!;
      
      // 创建 Agent 实例
      const agent = app.agents?.get(agentId);
      if (!agent) {
        throw new Error(`Agent "${agentId}" not found`);
      }
      
// 返回 Promise 结果
  return agent.run(input, { signal: abortSignal });
    },
    openapi: { summary: 'Run an agent', tags: ['agents'] },
  },
  {
    method: 'POST',
    path: '/agents/:agentId/stream',
    responseType: 'sse',
    bodySchema: z.object({
      input: z.string(),
    }),
    handler: async ({ body, urlParams, app, abortSignal }) => {
      const { input } = body as { input: string };
      const agentId = urlParams['agentId']!;
      
      const agent = app.agents?.get(agentId);
      if (!agent) {
        throw new Error(`Agent "${agentId}" not found`);
      }
      
      // 返回 SSE 流
      return agent.run$(input, { signal: abortSignal });
    },
  },
];

// ========== 工具路由组 ==========
export const TOOLS_ROUTES: readonly ServerRoute[] = [
  {
    method: 'GET',
    path: '/tools',
    responseType: 'json',
    handler: async ({ app }) => {
      const tools = app.toolRegistry?.list() ?? [];
      return Object.fromEntries(tools.map(t => [t.name, t]));
    },
  },
  {
    method: 'POST',
    path: '/tools/:toolName/execute',
    responseType: 'json',
    bodySchema: z.object({
      input: z.record(z.unknown()),
    }),
    handler: async ({ body, urlParams, app }) => {
      const { input } = body as { input: Record<string, unknown> };
      const toolName = urlParams['toolName']!;
      
      const tool = app.toolRegistry?.get(toolName);
      if (!tool) {
        throw new Error(`Tool "${toolName}" not found`);
      }
      
      const result = await tool.execute(input);
      return { result };
    },
  },
];

// ========== MCP 路由组 ==========
export const MCP_ROUTES: readonly ServerRoute[] = [
  {
    method: 'POST',
    path: '/mcp/:serverId',
    responseType: 'mcp-http',
    handler: async ({ body, urlParams, app }) => {
      const serverId = urlParams['serverId']!;
      const mcpServer = app.mcpServers?.get(serverId);
      
      if (!mcpServer) {
        throw new Error(`MCP server "${serverId}" not found`);
      }
      
      // 返回 MCP HTTP 传输结果
      return {
        server: mcpServer,
        httpPath: `/mcp/${serverId}`,
      };
    },
  },
  {
    method: 'GET',
    path: '/mcp/:serverId/sse',
    responseType: 'mcp-sse',
    handler: async ({ urlParams, app }) => {
      const serverId = urlParams['serverId']!;
      const mcpServer = app.mcpServers?.get(serverId);
      
      if (!mcpServer) {
        throw new Error(`MCP server "${serverId}" not found`);
      }
      
      return {
        server: mcpServer,
        ssePath: `/mcp/${serverId}/sse`,
        messagePath: `/mcp/${serverId}/message`,
      };
    },
  },
];

// ========== 全部路由 ==========
export const SERVER_ROUTES: readonly ServerRoute[] = [
  ...AGENTS_ROUTES,
  ...TOOLS_ROUTES,
  ...MCP_ROUTES,
];
```

### 12.6 Client SDK 设计

```typescript
// src/client/sdk.ts
// (使用 AbortController 和回调进行异步控制)
// (事件监听通过 emitter.on())

/**
 * Client 配置
 */
export interface ClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Base Resource
 */
export abstract class BaseResource {
  protected options: ClientOptions;
  
  constructor(options: ClientOptions) {
    this.options = options;
  }
  
  protected async request<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const url = `${this.options.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...this.options.headers,
      ...init?.headers,
    };
    
    const response = await fetch(url, {
      ...init,
      headers,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  protected stream(
    path: string,
    init?: RequestInit
  ): Observable<unknown> {
    const url = `${this.options.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...this.options.headers,
      ...init?.headers,
    };
    
    return new Observable((subscriber) => {
      const controller = new AbortController();
      
      fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          
          const pump = (): Promise<void> =>
            reader.read().then(({ done, value }) => {
              if (done) {
                subscriber.complete();
                return;
              }
              
              buffer += decoder.decode(value, { stream: true });
              
              // 解析 SSE 或 RS 分隔格式
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    subscriber.complete();
                    return;
                  }
                  try {
                    subscriber.next(JSON.parse(data));
                  } catch {
                    // 忽略解析错误
                  }
                } else if (line.endsWith('\x1E')) {
                  try {
                    subscriber.next(JSON.parse(line.slice(0, -1)));
                  } catch {
                    // 忽略解析错误
                  }
                }
              }
              
              return pump();
            });
          
          return pump();
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            subscriber.error(err);
          }
        });
      
      return () => controller.abort();
    });
  }
}

/**
 * Agent Resource
 */
export class Agent extends BaseResource {
  private agentId: string;
  
  constructor(options: ClientOptions, agentId: string) {
    super(options);
    this.agentId = agentId;
  }
  
  /** 获取 Agent 信息 */
  async info(): Promise<AgentInfo> {
    return this.request(`/agents/${this.agentId}`);
  }
  
  /** 运行 Agent（Promise 模式） */
  async run(input: string, options?: RunOptions): Promise<string> {
    const result = await this.request<{ output: string }>(
      `/agents/${this.agentId}/run`,
      {
        method: 'POST',
        body: JSON.stringify({ input, options }),
      }
    );
    return result.output;
  }
  
  /** 运行 Agent（事件驱动模式） */
  run(input: string, options?: RunOptions): Promise<string> {
    return this.stream(
      `/agents/${this.agentId}/stream`,
      {
        method: 'POST',
        body: JSON.stringify({ input, options }),
      }
    ).pipe(
      map((event) => event as AgentEvent)
    );
  }
  
  /** 取消运行 */
  async cancel(runId: string): Promise<void> {
    await this.request(`/agents/${this.agentId}/runs/${runId}/cancel`, {
      method: 'POST',
    });
  }
}

/**
 * Tool Resource
 */
export class Tool extends BaseResource {
  private toolName: string;
  
  constructor(options: ClientOptions, toolName: string) {
    super(options);
    this.toolName = toolName;
  }
  
  /** 执行工具 */
  async execute(input: Record<string, unknown>): Promise<unknown> {
    const result = await this.request<{ result: unknown }>(
      `/tools/${this.toolName}/execute`,
      {
        method: 'POST',
        body: JSON.stringify({ input }),
      }
    );
    return result.result;
  }
}

/**
 * ForgeClient 主类
 */
export class ForgeClient extends BaseResource {
  constructor(options: ClientOptions) {
    super(options);
  }
  
  /** 列出所有 Agent */
  async listAgents(): Promise<Record<string, AgentInfo>> {
    return this.request('/agents');
  }
  
  /** 获取 Agent 实例 */
  getAgent(agentId: string): Agent {
    return new Agent(this.options, agentId);
  }
  
  /** 列出所有工具 */
  async listTools(): Promise<Record<string, ToolInfo>> {
    return this.request('/tools');
  }
  
  /** 获取工具实例 */
  getTool(toolName: string): Tool {
    return new Tool(this.options, toolName);
  }
}

// ========== 便捷工厂 ==========

export function createClient(options: ClientOptions): ForgeClient {
  return new ForgeClient(options);
}
```

### 12.7 多 Agent 协调（ChatRoom 模式）

```typescript
// src/server/coordination/chatroom.ts
// (广播使用 AgentEventEmitter)

/**
 * ChatRoom - 多 Agent 协调器
 * 
 * 设计参考: AgentScope 的 ChatRoom 模式
 * 
 * 使用 asyncio.Queue (Node: Subject) 实现消息广播
 */
export class ChatRoom {
  private agents: Map<string, AgentInstance> = new Map();
  private incoming$: Subject<RoomEvent>;
  private outgoing$: Subject<RoomEvent>;
  private subscriptions: Map<string, unknown[]> = [];
  
  constructor(private roomId: string) {
    this.incoming$ = new Subject();
    this.outgoing$ = new ReplaySubject(100);
  }
  
  /** 加入 Agent */
  join(agent: AgentInstance): void {
    if (this.agents.has(agent.name)) {
      throw new Error(`Agent "${agent.name}" already in room`);
    }
    
    this.agents.set(agent.name, agent);
    
    // 订阅 Agent 的输出
    const sub = agent.output$.pipe(
      filter(event => !event.internal) // 排除内部事件
    ).subscribe(event => {
      // 广播给其他 Agent
      this.broadcast({
        ...event,
        from: agent.name,
        roomId: this.roomId,
      });
    });
    
    this.subscriptions.set(agent.name, [sub]);
  }
  
  /** 离开 Agent */
  leave(agentName: string): void {
    const subs = this.subscriptions.get(agentName);
    if (subs) {
      subs.forEach(s => (s as { unsubscribe: () => void }).unsubscribe());
      this.subscriptions.delete(agentName);
    }
    this.agents.delete(agentName);
  }
  
  /** 广播消息 */
  broadcast(event: RoomEvent): void {
    this.outgoing$.next(event);
    
    // 发送给所有其他 Agent
    for (const [name, agent] of this.agents) {
      if (name !== event.from) {
        this.incoming$.next({
          ...event,
          to: name,
        });
      }
    }
  }
  
  /** 获取事件流 */
  get event$(): Observable<RoomEvent> {
    return this.outgoing$.asObservable();
  }
  
  /** 获取特定 Agent 的输入流 */
  getInput$(agentName: string): Observable<RoomEvent> {
    return this.incoming$.pipe(
      filter(event => event.to === agentName || event.to === '*')
    );
  }
  
  /** 关闭房间 */
  close(): void {
    for (const subs of this.subscriptions.values()) {
      subs.forEach(s => (s as { unsubscribe: () => void }).unsubscribe());
    }
    this.incoming$.complete();
    this.outgoing$.complete();
    this.agents.clear();
  }
}

/**
 * 房间事件
 */
export interface RoomEvent {
  type: 'message' | 'tool_request' | 'tool_result' | 'agent_event';
  from: string;
  to: string | '*';  // '*' 表示广播
  roomId: string;
  payload: unknown;
  timestamp: number;
}

/**
 * Agent 实例接口
 */
export interface AgentInstance {
  name: string;
  output$: Observable<unknown>;
  input(event: unknown): void;
}

// ========== 便捷工厂 ==========

export function createChatRoom(roomId: string): ChatRoom {
  return new ChatRoom(roomId);
}
```

### 12.8 SSE 事件流集成

```typescript
// src/server/streaming/sse.ts
// (SSE 转换使用 AsyncGenerator)
import { AgentEvent } from '../../core/events.js';

/**
 * 将 AgentForge 事件流转换为 SSE 格式
 * 
 * AgentForge 已有 Observable<AgentEvent>，直接转换
 */
export function agentEventToSSE(event$: Observable<AgentEvent>): Observable<string> {
  return new Observable((subscriber) => {
    const subscription = event$.subscribe({
      next: (event) => {
        const sseData = formatSSE(event);
        subscriber.next(sseData);
      },
      complete: () => {
        subscriber.next('data: [DONE]\n\n');
        subscriber.complete();
      },
      error: (err) => {
        subscriber.next(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        subscriber.complete();
      }
    });
    
    return () => subscription.unsubscribe();
  });
}

function formatSSE(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * 提取 SSE 中的增量内容
 * 用于客户端消费
 */
export function extractDeltas<T>(sse$: Observable<string>): Observable<T> {
  return new Observable((subscriber) => {
    const subscription = sse$.subscribe({
      next: (line) => {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data !== '[DONE]') {
            try {
              subscriber.next(JSON.parse(data) as T);
            } catch {
              // 忽略解析错误
            }
          }
        }
      },
      complete: () => subscriber.complete(),
      error: (err) => subscriber.error(err)
    });
    
    return () => subscription.unsubscribe();
  });
}
```

### 12.9 使用示例

```typescript
// ========== Server 端 ==========
import { createApplicationServices } from 'agentforge';
import { createHonoServer } from 'agentforge/server/hono';
import { serve } from '@hono/node-server';

async function startServer() {
  // 创建应用服务
  const app = createApplicationServices({
    config: loadConfig(),
  });
  
  // 创建 Hono Server
  const hono = createHonoServer({ app, prefix: '/api' });
  
  // 启动 HTTP 服务
  serve({ fetch: hono.fetch, port: 3000 }, (info) => {
    console.log(`Server running at http://localhost:${info.port}`);
  });
}

// ========== Client 端 ==========
import { createClient } from 'agentforge/client';

async function runAgent() {
  const client = createClient({ baseUrl: 'http://localhost:3000' });
  
  // 获取 Agent
  const agent = client.getAgent('coder');
  
  // Promise 模式
  const result = await agent.run('Fix the bug in auth.ts');
  console.log(result);
  
  // Observable 模式
  agent.run$('Fix the bug in auth.ts').subscribe({
    next: (event) => console.log(event.type),
    complete: () => console.log('Done!')
  });
}

// ========== 多 Agent 协调 ==========
import { createChatRoom } from 'agentforge/coordination';

async function multiAgentDemo() {
  const room = createChatRoom('code-review');
  
  // 加入 Agent
  room.join(coderAgent);
  room.join(reviewerAgent);
  room.join(explorerAgent);
  
  // 监听事件
  room.event$.subscribe(event => {
    console.log(`[${event.from}] -> [${event.to}]: ${event.type}`);
  });
  
  // 广播任务
  room.broadcast({
    type: 'message',
    from: 'system',
    to: 'coder',
    payload: { task: 'Implement user authentication' }
  });
  
  // 关闭
  room.close();
}
```

### 12.10 设计约束

| 约束 | 描述 | 违反后果 |
|------|------|---------|
| **框架无关基类** | `ForgeServer<TApp, TRequest, TResponse>` 泛型 | 难以适配多框架 |
| **Zod 路由契约** | 路由 Schema 作为 Tier 2 契约 | 请求验证不一致 |
| **Observable 原生** | 直接暴露事件回调 | 需要转换层 |
| **ALS 实例隔离** | AsyncLocalStorage 实现请求级配置 | 全局状态污染 |
| **ChatRoom 回调** | 使用回调广播 | 事件丢失或内存泄漏 |

### 12.11 与其他框架对比

| 特性 | AgentForge | Mastra | AgentScope | OpenCode |
|------|-----------|--------|------------|----------|
| HTTP 框架 | Hono/Express/Fastify | Hono 多适配器 | FastAPI | Hono |
| 实时通信 | SSE (事件回调) | Stream/SSE | WebSocket | SSE + WebSocket |
| Client SDK | TypeScript Resource 模式 | `@mastra/client-js` | A2A Client | SDK spawn 进程 |
| 实例隔离 | ALS + Instance Context | 无显式 | ContextVar | Instance ALS |
| 多 Agent | ChatRoom 回调广播 | Network | ChatRoom Queue | 无内置 |

---

## 相关文档

- [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) - Zod 数据契约层
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [12-API-DESIGN.md](./12-API-DESIGN.md) - API 设计
