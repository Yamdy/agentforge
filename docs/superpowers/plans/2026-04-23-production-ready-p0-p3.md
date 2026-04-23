# AgentForge 生产可用增强计划 (P0-P3)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AgentForge 从骨架框架升级为生产可用框架，补齐 Provider 生态、Tool 上下文、输出截断等核心能力。

**Architecture:** 保持现有 RxJS + Middleware + Workflow 架构不变，增量增强。P0 三项互相关联，统一设计接口后分步实现。P1-P3 基于统一接口扩展。

**Tech Stack:** TypeScript, RxJS 7.8, Vercel AI SDK 6.0, Zod, SQLite (better-sqlite3)

---

## 全局依赖关系

```
P0: Provider 路由 ────────────────────┐
                                       │
P0: Tool.Context ──┬─→ P1: 权限 Ruleset │
                   │                   │
                   ├─→ P1: 生命周期 MW  │
                   │                   │
                   └─→ P2: 会话 Fork   │
                                       │
P0: Truncate ──────┴─→ P1: 持久化存储 ─┘
```

**关键结论**: Tool.Context 接口必须一次设计对，否则 P0-P3 都要改。

---

## Chunk 1: 整体架构 + P0 Provider 详细设计

### 1.1 P0 目标

| 项目 | 当前状态 | 目标状态 |
|------|----------|----------|
| Provider | 只有 `AIAdapter` (单一 OpenAI 兼容) | 20+ Provider 开箱即用 |
| Tool.Context | `execute(args)` 无上下文 | `execute(args, ctx)` 完整上下文 |
| Truncate | 无 | 自动截断 + 临时文件 + 清理 |

### 1.2 P0 工作量估算

| 项目 | 工作量 | 依赖 |
|------|--------|------|
| Provider 多模型路由 | 2-3 周 | 无 |
| Tool.Context | 1 周 | 无 |
| Truncate | 3-5 天 | Tool.Context |

**总工作量**: ~4 周

---

### Task 1: Provider 多模型路由系统

**目标**: 提供 20+ LLM Provider 开箱即用，用户无需手拼 baseURL/apiKey。

**Files:**
- Create: `src/provider/index.ts`
- Create: `src/provider/types.ts`
- Create: `src/provider/registry.ts`
- Create: `src/provider/providers/anthropic.ts`
- Create: `src/provider/providers/openai.ts`
- Create: `src/provider/providers/azure.ts`
- Create: `src/provider/providers/bedrock.ts`
- Create: `src/provider/providers/vertex.ts`
- Create: `src/provider/providers/openrouter.ts`
- Create: `src/provider/providers/ollama.ts`
- Create: `src/provider/providers/custom.ts`
- Create: `src/provider/models.ts`
- Modify: `src/adapters/ai.ts`
- Test: `tests/provider/provider.test.ts`

#### 1.2.1 设计说明

**核心接口**:

```typescript
// src/provider/types.ts

import { z } from 'zod'
import type { LanguageModelV1 } from '@ai-sdk/provider'

// ========== Provider 定义 ==========

export interface ProviderConfig {
  id: string                    // 唯一标识
  name: string                  // 显示名称
  type: ProviderType
  baseURL: string
  headers?: Record<string, string>
  customOptions?: Record<string, unknown>
}

export type ProviderType = 
  | 'anthropic' 
  | 'openai' 
  | 'azure' 
  | 'bedrock' 
  | 'vertex' 
  | 'openrouter' 
  | 'ollama' 
  | 'custom'

// ========== Model 定义 ==========

export interface ModelInfo {
  id: string                    // 模型 ID (e.g., "claude-sonnet-4-20250514")
  providerId: string            // Provider ID
  displayName: string           // 显示名称
  capabilities: ModelCapabilities
  limits: ModelLimits
  pricing: ModelPricing
  deprecated?: boolean
}

export interface ModelCapabilities {
  toolCall: boolean             // 支持工具调用
  reasoning: boolean            // 支持推理 (Claude thinking)
  attachment: boolean           // 支持附件 (图片/PDF)
  streaming: boolean            // 支持流式
  vision: boolean               // 支持视觉
}

export interface ModelLimits {
  context: number              // 最大上下文长度
  output: number               // 最大输出长度
}

export interface ModelPricing {
  input: number                // 每 1M tokens 输入价格 (USD)
  output: number               // 每 1M tokens 输出价格 (USD)
  cache?: number               // 缓存读取价格 (如果有)
}

// ========== Provider 接口 ==========

export interface Provider {
  readonly id: ProviderType
  readonly name: string
  
  // 创建模型实例
  model(modelId: string): LanguageModelV1
  
  // 列出可用模型
  listModels(): Promise<ModelInfo[]>
  
  // 获取单个模型信息
  getModel(modelId: string): Promise<ModelInfo | null>
  
  // 验证配置
  validateConfig(): boolean
  
  // Provider 特定初始化
  init?(): Promise<void>
}

// ========== 统一 Model 工厂 ==========

export interface ModelInstance extends LanguageModelV1 {
  readonly providerId: string
  readonly modelId: string
  readonly info: ModelInfo
}

export function createModel(config: {
  provider: ProviderType | string
  model: string
  options?: ProviderSpecificOptions
}): ModelInstance
```

#### 1.2.2 Provider Registry 设计

```typescript
// src/provider/registry.ts

import type { Provider, ProviderType } from './types'

class ProviderRegistry {
  private providers: Map<ProviderType, Provider> = new Map()
  private modelCache: Map<string, ModelInfo[]> = new Map()
  private modelCacheTTL = 5 * 60 * 1000 // 5 minutes
  
  // 注册 Provider
  register(provider: Provider): void
  
  // 获取 Provider
  get(id: ProviderType): Provider | undefined
  
  // 列出所有 Provider
  list(): Provider[]
  
  // 从 Provider 创建模型
  createModel(providerId: ProviderType, modelId: string): ModelInstance
  
  // 全局模型搜索 (跨 Provider)
  findModel(query: string): Promise<ModelInfo[]>
  
  // 刷新模型缓存 (从 models.dev)
  refreshModels(): Promise<void>
}

// 全局单例
export const providerRegistry = new ProviderRegistry()
```

#### 1.2.3 具体 Provider 实现

**Anthropic Provider** (示例):

```typescript
// src/provider/providers/anthropic.ts

import { createAnthropic } from '@ai-sdk/anthropic'
import type { Provider, ModelInfo } from '../types'

class AnthropicProvider implements Provider {
  readonly id = 'anthropic' as const
  readonly name = 'Anthropic'
  
  private client: ReturnType<typeof createAnthropic>
  private apiKey: string
  
  constructor(config?: { apiKey?: string }) {
    this.apiKey = config?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
    this.client = createAnthropic({ apiKey: this.apiKey })
  }
  
  model(modelId: string) {
    return this.client(modelId)
  }
  
  async listModels(): Promise<ModelInfo[]> {
    // 从 models.dev 或硬编码列表返回
    return ANTHROPIC_MODELS
  }
  
  async getModel(modelId: string): Promise<ModelInfo | null> {
    const models = await this.listModels()
    return models.find(m => m.id === modelId) ?? null
  }
  
  validateConfig(): boolean {
    return !!this.apiKey
  }
}

// Anthropic 模型列表 (硬编码 + models.dev 补充)
const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    providerId: 'anthropic',
    displayName: 'Claude Sonnet 4',
    capabilities: {
      toolCall: true,
      reasoning: true,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 200000, output: 16000 },
    pricing: { input: 3.0, output: 15.0 },
  },
  // ... 更多模型
]

export const anthropicProvider = new AnthropicProvider()
```

**OpenAI Provider**:

```typescript
// src/provider/providers/openai.ts

import { openai } from '@ai-sdk/openai'
import type { Provider, ModelInfo } from '../types'

class OpenAIProvider implements Provider {
  readonly id = 'openai' as const
  readonly name = 'OpenAI'
  
  private apiKey: string
  private baseURL?: string
  
  constructor(config?: { apiKey?: string; baseURL?: string }) {
    this.apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    this.baseURL = config?.baseURL
  }
  
  model(modelId: string) {
    return openai(modelId, {
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    })
  }
  
  async listModels(): Promise<ModelInfo[]> {
    return OPENAI_MODELS
  }
  
  // ...
}
```

**Bedrock Provider** (需要特殊处理):

```typescript
// src/provider/providers/bedrock.ts

import { bedrock } from '@ai-sdk/amazon-bedrock'
import type { Provider, ModelInfo } from '../types'

class BedrockProvider implements Provider {
  readonly id = 'bedrock' as const
  readonly name = 'AWS Bedrock'
  
  // Bedrock 特有: 跨区域推理前缀
  // us.anthropic.claude-3-5-sonnet
  // eu.anthropic.claude-3-5-sonnet
  // global.anthropic.claude-3-5-sonnet
  
  private region?: string
  
  constructor(config?: { region?: string }) {
    this.region = config?.region ?? process.env.AWS_REGION ?? 'us-east-1'
  }
  
  model(modelId: string) {
    // 处理跨区域前缀
    const [region, ...modelParts] = modelId.split('.')
    if (['us', 'eu', 'global'].includes(region)) {
      return bedrock(modelParts.join('.'))
    }
    return bedrock(modelId)
  }
  
  // ...
}
```

**Custom Provider** (兼容任意 OpenAI 兼容 API):

```typescript
// src/provider/providers/custom.ts

import { openai } from '@ai-sdk/openai'
import type { Provider, ModelInfo } from '../types'

interface CustomProviderConfig {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
}

class CustomProvider implements Provider {
  readonly id = 'custom' as const
  readonly name = 'Custom'
  
  private config: CustomProviderConfig
  
  constructor(config: CustomProviderConfig) {
    this.config = config
  }
  
  model(modelId: string) {
    return openai(modelId, {
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      headers: this.config.headers,
    })
  }
  
  listModels(): Promise<ModelInfo[]> {
    // Custom Provider 无法列出模型，返回空
    return Promise.resolve([])
  }
  
  validateConfig(): boolean {
    return !!this.config.baseURL
  }
}

export function createCustomProvider(config: CustomProviderConfig): Provider {
  return new CustomProvider(config)
}
```

#### 1.2.4 Models.dev 集成

```typescript
// src/provider/models.ts

interface ModelsDevResponse {
  models: Array<{
    id: string
    name: string
    provider: string
    context_length: number
    max_output_tokens?: number
    pricing: { input: number; output: number }
    capabilities: string[]
  }>
}

const MODELS_DEV_URL = 'https://models.dev/api/models.json'
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

let cache: { data: ModelInfo[]; timestamp: number } | null = null

export async function fetchModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.data
  }
  
  try {
    const response = await fetch(MODELS_DEV_URL)
    const data: ModelsDevResponse = await response.json()
    
    const models: ModelInfo[] = data.models.map(m => ({
      id: m.id,
      providerId: m.provider,
      displayName: m.name,
      capabilities: {
        toolCall: m.capabilities.includes('tool_calls'),
        reasoning: m.capabilities.includes('reasoning'),
        attachment: m.capabilities.includes('attachments') || m.capabilities.includes('vision'),
        streaming: true,
        vision: m.capabilities.includes('vision'),
      },
      limits: {
        context: m.context_length,
        output: m.max_output_tokens ?? 4096,
      },
      pricing: {
        input: m.pricing.input,
        output: m.pricing.output,
      },
    }))
    
    cache = { data: models, timestamp: Date.now() }
    return models
  } catch (error) {
    console.warn('Failed to fetch models from models.dev:', error)
    return cache?.data ?? []
  }
}

export async function findModel(query: string): Promise<ModelInfo | null> {
  const models = await fetchModels()
  const lowerQuery = query.toLowerCase()
  return models.find(m => 
    m.id.toLowerCase().includes(lowerQuery) ||
    m.displayName.toLowerCase().includes(lowerQuery)
  ) ?? null
}
```

#### 1.2.5 统一导出

```typescript
// src/provider/index.ts

// Provider 实例
export { anthropicProvider } from './providers/anthropic'
export { openaiProvider } from './providers/openai'
export { azureProvider } from './providers/azure'
export { bedrockProvider } from './providers/bedrock'
export { vertexProvider } from './providers/vertex'
export { openrouterProvider } from './providers/openrouter'
export { ollamaProvider } from './providers/ollama'
export { createCustomProvider } from './providers/custom'

// Registry
export { providerRegistry, ProviderRegistry } from './registry'

// 模型发现
export { fetchModels, findModel } from './models'

// 类型
export type { 
  Provider, 
  ProviderConfig, 
  ProviderType,
  ModelInfo,
  ModelCapabilities,
  ModelLimits,
  ModelPricing,
  ModelInstance,
} from './types'

// 便捷函数
import { providerRegistry } from './registry'

/**
 * 创建模型实例 - 主要入口
 * 
 * @example
 * // Anthropic
 * const model = Provider.model('anthropic', 'claude-sonnet-4')
 * 
 * // OpenAI
 * const model = Provider.model('openai', 'gpt-4o')
 * 
 * // Custom
 * const model = Provider.model('custom', 'my-model', { baseURL: 'http://localhost:11434/v1' })
 */
export const Provider = {
  model: (providerId: string, modelId: string, options?: Record<string, unknown>) => 
    providerRegistry.createModel(providerId as any, modelId),
  
  list: () => providerRegistry.list(),
  
  get: (id: string) => providerRegistry.get(id as any),
  
  findModel: (query: string) => findModel(query),
}
```

#### 1.2.6 修改 AIAdapter

```typescript
// src/adapters/ai.ts - 修改现有文件

import { Provider } from '../provider/index'

// 现有构造函数保持兼容
constructor(config: AIAdapterConfig) {
  // 已有逻辑...
}

// 新增: 从 Provider 创建
static fromProvider(providerId: string, modelId: string): AIAdapter {
  const model = Provider.model(providerId, modelId)
  return new AIAdapter({ model })
}

// 新增: 模型能力查询
get modelInfo(): ModelInfo | null {
  return Provider.findModel(this.config.model)
}
```

#### 1.2.7 测试用例

```typescript
// tests/provider/provider.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { Provider, providerRegistry } from '../src/provider'

describe('Provider System', () => {
  describe('Provider Registry', () => {
    it('should list available providers', () => {
      const providers = Provider.list()
      expect(providers.length).toBeGreaterThan(5)
      expect(providers.find(p => p.id === 'anthropic')).toBeDefined()
    })
    
    it('should get specific provider', () => {
      const anthropic = Provider.get('anthropic')
      expect(anthropic?.name).toBe('Anthropic')
    })
  })
  
  describe('Model Creation', () => {
    it('should create Anthropic model', () => {
      const model = Provider.model('anthropic', 'claude-sonnet-4')
      expect(model).toBeDefined()
      expect(model.providerId).toBe('anthropic')
      expect(model.modelId).toBe('claude-sonnet-4')
    })
    
    it('should create OpenAI model', () => {
      const model = Provider.model('openai', 'gpt-4o')
      expect(model).toBeDefined()
    })
    
    it('should create custom provider model', () => {
      const model = Provider.model('custom', 'llama3', {
        baseURL: 'http://localhost:11434/v1'
      })
      expect(model).toBeDefined()
    })
  })
  
  describe('Model Discovery', () => {
    it('should find model by query', async () => {
      const model = await Provider.findModel('claude sonnet')
      expect(model).toBeDefined()
      expect(model?.providerId).toBe('anthropic')
    })
    
    it('should return model capabilities', async () => {
      const model = await Provider.findModel('gpt-4o')
      expect(model?.capabilities.toolCall).toBe(true)
      expect(model?.capabilities.vision).toBe(true)
    })
  })
})
```

---

## Chunk 2: Tool.Context 详细设计

### 2.1 设计原则

Tool.Context 必须一次设计对，因为：

1. **P1 权限 Ruleset** 需要在 `beforeToolExecute` 中访问上下文决定 allow/deny/ask
2. **P1 生命周期 Middleware** 钩子签名依赖 ToolContext
3. **P2 会话 Fork** 需要克隆消息，ToolResult 要能引用附件
4. **P2 事件溯源** 事件字段要包含 ToolContext 关键信息

### 2.2 当前接口 vs 目标接口

**当前** (`src/types.ts`):
```typescript
interface Tool {
  name: string
  description: string
  parameters?: ToolParameters
  execute(args: Record<string, unknown>): Promise<string>  // 只有 args
}
```

**目标**:
```typescript
interface Tool<P = unknown, M = unknown> {
  name: string
  description: string | ((ctx: ToolContext) => string)  // 动态描述
  parameters?: z.ZodType<P>                              // Zod schema
  execute(args: P, ctx: ToolContext): Promise<ToolResult<M>>
}
```

### Task 2: Tool.Context 上下文系统

**Files:**
- Modify: `src/types.ts` (Tool 接口重定义)
- Create: `src/tool/context.ts`
- Create: `src/tool/result.ts`
- Create: `src/tool/attachment.ts`
- Modify: `src/tools/builtin/*.ts` (所有内置工具适配)
- Modify: `src/agent/agent.ts` (传递上下文)
- Modify: `src/registry.ts` (Registry 适配)
- Test: `tests/tool/context.test.ts`

#### 2.2.1 ToolContext 接口设计

```typescript
// src/tool/context.ts

import type { Message } from '../types'
import type { AbortSignal } from 'node:abort-controller'
import type { AskInput, AskResult } from './ask'

/**
 * Tool 执行上下文
 * 
 * 所有工具执行时都会收到这个上下文，提供：
 * - 会话和消息标识
 * - 取消信号
 * - 对话历史
 * - 运行时元数据更新
 * - 用户交互能力
 */
export interface ToolContext {
  // ========== 标识 ==========
  
  /** 当前会话 ID */
  sessionId: string
  
  /** 当前消息 ID */
  messageId: string
  
  /** 工具调用 ID (LLM 返回的 tool_call_id) */
  callId: string
  
  /** 当前 Agent 名称 */
  agent: string
  
  // ========== 控制 ==========
  
  /** 取消信号 - Agent 被 cancel 或 timeout 时触发 */
  abort: AbortSignal
  
  // ========== 数据访问 ==========
  
  /** 完整对话历史（只读） */
  messages: readonly Message[]
  
  // ========== 运行时能力 ==========
  
  /**
   * 更新工具元数据（运行时）
   * 用于显示进度或附加信息
   * 
   * @example
   * ctx.metadata({ title: 'Processing file...', metadata: { filesProcessed: 5 } })
   */
  metadata(input: MetadataInput): void
  
  /**
   * 向用户提问
   * 用于权限请求或需要用户输入的场景
   * 
   * @example
   * const result = await ctx.ask({
   *   message: 'Allow file write?',
   *   choices: ['Yes', 'No', 'Always']
   * })
   */
  ask(input: AskInput): Promise<AskResult>
  
  // ========== P1 预留 ==========
  
  /**
   * 权限检查 (P1 实现)
   * 工具可以主动检查是否有权限执行某操作
   */
  checkPermission?(action: string, resource: string): Promise<boolean>
  
  /**
   * 记录事件 (P2 事件溯源)
   */
  recordEvent?(event: string, data: Record<string, unknown>): void
}

// ========== 辅助类型 ==========

export interface MetadataInput {
  /** 工具结果标题 */
  title?: string
  /** 附加元数据 */
  metadata?: Record<string, unknown>
  /** 进度 (0-100) */
  progress?: number
}

export interface AskInput {
  /** 问题内容 */
  message: string
  /** 可选项 */
  choices?: string[]
  /** 默认选项 */
  defaultChoice?: string
  /** 是否允许用户输入自定义答案 */
  allowCustom?: boolean
}

export interface AskResult {
  /** 用户选择 */
  choice: string
  /** 是否是自定义输入 */
  isCustom?: boolean
  /** 是否选择"总是"（用于权限） */
  always?: boolean
}
```

#### 2.2.2 ToolResult 接口设计

```typescript
// src/tool/result.ts

import type { Attachment } from './attachment'

/**
 * 工具执行结果
 * 
 * 设计考虑：
 * - title: 简短标题，用于 UI 显示
 * - output: 完整输出内容
 * - metadata: 结构化元数据（可被其他工具/Agent 使用）
 * - attachments: 文件附件（图片、PDF 等）
 */
export interface ToolResult<M = unknown> {
  /** 简短标题（UI 显示用） */
  title: string
  
  /** 完整输出内容 */
  output: string
  
  /** 结构化元数据 */
  metadata?: M
  
  /** 文件附件 */
  attachments?: Attachment[]
  
  /** 是否被截断 (P0 Truncate 使用) */
  truncated?: boolean
  
  /** 如果截断，完整内容的文件路径 */
  outputPath?: string
}

/**
 * 创建简单文本结果
 */
export function textResult(output: string, title?: string): ToolResult {
  return {
    title: title ?? output.slice(0, 50),
    output,
  }
}

/**
 * 创建带元数据的结果
 */
export function resultWithMetadata<M>(
  output: string, 
  metadata: M, 
  title?: string
): ToolResult<M> {
  return {
    title: title ?? output.slice(0, 50),
    output,
    metadata,
  }
}

/**
 * 创建带附件的结果
 */
export function resultWithAttachments(
  output: string,
  attachments: Attachment[],
  title?: string
): ToolResult {
  return {
    title: title ?? output.slice(0, 50),
    output,
    attachments,
  }
}

/**
 * 创建截断结果 (P0 Truncate 使用)
 */
export function truncatedResult(
  output: string,
  fullPath: string,
  title?: string
): ToolResult {
  return {
    title: title ?? output.slice(0, 50),
    output,
    truncated: true,
    outputPath: fullPath,
  }
}
```

#### 2.2.3 Attachment 接口设计

```typescript
// src/tool/attachment.ts

/**
 * 文件附件
 * 
 * 用于工具返回图片、PDF、代码文件等
 */
export interface Attachment {
  /** 内容类型 (MIME type) */
  contentType: string
  
  /** 文件名 */
  name?: string
  
  /** 内容（Base64 编码） */
  content: string
  
  /** 或 URL */
  url?: string
}

/**
 * 创建图片附件
 */
export function imageAttachment(
  content: Buffer | string, 
  name?: string
): Attachment {
  const base64 = Buffer.isBuffer(content) 
    ? content.toString('base64') 
    : content
  
  return {
    contentType: 'image/png',
    name,
    content: base64,
  }
}

/**
 * 创建 PDF 附件
 */
export function pdfAttachment(content: Buffer, name?: string): Attachment {
  return {
    contentType: 'application/pdf',
    name,
    content: content.toString('base64'),
  }
}
```

#### 2.2.4 新 Tool 接口定义

```typescript
// src/types.ts - 修改现有定义

import { z } from 'zod'
import type { ToolContext, ToolResult } from './tool/context'

// 保留旧接口以兼容
export const LegacyToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: ToolParametersSchema.optional(),
  execute: z.custom<(args: Record<string, unknown>) => Promise<string>>(),
})
export type LegacyTool = z.infer<typeof LegacyToolSchema>

// 新 Tool 接口
export interface Tool<P = unknown, M = unknown> {
  /** 工具唯一标识 */
  name: string
  
  /** 
   * 工具描述
   * 可以是静态字符串，或根据上下文动态生成
   */
  description: string | ((ctx: ToolContext) => string)
  
  /**
   * 参数 Schema (Zod)
   * 用于验证和生成 JSON Schema
   */
  parameters?: z.ZodType<P>
  
  /**
   * 执行函数
   * 
   * @param args 解析后的参数
   * @param ctx 执行上下文
   * @returns 工具结果
   */
  execute(args: P, ctx: ToolContext): Promise<ToolResult<M>>
}

// 类型守卫
export function isLegacyTool(tool: unknown): tool is LegacyTool {
  return typeof (tool as LegacyTool).execute === 'function' &&
         typeof (tool as any).parameters?.type === 'string'
}

export function isNewTool(tool: unknown): tool is Tool {
  return typeof (tool as Tool).execute === 'function' &&
         typeof (tool as any).parameters?.parse === 'function'
}
```

#### 2.2.5 内置工具适配示例

**ReadTool 适配**:

```typescript
// src/tools/builtin/read.ts - 修改

import { z } from 'zod'
import { Tool, ToolContext, ToolResult, textResult } from '../../types'
import { readFile, stat } from 'node:fs/promises'

// 参数 Schema
const ReadParams = z.object({
  file: z.string().describe('File path to read'),
  offset: z.number().optional().describe('Line offset'),
  limit: z.number().optional().describe('Max lines'),
})

type ReadParamsType = z.infer<typeof ReadParams>

// 元数据类型
interface ReadMetadata {
  path: string
  size: number
  lines: number
}

export const ReadTool: Tool<ReadParamsType, ReadMetadata> = {
  name: 'read',
  description: 'Read file contents. Supports offset and limit for pagination.',
  parameters: ReadParams,
  
  async execute(args, ctx: ToolContext): Promise<ToolResult<ReadMetadata>> {
    const { file, offset = 0, limit } = args
    
    // 检查取消
    if (ctx.abort.aborted) {
      throw new Error('Operation cancelled')
    }
    
    // 更新进度
    ctx.metadata({ title: `Reading ${file}...` })
    
    // 执行读取
    const content = await readFile(file, 'utf-8')
    const stats = await stat(file)
    const lines = content.split('\n')
    
    // 分页
    const selectedLines = lines.slice(offset, limit ? offset + limit : undefined)
    const output = selectedLines.map((l, i) => `${offset + i + 1}: ${l}`).join('\n')
    
    return {
      title: `Read ${file}`,
      output,
      metadata: {
        path: file,
        size: stats.size,
        lines: lines.length,
      },
    }
  },
}
```

**BashTool 适配** (涉及截断):

```typescript
// src/tools/builtin/bash.ts - 修改

import { z } from 'zod'
import { Tool, ToolContext, ToolResult } from '../../types'
import { execa } from 'execa'
import { truncateIfNeeded } from '../../truncate'

const BashParams = z.object({
  command: z.string().describe('Command to execute'),
  timeout: z.number().optional().default(30000),
  cwd: z.string().optional(),
})

type BashParamsType = z.infer<typeof BashParams>

interface BashMetadata {
  exitCode: number
  duration: number
  truncated: boolean
}

export const BashTool: Tool<BashParamsType, BashMetadata> = {
  name: 'bash',
  description: 'Execute shell commands with timeout protection.',
  parameters: BashParams,
  
  async execute(args, ctx: ToolContext): Promise<ToolResult<BashMetadata>> {
    const { command, timeout, cwd } = args
    const start = Date.now()
    
    ctx.metadata({ title: `Running: ${command.slice(0, 30)}...` })
    
    try {
      const result = await execa(command, {
        shell: true,
        timeout,
        cwd,
        signal: ctx.abort,
      })
      
      const duration = Date.now() - start
      const output = result.stdout + result.stderr
      
      // 应用截断 (P0 Truncate)
      const truncated = truncateIfNeeded(output, {
        maxLines: 2000,
        maxBytes: 50000,
      })
      
      return {
        title: `Exit ${result.exitCode}`,
        output: truncated.output,
        truncated: truncated.truncated,
        outputPath: truncated.outputPath,
        metadata: {
          exitCode: result.exitCode,
          duration,
          truncated: truncated.truncated,
        },
      }
    } catch (error: any) {
      return {
        title: `Error: ${error.message}`,
        output: error.message,
        metadata: {
          exitCode: error.exitCode ?? 1,
          duration: Date.now() - start,
          truncated: false,
        },
      }
    }
  },
}
```

#### 2.2.6 ToolRegistry 适配

```typescript
// src/registry.ts - 修改

import { z } from 'zod'
import type { Tool, LegacyTool, ToolContext, ToolResult } from './types'
import { isLegacyTool, isNewTool } from './types'

export class ToolRegistry {
  private tools: Map<string, Tool | LegacyTool> = new Map()
  
  register(tool: Tool | LegacyTool | (Tool | LegacyTool)[]): void {
    const tools = Array.isArray(tool) ? tool : [tool]
    for (const t of tools) {
      this.tools.set(t.name, t)
    }
  }
  
  get(name: string): Tool | LegacyTool | undefined {
    return this.tools.get(name)
  }
  
  list(): (Tool | LegacyTool)[] {
    return Array.from(this.tools.values())
  }
  
  /**
   * 执行工具
   * 兼容新旧两种 Tool 接口
   */
  async execute(
    name: string, 
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }
    
    // 新接口
    if (isNewTool(tool)) {
      // Zod 验证参数
      const parsedArgs = tool.parameters 
        ? tool.parameters.parse(args) 
        : args
      
      return tool.execute(parsedArgs, ctx)
    }
    
    // 旧接口兼容
    if (isLegacyTool(tool)) {
      const output = await tool.execute(args)
      return { title: output.slice(0, 50), output }
    }
    
    throw new Error(`Invalid tool: ${name}`)
  }
  
  /**
   * 获取工具的 JSON Schema (用于 LLM tool definition)
   */
  getToolDefinition(name: string): Record<string, unknown> | undefined {
    const tool = this.tools.get(name)
    if (!tool) return undefined
    
    const description = typeof tool.description === 'function'
      ? tool.description({} as ToolContext)  // 静态描述
      : tool.description
    
    // Zod to JSON Schema
    let parameters = undefined
    if (tool.parameters && 'parse' in tool.parameters) {
      parameters = zodToJsonSchema(tool.parameters)
    } else if ((tool as LegacyTool).parameters) {
      parameters = (tool as LegacyTool).parameters
    }
    
    return {
      name: tool.name,
      description,
      parameters,
    }
  }
}

// Zod to JSON Schema (简化版)
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // 使用 zod-to-json-schema 或简化实现
  // ...
}
```

#### 2.2.7 Agent 传递上下文

```typescript
// src/agent/agent.ts - 修改 executeToolCall 方法

import { v4 as uuidv4 } from 'uuid'

export class Agent {
  // ...
  
  private async executeToolCall(
    toolCall: { id: string; name: string; arguments: string }
  ): Promise<ToolResult> {
    const args = JSON.parse(toolCall.arguments)
    
    // 构建上下文
    const ctx: ToolContext = {
      sessionId: this.sessionId,
      messageId: this.currentMessageId,
      callId: toolCall.id,
      agent: this.name,
      abort: this.abortController.signal,
      messages: this.history.getMessages(),
      
      metadata: (input) => {
        this.emitMetadata(toolCall.id, input)
      },
      
      ask: async (input) => {
        return this.askUser(input)
      },
    }
    
    return this.registry.execute(toolCall.name, args, ctx)
  }
}
```

#### 2.2.8 测试用例

```typescript
// tests/tool/context.test.ts

import { describe, it, expect, vi } from 'vitest'
import { ToolRegistry } from '../src/registry'
import { z } from 'zod'

describe('Tool.Context', () => {
  const registry = new ToolRegistry()
  
  // 注册测试工具
  registry.register({
    name: 'test',
    description: 'Test tool',
    parameters: z.object({ input: z.string() }),
    execute: async (args, ctx) => {
      // 测试上下文访问
      expect(ctx.sessionId).toBeDefined()
      expect(ctx.messages).toBeInstanceOf(Array)
      
      // 测试 metadata
      ctx.metadata({ title: 'Processing...' })
      
      return {
        title: 'Done',
        output: `Processed: ${args.input}`,
      }
    },
  })
  
  it('should pass context to tool', async () => {
    const ctx = {
      sessionId: 'test-session',
      messageId: 'test-message',
      callId: 'test-call',
      agent: 'test-agent',
      abort: new AbortController().signal,
      messages: [],
      metadata: vi.fn(),
      ask: vi.fn().mockResolvedValue({ choice: 'yes' }),
    }
    
    const result = await registry.execute('test', { input: 'hello' }, ctx)
    
    expect(result.output).toBe('Processed: hello')
    expect(ctx.metadata).toHaveBeenCalledWith({ title: 'Processing...' })
  })
  
  it('should validate parameters with Zod', async () => {
    const ctx = createMockContext()
    
    await expect(
      registry.execute('test', {}, ctx)
    ).rejects.toThrow()
  })
  
  it('should support ask for user input', async () => {
    const ctx = {
      ...createMockContext(),
      ask: vi.fn().mockResolvedValue({ choice: 'approved' }),
    }
    
    // 注册需要权限的工具
    registry.register({
      name: 'dangerous',
      description: 'Dangerous tool',
      parameters: z.object({ action: z.string() }),
      execute: async (args, ctx) => {
        const answer = await ctx.ask({ message: 'Allow?' })
        return { title: answer.choice, output: answer.choice }
      },
    })
    
    const result = await registry.execute('dangerous', { action: 'delete' }, ctx)
    expect(result.output).toBe('approved')
  })
})

function createMockContext(): ToolContext {
  return {
    sessionId: 'test',
    messageId: 'test',
    callId: 'test',
    agent: 'test',
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => ({ choice: 'yes' }),
  }
}
```

---

## Chunk 3: Truncate 详细设计

### 3.1 设计原则

**问题**: Bash 工具执行 `find / -type f` 返回 10 万行，直接塞进上下文会炸。

**OpenCode 方案** (借鉴):
```typescript
Truncate.output(text, { maxLines: 2000, maxBytes: 50KB })
→ { content: truncated, truncated: true, outputPath: '/tmp/tool_xxx' }
```

**关键设计点**:
1. 截断后写入临时文件，Agent 可以用 `read` 工具查看完整内容
2. 临时文件 7 天自动清理
3. 截断方向可选 (head/tail)
4. 作为基础设施，所有工具可复用

### Task 3: 输出截断系统

**Files:**
- Create: `src/truncate/index.ts`
- Create: `src/truncate/storage.ts`
- Create: `src/truncate/cleanup.ts`
- Modify: `src/tools/builtin/bash.ts` (应用截断)
- Modify: `src/tools/builtin/grep.ts` (应用截断)
- Modify: `src/tools/builtin/find.ts` (应用截断)
- Test: `tests/truncate/truncate.test.ts`

#### 3.2 Truncate 接口设计

```typescript
// src/truncate/index.ts

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export interface TruncateOptions {
  /** 最大行数 (默认 2000) */
  maxLines?: number
  
  /** 最大字节数 (默认 50000 = 50KB) */
  maxBytes?: number
  
  /** 截断方向: 'head' 保留前面, 'tail' 保留后面 (默认 'head') */
  direction?: 'head' | 'tail'
  
  /** 自定义临时目录 (默认系统临时目录) */
  tempDir?: string
  
  /** 文件前缀 */
  prefix?: string
}

export interface TruncateResult {
  /** 截断后的内容 */
  output: string
  
  /** 是否被截断 */
  truncated: boolean
  
  /** 如果截断，完整内容的文件路径 */
  outputPath?: string
  
  /** 原始行数 */
  originalLines: number
  
  /** 原始字节数 */
  originalBytes: number
  
  /** 截断后行数 */
  resultLines: number
  
  /** 截断后字节数 */
  resultBytes: number
}

/**
 * 输出截断函数
 * 
 * @example
 * const result = truncate(longOutput, { maxLines: 500 })
 * if (result.truncated) {
 *   console.log(`Output truncated. Full output at: ${result.outputPath}`)
 * }
 */
export function truncate(
  content: string,
  options: TruncateOptions = {}
): TruncateResult {
  const {
    maxLines = 2000,
    maxBytes = 50000,
    direction = 'head',
    prefix = 'tool',
  } = options
  
  const originalLines = content.split('\n').length
  const originalBytes = Buffer.byteLength(content, 'utf-8')
  
  // 不需要截断
  if (originalLines <= maxLines && originalBytes <= maxBytes) {
    return {
      output: content,
      truncated: false,
      originalLines,
      originalBytes,
      resultLines: originalLines,
      resultBytes: originalBytes,
    }
  }
  
  // 需要截断
  let lines = content.split('\n')
  let result: string
  
  if (direction === 'head') {
    // 保留前面
    lines = lines.slice(0, maxLines)
    result = lines.join('\n')
    
    // 如果字节超限，继续裁剪
    while (Buffer.byteLength(result, 'utf-8') > maxBytes && lines.length > 1) {
      lines.pop()
      result = lines.join('\n')
    }
  } else {
    // 保留后面
    lines = lines.slice(-maxLines)
    result = lines.join('\n')
    
    while (Buffer.byteLength(result, 'utf-8') > maxBytes && lines.length > 1) {
      lines.shift()
      result = lines.join('\n')
    }
  }
  
  // 添加截断提示
  const truncatedInfo = `\n\n... [截断 ${originalLines - lines.length} 行，完整输出见文件]`
  result = result.slice(0, maxBytes - truncatedInfo.length - 100) + truncatedInfo
  
  return {
    output: result,
    truncated: true,
    originalLines,
    originalBytes,
    resultLines: lines.length,
    resultBytes: Buffer.byteLength(result, 'utf-8'),
  }
}

/**
 * 截断并保存完整内容到临时文件
 * 
 * @returns TruncateResult 包含文件路径
 */
export async function truncateAndSave(
  content: string,
  options: TruncateOptions = {}
): Promise<TruncateResult> {
  const result = truncate(content, options)
  
  if (!result.truncated) {
    return result
  }
  
  // 保存完整内容到临时文件
  const tempDir = options.tempDir ?? join(tmpdir(), 'agentforge', 'truncated')
  const fileName = `${options.prefix ?? 'tool'}_${Date.now()}_${randomUUID().slice(0, 8)}.txt`
  const outputPath = join(tempDir, fileName)
  
  await mkdir(tempDir, { recursive: true })
  await writeFile(outputPath, content, 'utf-8')
  
  return {
    ...result,
    outputPath,
  }
}

/**
 * 检查是否需要截断并执行
 * 简化版，用于工具直接调用
 */
export function truncateIfNeeded(
  content: string,
  options?: TruncateOptions
): TruncateResult {
  return truncate(content, options)
}

/**
 * 异步版本，保存完整内容
 */
export async function truncateIfNeededAsync(
  content: string,
  options?: TruncateOptions
): Promise<TruncateResult> {
  return truncateAndSave(content, options)
}
```

#### 3.3 临时文件存储

```typescript
// src/truncate/storage.ts

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readdir, stat, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const TRUNCATE_DIR = join(tmpdir(), 'agentforge', 'truncated')
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000 // 24 小时
const MAX_AGE_DAYS = 7 // 7 天过期

/**
 * 获取截断文件存储目录
 */
export function getTruncateDir(): string {
  return TRUNCATE_DIR
}

/**
 * 确保存储目录存在
 */
export async function ensureTruncateDir(): Promise<string> {
  if (!existsSync(TRUNCATE_DIR)) {
    await mkdir(TRUNCATE_DIR, { recursive: true })
  }
  return TRUNCATE_DIR
}

/**
 * 清理过期文件
 * 删除超过 MAX_AGE_DAYS 天的文件
 */
export async function cleanupOldFiles(): Promise<number> {
  if (!existsSync(TRUNCATE_DIR)) {
    return 0
  }
  
  const files = await readdir(TRUNCATE_DIR)
  const now = Date.now()
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  let deleted = 0
  
  for (const file of files) {
    const filePath = join(TRUNCATE_DIR, file)
    try {
      const stats = await stat(filePath)
      if (now - stats.mtimeMs > maxAge) {
        await rm(filePath)
        deleted++
      }
    } catch {
      // 忽略错误
    }
  }
  
  return deleted
}

/**
 * 获取存储统计
 */
export async function getStorageStats(): Promise<{
  fileCount: number
  totalBytes: number
  oldestFile: Date | null
}> {
  if (!existsSync(TRUNCATE_DIR)) {
    return { fileCount: 0, totalBytes: 0, oldestFile: null }
  }
  
  const files = await readdir(TRUNCATE_DIR)
  let totalBytes = 0
  let oldestTime = Infinity
  
  for (const file of files) {
    const filePath = join(TRUNCATE_DIR, file)
    try {
      const stats = await stat(filePath)
      totalBytes += stats.size
      if (stats.mtimeMs < oldestTime) {
        oldestTime = stats.mtimeMs
      }
    } catch {
      // 忽略
    }
  }
  
  return {
    fileCount: files.length,
    totalBytes,
    oldestFile: oldestTime < Infinity ? new Date(oldestTime) : null,
  }
}

// 定时清理 (进程启动时)
let cleanupTimer: NodeJS.Timeout | null = null

export function startCleanupScheduler(): void {
  if (cleanupTimer) return
  
  // 启动时清理一次
  cleanupOldFiles().catch(() => {})
  
  // 定时清理
  cleanupTimer = setInterval(() => {
    cleanupOldFiles().catch(() => {})
  }, CLEANUP_INTERVAL)
}

export function stopCleanupScheduler(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}
```

#### 3.4 Truncate 中间件 (可选)

```typescript
// src/middleware/truncate.middleware.ts

import { Observable, map } from 'rxjs'
import type { Middleware } from './index'
import type { StreamEvent } from '../types'
import { truncateIfNeededAsync } from '../truncate'

export interface TruncateMiddlewareOptions {
  maxLines?: number
  maxBytes?: number
  direction?: 'head' | 'tail'
}

/**
 * Truncate 中间件
 * 
 * 自动截断过长的工具输出
 * 注意：这个中间件只能用于 tool_call_end 事件
 */
export function createTruncateMiddleware(
  options: TruncateMiddlewareOptions = {}
): Middleware {
  const { maxLines = 2000, maxBytes = 50000, direction = 'head' } = options
  
  return (source$: Observable<StreamEvent>) => {
    return new Observable<StreamEvent>((subscriber) => {
      source$.subscribe({
        async next(event) {
          if (event.type === 'tool_call_end' && event.result) {
            // 检查是否需要截断
            const lines = event.result.split('\n').length
            const bytes = Buffer.byteLength(event.result, 'utf-8')
            
            if (lines > maxLines || bytes > maxBytes) {
              const truncated = await truncateIfNeededAsync(event.result, {
                maxLines,
                maxBytes,
                direction,
              })
              
              subscriber.next({
                ...event,
                result: truncated.output,
                truncated: truncated.truncated,
                outputPath: truncated.outputPath,
              })
              return
            }
          }
          subscriber.next(event)
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      })
    })
  }
}
```

#### 3.5 内置工具应用示例

```typescript
// src/tools/builtin/bash.ts - 截断应用

import { truncateIfNeededAsync } from '../../truncate'

export const BashTool: Tool<BashParamsType, BashMetadata> = {
  name: 'bash',
  // ...
  async execute(args, ctx) {
    // ... 执行命令 ...
    
    // 应用截断
    const truncated = await truncateIfNeededAsync(output, {
      maxLines: 2000,
      maxBytes: 50000,
      prefix: `bash_${ctx.callId}`,
    })
    
    return {
      title: `Exit ${result.exitCode}`,
      output: truncated.output,
      truncated: truncated.truncated,
      outputPath: truncated.outputPath,
      metadata: {
        exitCode: result.exitCode,
        duration,
        truncated: truncated.truncated,
        originalLines: truncated.originalLines,
        originalBytes: truncated.originalBytes,
      },
    }
  },
}
```

#### 3.6 测试用例

```typescript
// tests/truncate/truncate.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { truncate, truncateAndSave, cleanupOldFiles } from '../src/truncate'
import { rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Truncate', () => {
  const tempDir = join(tmpdir(), 'agentforge-test', 'truncate')
  
  beforeEach(async () => {
    try {
      await rm(tempDir, { recursive: true })
    } catch {}
  })
  
  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true })
    } catch {}
  })
  
  describe('truncate()', () => {
    it('should not truncate short content', () => {
      const content = 'Hello world'
      const result = truncate(content)
      
      expect(result.truncated).toBe(false)
      expect(result.output).toBe(content)
    })
    
    it('should truncate by lines', () => {
      const lines = Array(5000).fill('line').join('\n')
      const result = truncate(lines, { maxLines: 100 })
      
      expect(result.truncated).toBe(true)
      expect(result.resultLines).toBeLessThanOrEqual(100)
      expect(result.originalLines).toBe(5000)
    })
    
    it('should truncate by bytes', () => {
      const content = 'x'.repeat(100000)
      const result = truncate(content, { maxBytes: 10000 })
      
      expect(result.truncated).toBe(true)
      expect(result.resultBytes).toBeLessThanOrEqual(10000)
    })
    
    it('should support tail direction', () => {
      const lines = Array(100).fill((_, i) => `line ${i}`).join('\n')
      const result = truncate(lines, { maxLines: 10, direction: 'tail' })
      
      expect(result.truncated).toBe(true)
      expect(result.output).toContain('line 99')
      expect(result.output).not.toContain('line 0')
    })
    
    it('should add truncation notice', () => {
      const lines = Array(5000).fill('line').join('\n')
      const result = truncate(lines, { maxLines: 100 })
      
      expect(result.output).toContain('截断')
    })
  })
  
  describe('truncateAndSave()', () => {
    it('should save full content to temp file', async () => {
      const lines = Array(5000).fill('test line content').join('\n')
      const result = await truncateAndSave(lines, { 
        maxLines: 100,
        tempDir,
      })
      
      expect(result.truncated).toBe(true)
      expect(result.outputPath).toBeDefined()
      
      // 验证文件存在
      const files = await readdir(tempDir)
      expect(files.length).toBeGreaterThan(0)
    })
    
    it('should not save if not truncated', async () => {
      const content = 'short'
      const result = await truncateAndSave(content, { tempDir })
      
      expect(result.truncated).toBe(false)
      expect(result.outputPath).toBeUndefined()
    })
  })
  
  describe('cleanupOldFiles()', () => {
    it('should cleanup files older than max age', async () => {
      // 创建测试文件
      // ... (需要 mock mtime)
    })
  })
})
```

---

## Chunk 4: P1 架构决策

### 4.1 P1 目标

| 项目 | 当前状态 | 目标状态 |
|------|----------|----------|
| 权限 Ruleset | 只有 PII 检测 | 细粒度权限规则 + HITL |
| 生命周期 Middleware | 只有流中间件 | beforeToolExecute/afterToolExecute 等 |
| 持久化存储 | 只有 InMemory | SQLite/Redis/File |

### 4.2 P1 工作量估算

| 项目 | 工作量 | 依赖 |
|------|--------|------|
| 权限 Ruleset | 1 周 | Tool.Context (P0) |
| 生命周期 Middleware | 1 周 | Tool.Context (P0) |
| 持久化存储 | 1 周 | 无 |

**总工作量**: ~3 周

---

### Task 4: 权限 Ruleset 系统 (架构设计)

**Files:**
- Create: `src/permission/types.ts`
- Create: `src/permission/ruleset.ts`
- Create: `src/permission/middleware.ts`
- Create: `src/permission/ask.ts`
- Modify: `src/middleware/index.ts`
- Test: `tests/permission/ruleset.test.ts`

#### 4.2.1 核心类型

```typescript
// src/permission/types.ts

/**
 * 权限动作类型
 */
export type PermissionAction = 'allow' | 'deny' | 'ask'

/**
 * 权限规则
 */
export interface PermissionRule {
  /** 权限类型: edit, bash, read, write, delete, etc. */
  permission: string
  
  /** 资源模式: glob pattern */
  pattern: string
  
  /** 动作: allow, deny, ask */
  action: PermissionAction
}

/**
 * 权限规则集 (多层合并)
 */
export interface PermissionRuleset {
  /** 默认规则 */
  defaults: PermissionRule[]
  
  /** 用户配置规则 */
  user: PermissionRule[]
  
  /** 运行时覆盖规则 */
  runtime: PermissionRule[]
}

/**
 * 权限请求 (需要用户决定时)
 */
export interface PermissionRequest {
  /** 权限类型 */
  permission: string
  
  /** 资源路径 */
  resource: string
  
  /** 匹配的规则 */
  matchedRule?: PermissionRule
  
  /** 工具调用信息 */
  toolCall?: {
    id: string
    name: string
    args: Record<string, unknown>
  }
}

/**
 * 用户回复
 */
export interface PermissionReply {
  /** 决定: once, always, reject */
  action: 'once' | 'always' | 'reject'
}
```

#### 4.2.2 规则评估

```typescript
// src/permission/ruleset.ts

import minimatch from 'minimatch'
import type { PermissionRule, PermissionAction, PermissionRuleset } from './types'

/**
 * 评估单个规则
 */
export function evaluateRule(
  permission: string,
  resource: string,
  rule: PermissionRule
): boolean {
  // 检查权限类型匹配
  if (rule.permission !== '*' && rule.permission !== permission) {
    return false
  }
  
  // 检查资源模式匹配
  return minimatch(resource, rule.pattern)
}

/**
 * 评估规则集，返回动作
 */
export function evaluate(
  permission: string,
  resource: string,
  ruleset: PermissionRuleset
): { action: PermissionAction; matchedRule?: PermissionRule } {
  // 合并规则: defaults < user < runtime
  const allRules = [
    ...ruleset.defaults,
    ...ruleset.user,
    ...ruleset.runtime,
  ]
  
  // 找到第一个匹配的规则
  for (const rule of allRules) {
    if (evaluateRule(permission, resource, rule)) {
      return { action: rule.action, matchedRule: rule }
    }
  }
  
  // 默认拒绝
  return { action: 'deny' }
}

/**
 * 合并规则集
 */
export function merge(
  ...rulesets: Partial<PermissionRuleset>[]
): PermissionRuleset {
  return {
    defaults: rulesets.flatMap(r => r.defaults ?? []),
    user: rulesets.flatMap(r => r.user ?? []),
    runtime: rulesets.flatMap(r => r.runtime ?? []),
  }
}

/**
 * 默认规则集
 */
export const defaultRuleset: PermissionRuleset = {
  defaults: [
    // 读取默认允许
    { permission: 'read', pattern: '*', action: 'allow' },
    // Bash 命令默认询问
    { permission: 'bash', pattern: '*', action: 'ask' },
    // 写入敏感文件默认询问
    { permission: 'write', pattern: '*.env', action: 'ask' },
    { permission: 'write', pattern: '.*', action: 'ask' },
    // 删除默认询问
    { permission: 'delete', pattern: '*', action: 'ask' },
  ],
  user: [],
  runtime: [],
}
```

#### 4.2.3 权限中间件

```typescript
// src/permission/middleware.ts

import { Observable, from, of } from 'rxjs'
import { switchMap, filter } from 'rxjs/operators'
import type { Middleware } from '../middleware'
import type { StreamEvent } from '../types'
import { evaluate } from './ruleset'
import type { PermissionRuleset, PermissionReply } from './types'

export interface PermissionMiddlewareOptions {
  ruleset: PermissionRuleset
  onAsk?: (request: PermissionRequest) => Promise<PermissionReply>
}

/**
 * 权限中间件
 * 
 * 在 tool_call_start 时检查权限，决定是否允许执行
 */
export function createPermissionMiddleware(
  options: PermissionMiddlewareOptions
): Middleware {
  const { ruleset, onAsk } = options
  
  return (source$: Observable<StreamEvent>) => {
    return source$.pipe(
      switchMap(async (event) => {
        if (event.type === 'tool_call_start') {
          // 根据 tool name 确定 permission 类型
          const permission = getPermissionType(event.name)
          const resource = '*' // 从 tool args 提取，需要解析后续 event
          
          const result = evaluate(permission, resource, ruleset)
          
          switch (result.action) {
            case 'allow':
              return event
            
            case 'deny':
              // 返回拒绝事件
              return {
                type: 'tool_call_end' as const,
                id: event.id,
                result: `[Permission Denied] Tool '${event.name}' is not allowed.`,
              }
            
            case 'ask':
              if (onAsk) {
                const reply = await onAsk({
                  permission,
                  resource,
                  toolCall: { id: event.id, name: event.name, args: {} },
                })
                
                if (reply.action === 'reject') {
                  return {
                    type: 'tool_call_end' as const,
                    id: event.id,
                    result: `[Permission Rejected] User denied execution of '${event.name}'.`,
                  }
                }
                
                // once / always 都允许执行
                if (reply.action === 'always') {
                  // 添加到 runtime 规则
                  ruleset.runtime.push({
                    permission,
                    pattern: resource,
                    action: 'allow',
                  })
                }
              }
              return event
          }
        }
        
        return event
      })
    )
  }
}

function getPermissionType(toolName: string): string {
  const mapping: Record<string, string> = {
    read: 'read',
    write: 'write',
    edit: 'edit',
    bash: 'bash',
    delete: 'delete',
    ls: 'read',
    glob: 'read',
    grep: 'read',
  }
  return mapping[toolName] ?? 'execute'
}
```

---

### Task 5: 生命周期 Middleware (架构设计)

**修改现有 Middleware 类型**:

```typescript
// src/middleware/index.ts - 扩展

import type { Observable } from 'rxjs'
import type { StreamEvent, Message, ToolContext } from '../types'

// 现有: 流中间件
export type StreamMiddleware = (source$: Observable<StreamEvent>) => Observable<StreamEvent>

// 新增: 生命周期中间件
export interface LifecycleMiddleware {
  /** 流处理 (现有) */
  stream?: StreamMiddleware
  
  /** 工具执行前 - 返回 null 阻止执行 */
  beforeToolExecute?: (ctx: ToolContext) => Promise<ToolContext | null>
  
  /** 工具执行后 - 可修改结果 */
  afterToolExecute?: (ctx: ToolContext, result: string) => Promise<string>
  
  /** 聊天前 - 可修改消息 */
  beforeChat?: (messages: Message[]) => Promise<Message[]>
  
  /** 系统提示修改 */
  systemPrompt?: (prompt: string) => Promise<string>
  
  /** 聊天参数修改 */
  params?: (params: ChatParams) => Promise<ChatParams>
}

// 统一 Middleware 类型
export type Middleware = StreamMiddleware | LifecycleMiddleware

// 类型守卫
export function isStreamMiddleware(mw: Middleware): mw is StreamMiddleware {
  return typeof mw === 'function'
}

export function isLifecycleMiddleware(mw: Middleware): mw is LifecycleMiddleware {
  return typeof mw === 'object' && mw !== null
}
```

---

### Task 6: 持久化存储 (架构设计)

**扩展现有 MemoryStorage 接口**:

```typescript
// src/storage/types.ts

import type { Message, Thread } from '../memory/types'

/**
 * 存储接口
 */
export interface Storage {
  // Thread 操作
  getThread(id: string): Promise<Thread | null>
  saveThread(thread: Thread): Promise<void>
  deleteThread(id: string): Promise<void>
  listThreads(): Promise<Thread[]>
  
  // Message 操作
  getMessages(threadId: string): Promise<Message[]>
  addMessage(threadId: string, message: Message): Promise<void>
  
  // Working Memory
  getWorkingMemory(threadId: string): Promise<string | null>
  saveWorkingMemory(threadId: string, content: string): Promise<void>
  
  // 生命周期
  close(): Promise<void>
}

// 已有: InMemoryStorage
// 新增: SQLiteStorage, RedisStorage, FileStorage
```

**SQLite 存储** (已有基础):

```typescript
// src/storage/sqlite.ts

import Database from 'better-sqlite3'
import type { Storage } from './types'

export class SQLiteStorage implements Storage {
  private db: Database.Database
  
  constructor(path: string) {
    this.db = new Database(path)
    this.initTables()
  }
  
  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_call_id TEXT,
        tool_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );
      
      CREATE TABLE IF NOT EXISTS working_memory (
        thread_id TEXT PRIMARY KEY,
        content TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    `)
  }
  
  // ... 实现各方法
}
```

---

## Chunk 5: P2/P3 方向

### 5.1 P2 方向 (差异化功能)

#### Task 7: 会话分叉 (Fork)

**设计方向**:
```typescript
interface SessionManager {
  fork(sessionId: string, options?: { beforeMessageId?: string }): Promise<Session>
  getChildren(sessionId: string): Promise<Session[]>
  getParent(sessionId: string): Promise<Session | null>
}
```

**关键点**:
- 克隆历史消息到分叉点
- 父子关系通过 `parentId` 字段维护
- 标题自动标记 `(fork #1)`

**工作量**: 3-5 天

---

#### Task 8: 事件溯源 (Event Sourcing)

**设计方向**:
```typescript
interface Event {
  type: string
  version: number
  aggregateId: string
  timestamp: Date
  data: unknown
}

class EventStore {
  emit(event: Event): void
  events$: Observable<Event>
  replay(aggregateId: string): Promise<Event[]>
}
```

**关键点**:
- 所有状态变更记录为事件
- 支持事件重放
- 投影器：事件 → 数据库写入

**工作量**: 1-2 周

---

#### Task 9: Skill 动态发现

**设计方向**:
```typescript
class SkillDiscovery {
  pull(url: string): Promise<string[]>       // 远程仓库
  scan(directory: string): Promise<Skill[]>   // 本地扫描
  loadAsTool(name: string): Promise<Tool>
  loadAsPrompt(name: string): Promise<string>
}
```

**关键点**:
- 远程 Skill 仓库（index.json + SKILL.md）
- 本地 `.agentforge/skills/*` 扫描
- Skill = Markdown 文件 → 系统提示

**工作量**: 1-2 周

---

#### Task 10: Agent 驱动压缩

**设计方向**:
- 当上下文溢出时自动压缩
- 使用 compaction Agent（无工具权限）总结历史
- 替换长历史为摘要 + 保留最近消息

**工作量**: 3-5 天

---

### 5.2 P3 方向 (可选增强)

| 功能 | 说明 | 工作量 |
|------|------|--------|
| LSP 集成 | goto_definition, find_references, diagnostics | 1-2 周 |
| ACP 协议 | Agent Client Protocol (Zed/VSCode 集成) | 2-3 周 |
| Git Worktree | 隔离的 git worktree 安全编辑 | 1 周 |
| Studio UI | 可视化 Agent 构建器 | 2-3 周 |

---

### 5.3 全部工作量汇总

| 阶段 | 内容 | 工作量 | 累计 |
|------|------|--------|------|
| **P0** | Provider + Tool.Context + Truncate | 4 周 | 4 周 |
| **P1** | 权限 + 生命周期 + 持久化 | 3 周 | 7 周 |
| **P2** | 分叉 + 事件 + Skill + 压缩 | 4 周 | 11 周 |
| **P3** | LSP/ACP/Worktree/Studio | 6 周 | 17 周 |

---

## 实施顺序建议

```
Week 1-2:   P0 Provider (详细设计已完成，可直接开发)
Week 3:     P0 Tool.Context (详细设计已完成)
Week 4:     P0 Truncate (详细设计已完成)

Week 5:     P1 权限 Ruleset (架构设计已完成)
Week 6:     P1 生命周期 Middleware (架构设计已完成)
Week 7:     P1 持久化存储 (架构设计已完成)

Week 8-11:  P2 按需实施

Week 12+:   P3 可选
```

---

## 验收标准

### P0 验收

- [ ] `Provider.model('anthropic', 'claude-sonnet-4')` 可用
- [ ] `Provider.model('openai', 'gpt-4o')` 可用
- [ ] `Provider.findModel('claude')` 返回模型信息
- [ ] Tool execute 收到完整 ToolContext
- [ ] Tool 可以访问 `ctx.messages`
- [ ] Tool 可以调用 `ctx.ask()`
- [ ] Bash 输出超过 2000 行自动截断
- [ ] 截断后可通过 `read` 工具查看完整内容
- [ ] 临时文件 7 天自动清理

### P1 验收

- [ ] `evaluate('write', '.env', ruleset)` 返回 `{ action: 'ask' }`
- [ ] 权限中间件可以阻止工具执行
- [ ] `beforeToolExecute` 钩子可用
- [ ] `afterToolExecute` 可以修改输出
- [ ] SQLite 存储可用
- [ ] 会话数据可持久化

### P2 验收

- [ ] 会话 Fork 可用
- [ ] 事件溯源可重放
- [ ] 远程 Skill 可发现

---

## 附录: OpenCode 参考

| 功能 | OpenCode 文件 | 移植难度 |
|------|---------------|----------|
| Provider | `src/provider/provider.ts` | 中 (需去 Effect-TS) |
| Tool.Context | `src/tool/types.ts` | 低 |
| Truncate | `src/util/truncate.ts` | 低 |
| Permission | `src/permission/*.ts` | 中 |
| Session Fork | `src/session/session.ts` | 低 |
| Event Sourcing | `src/sync/*.ts` | 高 |
| Skill | `src/skill/*.ts` | 中 |

---

*计划完成。准备执行 P0 开发？*
