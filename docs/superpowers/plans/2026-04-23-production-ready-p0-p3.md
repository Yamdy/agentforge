# AgentForge 生产可用增强计划 - 执行状态

> **最后更新**: 2026-04-24 23:55
> **当前阶段**: P2 Task 3 完成

---

## 全局状态

| 阶段 | 状态 | 提交 |
|------|------|------|
| **P0 Task 1: Provider** | ✅ 完成 | `58ca8b8` |
| **P0 Task 2: Tool.Context** | ✅ 完成 | `15fdf5a` |
| **P0 Task 3: 内置工具适配** | ✅ 完成 | `8b141bd` |
| **P0 Task 4: Truncate** | ✅ 完成 | `f3d976d` |
| **P0 Task 5: 测试验证** | ✅ 完成 | `tests/p0-validation.test.ts` |
| **P1 Task 1: 权限 Ruleset** | ✅ 完成 | `b2f1ae1` |
| **P1 Task 2: 生命周期 Middleware** | ✅ 完成 | `ee00904` |
| **P1 Task 3: 持久化存储扩展** | ✅ 完成 | — |
| **P2 Task 1: 安全默认策略** | ✅ 完成 | 待提交 |
| **P2 Task 2: 存储层外键约束** | ✅ 完成 | `de1ab1a` |
| **P2 Task 3: 错误处理增强** | ✅ 完成 | — |
| **P2 Task 4: 可观测性集成** | 📋 计划中 | — |
| **P3 Task 1: CheckpointManager 迁移** | 📋 计划中 | — |
| **P3 Task 2: Session/Thread 术语统一** | 📋 计划中 | — |
| **P3 Task 3: 配置格式数组化** | 📋 计划中 | — |
| **P3 Task 4: 文档与示例完善** | 📋 计划中 | — |

---

## P0 详细任务清单

### Task 1: Provider 多模型路由系统 ✅ 已完成

**已完成内容**:
- `src/provider/` 模块创建
- 8 个 Provider 实现: Anthropic, OpenAI, Azure, Bedrock, Vertex, OpenRouter, Ollama, Custom
- ProviderRegistry 单例
- Provider 便捷 API
- 20 个测试用例全部通过

**依赖包已安装**:
```
@ai-sdk/anthropic
@ai-sdk/google-vertex
@ai-sdk/amazon-bedrock
@ai-sdk/provider
```

---

### Task 2: Tool.Context 上下文系统 ✅ 已完成

**目标**: 工具执行时收到完整上下文，可访问对话历史、向用户提问等。

**已完成内容**:
- `src/tool/context.ts` - ToolContext 接口 (sessionId, callId, abort, messages, metadata(), ask())
- `src/tool/result.ts` - ToolResult<M> 接口 + 辅助函数 (textResult, truncatedResult, errorResult)
- `src/tool/attachment.ts` - Attachment 接口 + 辅助函数 (imageAttachment, pdfAttachment)
- `src/tool/index.ts` - 模块导出
- `src/types.ts` - 新 Tool<P,M> 接口 (Zod schema + ToolContext), LegacyTool 兼容接口
- `src/registry.ts` - execute(name, args, ctx) 新签名 + Legacy 兼容
- `src/agent/agent.ts` - 构建 ToolContext 传入工具执行
- 所有 builtin tools 适配 LegacyTool 别名
- 测试验证: 228/240 通过 (核心测试全部通过)

**设计亮点**:
1. 完全向后兼容 - 旧 execute(args) 自动包装为 ToolResult
2. 渐进式迁移 - isLegacyTool/isNewTool 类型守卫
3. Zod 原生 - 新接口 parameters 直接使用 Zod schema

Modify:
- src/types.ts             # Tool 接口重定义 (从 execute(args) 改为 execute(args, ctx))
- src/registry.ts          # Registry.execute() 适配新签名
- src/agent/agent.ts       # executeToolCall() 传递 ToolContext
```

**核心接口设计**:

```typescript
// src/tool/context.ts

import type { Message } from '../types'

export interface ToolContext {
  // ========== 标识 ==========
  sessionId: string
  messageId: string
  callId: string        // LLM 返回的 tool_call_id
  agent: string

  // ========== 控制 ==========
  abort: AbortSignal

  // ========== 数据访问 ==========
  messages: readonly Message[]

  // ========== 运行时能力 ==========
  /** 更新工具元数据（进度显示） */
  metadata(input: { title?: string; metadata?: Record<string, unknown>; progress?: number }): void

  /** 向用户提问（权限请求或需要输入） */
  ask(input: AskInput): Promise<AskResult>
}

export interface MetadataInput {
  title?: string
  metadata?: Record<string, unknown>
  progress?: number
}

export interface AskInput {
  message: string
  choices?: string[]
  defaultChoice?: string
  allowCustom?: boolean
}

export interface AskResult {
  choice: string
  isCustom?: boolean
  always?: boolean   // 用于权限：用户选择"总是允许"
}
```

```typescript
// src/tool/result.ts

import type { Attachment } from './attachment'

export interface ToolResult<M = unknown> {
  /** 简短标题（UI 显示） */
  title: string

  /** 完整输出 */
  output: string

  /** 结构化元数据 */
  metadata?: M

  /** 文件附件 */
  attachments?: Attachment[]

  /** 是否被截断 (Truncate 使用) */
  truncated?: boolean

  /** 如果截断，完整内容的文件路径 */
  outputPath?: string
}

// 辅助函数
export function textResult(output: string, title?: string): ToolResult
export function truncatedResult(output: string, fullPath: string, title?: string): ToolResult
```

```typescript
// src/tool/attachment.ts

export interface Attachment {
  contentType: string
  name?: string
  content: string   // Base64
  url?: string
}

export function imageAttachment(content: Buffer | string, name?: string): Attachment
export function pdfAttachment(content: Buffer, name?: string): Attachment
```

**types.ts 修改点**:

```typescript
// 现有定义
interface Tool {
  name: string
  description: string
  parameters?: ToolParameters
  execute(args: Record<string, unknown>): Promise<string>  // 旧
}

// 新定义 (兼容旧接口)
interface Tool<P = unknown, M = unknown> {
  name: string
  description: string | ((ctx: ToolContext) => string)  // 支持动态描述
  parameters?: z.ZodType<P>  // Zod schema
  execute(args: P, ctx: ToolContext): Promise<ToolResult<M>>  // 新
}

// 类型守卫
function isLegacyTool(tool: unknown): tool is Tool  // 旧接口检测
function isNewTool(tool: unknown): tool is Tool<unknown, unknown>  // 新接口检测
```

**registry.ts 修改点**:

```typescript
class ToolRegistry {
  // 新增方法
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool not found: ${name}`)

    if (isNewTool(tool)) {
      // Zod 验证
      const parsedArgs = tool.parameters?.parse(args) ?? args
      return tool.execute(parsedArgs, ctx)
    }

    // 兼容旧接口
    if (isLegacyTool(tool)) {
      const output = await tool.execute(args)
      return { title: output.slice(0, 50), output }
    }

    throw new Error(`Invalid tool: ${name}`)
  }
}
```

**agent.ts 修改点** (executeToolCall 方法):

```typescript
private async executeToolCall(
  toolCall: { id: string; name: string; arguments: string }
): Promise<ToolResult> {
  const args = JSON.parse(toolCall.arguments)

  // 构建 ToolContext
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
```

---

### Task 3: 内置工具适配 ✅ 已完成

**目标**: 将 15 个内置工具从旧接口迁移到新接口。

**已完成内容**:
- 15 个 builtin tools 全部迁移到 `Tool<P,M>` 接口
- 每个 tool 添加 Zod parameter schema (替换旧 JSON Schema)
- execute 签名改为 `(args, ctx: ToolContext) => Promise<ToolResult<M>>`
- 使用 `ctx.metadata()` 报告进度、`ctx.abort` 检查取消
- 返回 `ToolResult` 而非裸 string，附带结构化 metadata
- Bash/Grep/Find 预留 `truncateIfNeeded` TODO 注释 (Task 4 实现)
- `types.ts` 添加 `ToolContext`/`ToolResult` re-exports 便于单文件导入
- AskUserTool 使用 `ctx.ask()` 实现用户交互
- BashTool 重构 `BashToolExecutor` 接受 ToolContext，使用 `ctx.abort`
- 所有工具被 `isNewTool` 正确识别，`isLegacyTool` 返回 false
- 测试验证: registry + builtin-tools 测试全部通过 (10/10)

**迁移工具列表**:
```
read.ts       → Tool<ReadParamsType, ReadMetadata>
write.ts      → Tool<WriteParamsType, WriteMetadata>
edit.ts       → Tool<EditParamsType, EditMetadata>
ls.ts         → Tool<LsParamsType, LsMetadata>
bash.ts       → Tool<BashParamsType, BashMetadata> (BashToolExecutor 重构)
grep.ts       → Tool<GrepParamsType, GrepMetadata> (TODO: truncate)
find.ts       → Tool<FindParamsType, FindMetadata> (TODO: truncate)
glob.ts       → Tool<GlobParamsType, GlobMetadata>
fetch.ts      → Tool<FetchParamsType, FetchMetadata>
search.ts     → Tool<SearchParamsType, SearchMetadata>
calculate.ts  → Tool<CalculatorParamsType, CalculatorMetadata>
time.ts       → Tool<TimeParamsType, TimeMetadata>
sleep.ts      → Tool<SleepParamsType, SleepMetadata>
diffpatch.ts  → Tool<DiffPatchParamsType, DiffPatchMetadata>
ask_user.ts   → Tool<AskUserParamsType, AskUserMetadata>
```

---

### Task 4: 输出截断系统 ✅ 已完成

**目标**: 自动截断过长输出，防止上下文爆炸。

**已完成内容**:
- `src/truncate/index.ts` - truncateIfNeeded + truncateAndSave + 字符级截断
- `src/truncate/storage.ts` - 临时文件存储 (saveTruncatedOutput)
- `src/truncate/cleanup.ts` - 7天自动清理 (cleanupOldFiles)
- `src/index.ts` - 导出 truncate 模块 (Truncate namespace + 直接导出)
- `src/tools/builtin/bash.ts` - 应用 truncateAndSave (移除 TODO)
- `src/tools/builtin/grep.ts` - 应用 truncateAndSave (移除 TODO)
- `src/tools/builtin/find.ts` - 应用 truncateAndSave (移除 TODO)
- 22 个测试用例全部通过

**设计亮点**:
1. 双层截断策略 - 行级截断 + 字节级截断，确保输出在限制内
2. 字符级截断 - 单行超长内容通过 findCharBudget 二分查找精确裁剪
3. 完整内容保存 - 截断后自动保存到临时文件，通过 outputPath 引用
4. 自动清理 - cleanupOldFiles() 删除7天前的临时文件
5. 方向控制 - head/tail 方向支持，适应不同场景

**文件列表**:
```
Create:
- src/truncate/index.ts      # 主导出
- src/truncate/storage.ts    # 临时文件存储
- src/truncate/cleanup.ts    # 自动清理

Modify (应用截断):
- src/tools/builtin/bash.ts
- src/tools/builtin/grep.ts
- src/tools/builtin/find.ts
```

**核心实现**:

```typescript
// src/truncate/index.ts

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export interface TruncateOptions {
  maxLines?: number      // 默认 2000
  maxBytes?: number      // 默认 50000
  direction?: 'head' | 'tail'  // 默认 'head'
  tempDir?: string
  prefix?: string
}

export interface TruncateResult {
  output: string
  truncated: boolean
  outputPath?: string
  originalLines: number
  originalBytes: number
  resultLines: number
  resultBytes: number
}

export function truncate(content: string, options: TruncateOptions = {}): TruncateResult {
  const { maxLines = 2000, maxBytes = 50000, direction = 'head' } = options

  const originalLines = content.split('\n').length
  const originalBytes = Buffer.byteLength(content, 'utf-8')

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

  let lines = content.split('\n')

  if (direction === 'head') {
    lines = lines.slice(0, maxLines)
  } else {
    lines = lines.slice(-maxLines)
  }

  let result = lines.join('\n')

  // 字节限制
  while (Buffer.byteLength(result, 'utf-8') > maxBytes && lines.length > 1) {
    if (direction === 'head') lines.pop()
    else lines.shift()
    result = lines.join('\n')
  }

  const notice = `\n\n... [截断 ${originalLines - lines.length} 行，完整输出见文件]`
  result = result.slice(0, maxBytes - notice.length - 100) + notice

  return {
    output: result,
    truncated: true,
    originalLines,
    originalBytes,
    resultLines: lines.length,
    resultBytes: Buffer.byteLength(result, 'utf-8'),
  }
}

export async function truncateAndSave(content: string, options: TruncateOptions = {}): Promise<TruncateResult> {
  const result = truncate(content, options)

  if (!result.truncated) return result

  const tempDir = options.tempDir ?? join(tmpdir(), 'agentforge', 'truncated')
  const fileName = `${options.prefix ?? 'tool'}_${Date.now()}_${randomUUID().slice(0, 8)}.txt`
  const outputPath = join(tempDir, fileName)

  await mkdir(tempDir, { recursive: true })
  await writeFile(outputPath, content, 'utf-8')

  return { ...result, outputPath }
}

export const truncateIfNeeded = truncate
export const truncateIfNeededAsync = truncateAndSave
```

```typescript
// src/truncate/storage.ts

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readdir, stat, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const TRUNCATE_DIR = join(tmpdir(), 'agentforge', 'truncated')
const MAX_AGE_DAYS = 7

export async function cleanupOldFiles(): Promise<number> {
  if (!existsSync(TRUNCATE_DIR)) return 0

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
    } catch { /* ignore */ }
  }

  return deleted
}
```

**测试用例**:

```typescript
// tests/truncate/truncate.test.ts

describe('Truncate', () => {
  it('should not truncate short content')
  it('should truncate by lines')
  it('should truncate by bytes')
  it('should support tail direction')
  it('should add truncation notice')
  it('should save full content to temp file')
  it('should cleanup old files')
})
```

---

### Task 5: 测试验证 ✅ 已完成

**目标**: 确保 P0 所有功能正常，无回归。

**验证清单**:
```
[✅] Provider.model('anthropic', 'claude-sonnet-4') 可用（需 API key）
[✅] Provider.model('openai', 'gpt-4o') 可用（需 API key）
[✅] Provider.findModel('claude') 返回模型信息
[✅] Tool execute 收到完整 ToolContext
[✅] Tool 可以访问 ctx.messages
[✅] Tool 可以调用 ctx.ask()
[✅] Bash 输出超过 2000 行自动截断
[✅] 截断后可通过 read 工具查看完整内容
[✅] 临时文件 7 天自动清理
[✅] 全量测试通过 (除已知失败)
```

**测试结果**:
- P0 验证测试: 30/30 通过 ✅
- 全量测试: 282/292 通过 (10 个失败为预先存在问题)

**已知失败（非 P0 相关）**:
1. `tests/cli/cli-commands.test.ts` (4): build 命令未实现，dev/start 测试过时
2. `tests/sandbox/sandbox.test.ts` (1): 进程终止测试不稳定
3. `tests/session/checkpoint.test.ts` (3): 测试超时
4. `tests/e2e.test.ts` (2): 测试超时（无 API keys）

---

## P1 架构决策 (P0 完成后)

| 项目 | 状态 | 提交 |
|------|------|------|
| **P1 Task 1: 权限 Ruleset** | ✅ 完成 | b2f1ae1 |
| **P1 Task 2: 生命周期 Middleware** | ✅ 完成 | ee00904 |
| **P1 Task 3: 持久化存储扩展** | ✅ 完成 | — |

### P1 Task 3: 持久化存储扩展 ✅ 已完成

**设计参考**: OpenCode SQLite WAL/session tables + Mastra persistWorkflowSnapshot + Agentscope JSON serialization

**已完成内容**:
- `src/memory/types.ts` - 新增 AgentState 接口和 Zod schema
- `src/memory/types.ts` - MemoryStorage 接口扩展 (可选方法)
- `src/storage/sqlite-memory.ts` - agent_state 表 + checkpoints 表
- `src/storage/sqlite-memory.ts` - AgentState CRUD 方法实现
- `src/storage/sqlite-memory.ts` - Checkpoint CRUD 方法实现
- `src/memory/index.ts` - AgentState/Checkpoint 类型导出
- `src/index.ts` - AgentState/Checkpoint 顶层导出
- `tests/storage/sqlite-extension.test.ts` - 24 个测试用例全部通过

**核心设计**:
1. AgentState 表 - 按 (sessionId, agentName) 唯一索引，支持 upsert
2. Checkpoints 表 - 按 sessionId 索引，JSON 序列化复杂字段
3. 可选方法 - 所有新方法为可选，不破坏现有 MemoryStorage 实现
4. SQLite WAL - 继承原有 SQLite 配置，支持持久化
5. NULL 转换 - 正确处理 null → undefined 转换

**新增表结构**:
```sql
-- agent_state
CREATE TABLE agent_state (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL,
  step INTEGER NOT NULL,
  max_steps INTEGER NOT NULL,
  error TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  UNIQUE(session_id, agent_name)
);

-- checkpoints
CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  messages TEXT NOT NULL,
  tool_calls TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at REAL NOT NULL,
  metadata TEXT
);
```

**新增 MemoryStorage 方法**:
```typescript
// AgentState (optional)
getAgentState?(sessionId: string, agentName: string): Promise<AgentState | null>;
saveAgentState?(state: AgentState): Promise<AgentState>;
deleteAgentState?(sessionId: string, agentName: string): Promise<void>;
listAgentStates?(sessionId: string): Promise<AgentState[]>;

// Checkpoint (optional)
getCheckpoint?(checkpointId: string): Promise<Checkpoint | null>;
saveCheckpoint?(checkpoint: Checkpoint): Promise<Checkpoint>;
listCheckpoints?(sessionId: string): Promise<Checkpoint[]>;
deleteCheckpoint?(checkpointId: string): Promise<boolean>;
```

---

## P2 生产稳定性增强 (计划)

> **目标**: 解决 P1 遗留问题，增强生产环境稳定性

| 项目 | 状态 | 优先级 |
|------|------|--------|
| **P2 Task 1: 安全默认策略** | ✅ 完成 | — |
| **P2 Task 2: 存储层外键约束** | ✅ 完成 | — |
| **P2 Task 3: 错误处理增强** | 待开发 | 中 |
| **P2 Task 4: 可观测性集成** | 待开发 | 低 |

### P2 Task 1: 安全默认策略

**问题来源**: P1 审视问题 #1 - 权限系统默认过于宽松

**目标**: 提供可配置的默认策略，而非硬编码 `allow`

---

## 详细设计

### 1. 问题分析

**当前实现缺陷**:
```typescript
// manager.ts:178-180 (当前代码)
if (!lastMatch) {
  return { action: 'allow' };  // 硬编码，无法配置
}
```

**安全风险**:
1. 无任何规则时，默认允许所有操作
2. 新工具类别未定义规则时自动放行
3. 生产环境默认过于宽松

**影响范围**:
- `src/permission/types.ts` - 新增配置接口
- `src/permission/manager.ts` - 核心评估逻辑
- `src/permission/index.ts` - 导出更新
- `src/config/schema.ts` - Zod schema 扩展（可选）
- `src/agent/factory.ts` - 配置传递
- `src/index.ts` - 顶层导出
- `tests/permission/permission.test.ts` - 测试更新

---

### 2. 核心接口设计

#### 2.1 PermissionManagerConfig 接口（新增）

```typescript
// src/permission/types.ts

import type { PermissionAction } from './types';

/**
 * PermissionManager 配置选项
 * 
 * @example
 * ```typescript
 * // 默认安全模式 (推荐)
 * const manager = new PermissionManager();
 * 
 * // 向后兼容模式
 * const manager = new PermissionManager({ defaultAction: 'allow' });
 * 
 * // 严格模式
 * const manager = new PermissionManager({ strict: true });
 * ```
 */
export interface PermissionManagerConfig {
  /** 
   * 无规则匹配时的默认动作
   * - 'ask': 提示用户确认 (推荐，更安全)
   * - 'allow': 允许执行 (旧行为，向后兼容)
   * - 'deny': 拒绝执行 (严格模式)
   * @default 'ask'
   */
  defaultAction?: PermissionAction;
  
  /**
   * 严格模式预设
   * - 启用时: 使用 strictRules + defaultAction='deny'
   * - 覆盖 defaultAction 配置
   * @default false
   */
  strict?: boolean;
}
```

#### 2.2 PermissionManager 类变更

```typescript
// src/permission/manager.ts

import type { PermissionManagerConfig } from './types';
import { strictRules, defaultRules } from './presets';

export class PermissionManager {
  // 新增: 配置属性
  private config: { defaultAction: PermissionAction };
  
  private globalRules: Ruleset = [];
  private agentRules: Map<string, Ruleset> = new Map();
  private sessionAlwaysAllowed: Map<string, PermissionRule[]> = new Map();
  private pendingRequests: Map<string, PermissionRequest> = new Map();

  /**
   * 创建权限管理器实例
   * 
   * @param config - 配置选项
   * 
   * @example
   * ```typescript
   * // 默认安全模式 (推荐)
   * const manager = new PermissionManager();
   * manager.setRules(defaultRules);
   * 
   * // 向后兼容模式
   * const manager = new PermissionManager({ defaultAction: 'allow' });
   * 
   * // 严格模式
   * const manager = new PermissionManager({ strict: true });
   * ```
   */
  constructor(config?: PermissionManagerConfig) {
    // 严格模式: 使用 strictRules + defaultAction='deny'
    if (config?.strict) {
      this.config = { defaultAction: 'deny' };
      this.globalRules = [...strictRules];
    } else {
      // 正常模式: defaultAction='ask'
      this.config = { 
        defaultAction: config?.defaultAction ?? 'ask' 
      };
    }
  }

  /**
   * 获取当前默认动作配置
   */
  getDefaultAction(): PermissionAction {
    return this.config.defaultAction;
  }

  // ... 其他方法保持不变
}
```

---

### 3. manager.ts 核心修改点

#### 3.1 check() 方法完整实现

```typescript
// src/permission/manager.ts

check(
  sessionId: string,
  category: string,
  input: string,
  agentName?: string
): PermissionCheckResult {
  // 1. Check session "always allowed" rules first (不变)
  const alwaysRules = this.sessionAlwaysAllowed.get(sessionId);
  if (alwaysRules) {
    for (const rule of alwaysRules) {
      if (rule.permission === category && matchPattern(rule.pattern, input)) {
        return {
          action: 'allow',
          matchedPattern: rule.pattern,
          matchedRule: rule,
        };
      }
    }
  }

  // 2. Resolve effective rules (global + agent)
  const rules = this.resolveRules(agentName);

  // 3. Evaluate rules: last match wins
  let lastMatch: { rule: PermissionRule; index: number } | null = null;

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.permission === category && matchPattern(rule.pattern, input)) {
      lastMatch = { rule, index: i };
    }
    if (rule.permission === '*' && matchPattern(rule.pattern, input)) {
      lastMatch = { rule, index: i };
    }
  }

  // ========== 核心变更: 使用配置的默认动作 ==========
  
  // 4. If no rule matched, use configured default action
  if (!lastMatch) {
    const result: PermissionCheckResult = {
      action: this.config.defaultAction,
    };
    
    // 5. If default action is 'ask', prepare the prompt
    if (this.config.defaultAction === 'ask') {
      const suggestedPatterns = this.generateSuggestedPatterns(category, input);
      result.askPrompt = {
        message: `Permission required: ${category} (no matching rule)`,
        choices: ['Allow once', 'Always allow', 'Deny'],
        defaultChoice: 'Deny',
      };
      result.suggestedPatterns = suggestedPatterns;
    }
    
    return result;
  }

  // ========== 原有逻辑（规则匹配时）==========
  
  const matchedRule = lastMatch.rule;
  const result: PermissionCheckResult = {
    action: matchedRule.action,
    matchedPattern: matchedRule.pattern,
    matchedRule,
  };

  // 6. If action is 'ask', prepare the prompt
  if (matchedRule.action === 'ask') {
    const suggestedPatterns = this.generateSuggestedPatterns(category, input);
    result.askPrompt = {
      message: `Permission required: ${category}`,
      choices: ['Allow once', 'Always allow', 'Deny'],
      defaultChoice: 'Allow once',
    };
    result.suggestedPatterns = suggestedPatterns;
  }

  return result;
}
```

#### 3.2 旧代码 vs 新代码对比

```typescript
// ❌ 旧代码 (硬编码)
if (!lastMatch) {
  return { action: 'allow' };
}

// ✅ 新代码 (可配置)
if (!lastMatch) {
  const result: PermissionCheckResult = {
    action: this.config.defaultAction,  // 使用配置
  };
  
  if (this.config.defaultAction === 'ask') {
    result.askPrompt = {
      message: `Permission required: ${category} (no matching rule)`,
      choices: ['Allow once', 'Always allow', 'Deny'],
      defaultChoice: 'Deny',
    };
    result.suggestedPatterns = this.generateSuggestedPatterns(category, input);
  }
  
  return result;
}
```

---

### 4. config/schema.ts 扩展（可选）

```typescript
// src/config/schema.ts

import { z } from 'zod';

/**
 * PermissionManager 配置 Schema
 */
export const PermissionManagerConfigSchema = z.object({
  defaultAction: z.enum(['allow', 'deny', 'ask']).default('ask'),
  strict: z.boolean().default(false),
});

export type PermissionManagerConfig = z.infer<typeof PermissionManagerConfigSchema>;

// AgentConfigSchema 扩展
export const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.string().default('gpt-4-turbo'),
  // ... 现有字段 ...
  
  // 新增: 权限配置
  permission: z.object({
    defaultAction: z.enum(['allow', 'deny', 'ask']).default('ask'),
    strict: z.boolean().default(false),
  }).optional(),
});
```

---

### 5. factory.ts 集成

```typescript
// src/agent/factory.ts

import { PermissionManager } from '../permission/manager.js';
import type { PermissionManagerConfig } from '../permission/types.js';
import { defaultRules } from '../permission/presets.js';

export interface AgentFactoryOptions {
  adapter?: LLMAdapter;
  history?: HistoryManager;
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  middleware?: Middleware[];
  registerBuiltinTools?: boolean;
  memoryManager?: MemoryManager;
  memoryConfig?: MemoryManagerConfig;
  
  // 新增: 权限配置
  permissionConfig?: PermissionManagerConfig;
}

export class AgentFactory {
  // ...

  async create(): Promise<Agent> {
    // ... 现有代码 ...

    const registry = this.options.registry ?? this.createRegistry(agentConfig);

    // ========== 新增: 权限管理器配置 ==========
    if (this.options.permissionConfig) {
      const permissionManager = new PermissionManager(this.options.permissionConfig);
      permissionManager.setRules(defaultRules);
      registry.setPermissionManager(permissionManager);
      this.log.info('Permission manager configured', { 
        defaultAction: this.options.permissionConfig.defaultAction ?? 'ask',
        strict: this.options.permissionConfig.strict ?? false,
      });
    }

    const agent = new Agent(adapter, history, registry, {
      ...agentConfig,
      pluginManager,
      middleware,
      memoryManager,
    });

    return agent;
  }

  private createRegistry(_config: AgentConfig): ToolRegistry {
    const registry = new ToolRegistry();

    if (this.options.registerBuiltinTools) {
      registry.register(allTools);
      this.log.debug('Registered all built-in tools', { count: allTools.length });
    }

    // ========== 新增: 默认权限管理器 ==========
    // 如果未提供 permissionConfig，使用安全默认
    const permissionConfig = this.options.permissionConfig ?? { defaultAction: 'ask' as const };
    const permissionManager = new PermissionManager(permissionConfig);
    permissionManager.setRules(defaultRules);
    registry.setPermissionManager(permissionManager);

    return registry;
  }
}
```

---

### 6. types.ts 修改点

```typescript
// src/permission/types.ts

// 现有类型
export type PermissionAction = 'allow' | 'deny' | 'ask';
export interface PermissionRule { /* ... */ }
export type Ruleset = PermissionRule[];

// ========== 新增 ==========
/**
 * PermissionManager 配置选项
 */
export interface PermissionManagerConfig {
  defaultAction?: PermissionAction;
  strict?: boolean;
}

// ========== 导出更新 ==========
export type {
  // 现有
  PermissionAction,
  PermissionRule,
  Ruleset,
  // ...
  
  // 新增
  PermissionManagerConfig,
};
```

---

### 7. 文件变更清单

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `src/permission/types.ts` | **Modify** | 新增 `PermissionManagerConfig` 接口 |
| `src/permission/manager.ts` | **Modify** | 1. 新增 `config` 私有属性<br>2. 构造函数接受配置<br>3. `check()` 使用 `this.config.defaultAction`<br>4. 新增 `getDefaultAction()` 方法 |
| `src/permission/index.ts` | **Modify** | 导出 `PermissionManagerConfig` 类型 |
| `src/config/schema.ts` | **Modify** | 新增 `PermissionManagerConfigSchema` |
| `src/agent/factory.ts` | **Modify** | 1. `AgentFactoryOptions` 新增 `permissionConfig`<br>2. `create()` 传递配置<br>3. `createRegistry()` 创建默认权限管理器 |
| `src/index.ts` | **Modify** | 导出 `PermissionManagerConfig` 类型 |
| `tests/permission/permission.test.ts` | **Modify** | 1. 更新现有测试<br>2. 新增 10 个测试用例 |

---

### 8. 测试用例设计

```typescript
// tests/permission/permission.test.ts

describe('PermissionManager Security Defaults', () => {
  describe('constructor and default action', () => {
    it('should default to ask when no config provided', () => {
      const manager = new PermissionManager();
      expect(manager.getDefaultAction()).toBe('ask');
    });

    it('should use defaultAction=allow for backward compatibility', () => {
      const manager = new PermissionManager({ defaultAction: 'allow' });
      expect(manager.getDefaultAction()).toBe('allow');
    });

    it('should use defaultAction=deny when configured', () => {
      const manager = new PermissionManager({ defaultAction: 'deny' });
      expect(manager.getDefaultAction()).toBe('deny');
    });

    it('should return deny when no rules match and defaultAction=deny', () => {
      const manager = new PermissionManager({ defaultAction: 'deny' });
      const result = manager.check('s1', 'bash', 'git status');
      expect(result.action).toBe('deny');
    });

    it('should return ask with prompt when no rules match and defaultAction=ask', () => {
      const manager = new PermissionManager({ defaultAction: 'ask' });
      const result = manager.check('s1', 'bash', 'git status');
      expect(result.action).toBe('ask');
      expect(result.askPrompt).toBeDefined();
      expect(result.askPrompt?.message).toContain('no matching rule');
      expect(result.askPrompt?.defaultChoice).toBe('Deny');
    });
  });

  describe('strict mode', () => {
    it('should set defaultAction=deny in strict mode', () => {
      const manager = new PermissionManager({ strict: true });
      expect(manager.getDefaultAction()).toBe('deny');
    });

    it('should load strictRules in strict mode', () => {
      const manager = new PermissionManager({ strict: true });
      // read is allowed in strictRules (last match wins)
      expect(manager.check('s1', 'read', 'any').action).toBe('allow');
      // bash is ask in strictRules
      expect(manager.check('s1', 'bash', 'git status').action).toBe('ask');
      // unknown is deny (defaultAction)
      expect(manager.check('s1', 'unknown', 'any').action).toBe('deny');
    });

    it('should allow custom rules to override strict defaults', () => {
      const manager = new PermissionManager({ strict: true });
      manager.setRules([
        { permission: 'custom', action: 'allow', pattern: '*' },
      ]);
      expect(manager.check('s1', 'custom', 'any').action).toBe('allow');
      expect(manager.check('s1', 'unknown', 'any').action).toBe('deny');
    });

    it('strict should override defaultAction config', () => {
      const manager = new PermissionManager({ 
        strict: true, 
        defaultAction: 'allow' 
      });
      expect(manager.getDefaultAction()).toBe('deny');
      expect(manager.check('s1', 'unknown', 'any').action).toBe('deny');
    });
  });

  describe('integration with existing features', () => {
    it('should still respect sessionAlwaysAllowed over defaultAction', () => {
      const manager = new PermissionManager({ defaultAction: 'deny' });
      manager.setAlwaysAllowed('s1', 'bash', 'git *');
      expect(manager.check('s1', 'bash', 'git status').action).toBe('allow');
    });

    it('should still respect matched rules over defaultAction', () => {
      const manager = new PermissionManager({ defaultAction: 'deny' });
      manager.setRules([
        { permission: 'bash', action: 'ask', pattern: '*' },
      ]);
      expect(manager.check('s1', 'bash', 'any').action).toBe('ask');
    });

    it('should work with defaultRules and ask default', () => {
      const manager = new PermissionManager({ defaultAction: 'ask' });
      manager.setRules(defaultRules);
      // defaultRules covers bash with 'ask'
      expect(manager.check('s1', 'bash', 'git status').action).toBe('ask');
      // unknown category uses defaultAction
      expect(manager.check('s1', 'unknown', 'any').action).toBe('ask');
    });
  });
});

describe('AgentFactory integration', () => {
  it('should create PermissionManager with permissionConfig', async () => {
    const agent = await AgentFactory.create(
      { name: 'test', model: 'gpt-4' },
      { permissionConfig: { defaultAction: 'deny' } }
    );
    const registry = (agent as any).registry;
    expect(registry.permissionManager.getDefaultAction()).toBe('deny');
  });

  it('should use safe defaults when no permissionConfig provided', async () => {
    const agent = await AgentFactory.create(
      { name: 'test', model: 'gpt-4' }
    );
    const registry = (agent as any).registry;
    expect(registry.permissionManager.getDefaultAction()).toBe('ask');
  });
});
```

---

### 9. Breaking Change 说明

**⚠️ 这是一个破坏性变更**

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| `new PermissionManager()` 无规则 | `action: 'allow'` | `action: 'ask'` |
| `AgentFactory.create()` 无配置 | 无权限管理器 | 安全默认配置 |
| 未定义类别的工具调用 | 自动允许 | 提示用户确认 |

**迁移路径**:

```typescript
// ❌ 旧行为 (不推荐)
const manager = new PermissionManager();  // 硬编码 allow

// ✅ 向后兼容 (显式声明)
const manager = new PermissionManager({ defaultAction: 'allow' });

// ✅ 推荐新用法
const manager = new PermissionManager();  // 默认 ask
manager.setRules(defaultRules);

// ✅ 严格模式
const manager = new PermissionManager({ strict: true });
```

**影响评估**:
- 大多数用户已通过 `setRules(defaultRules)` 设置规则，规则匹配部分未受影响
- 只有依赖"无规则=允许"行为的代码需要更新
- 新默认值更安全，符合"安全优先"原则
- `AgentFactory` 自动创建安全默认配置，无需额外代码

---

### 10. 实现步骤

```
Phase 1: 类型定义
├── [ ] src/permission/types.ts - 添加 PermissionManagerConfig 接口
└── [ ] 验证: 类型检查通过 (pnpm tsc --noEmit)

Phase 2: 核心实现
├── [ ] src/permission/manager.ts - 添加 config 私有属性
├── [ ] src/permission/manager.ts - 构造函数接受配置
├── [ ] src/permission/manager.ts - check() 使用 this.config.defaultAction
├── [ ] src/permission/manager.ts - 无匹配时生成 askPrompt
├── [ ] src/permission/manager.ts - 新增 getDefaultAction() 方法
└── [ ] 验证: 编译通过

Phase 3: 导出更新
├── [ ] src/permission/index.ts - 导出 PermissionManagerConfig 类型
├── [ ] src/index.ts - 顶层导出 PermissionManagerConfig 类型
└── [ ] 验证: 导出正确 (pnpm build)

Phase 4: 集成配置
├── [ ] src/config/schema.ts - 添加 PermissionManagerConfigSchema
├── [ ] src/agent/factory.ts - AgentFactoryOptions 添加 permissionConfig
├── [ ] src/agent/factory.ts - createRegistry() 创建默认权限管理器
└── [ ] 验证: 编译通过

Phase 5: 测试更新
├── [ ] tests/permission/permission.test.ts - 更新现有测试 (defaultAction: 'allow')
├── [ ] tests/permission/permission.test.ts - 新增 10 个测试用例
└── [ ] 验证: 所有测试通过 (pnpm test:run)

Phase 6: 文档更新
└── [ ] 更新 docs/guide/permissions.md (如有)
```

---

### 11. 预期产出清单

- [ ] `PermissionManagerConfig` 接口定义
- [ ] `PermissionManager` 构造函数支持配置
- [ ] `strict` 模式预设实现
- [ ] `check()` 方法使用 `this.config.defaultAction`
- [ ] 无规则匹配时生成 `askPrompt`
- [ ] `getDefaultAction()` 方法
- [ ] `AgentFactory` 集成
- [ ] `PermissionManagerConfigSchema` (Zod)
- [ ] 10 个新测试用例全部通过
- [ ] 现有测试更新并全部通过
- [ ] 类型导出正确
- [ ] Breaking Change 文档化

---

### P2 Task 2: 存储层外键约束

**问题来源**: P1 审视问题 #3 - AgentState/Checkpoint 表缺乏级联删除

**当前问题**: Thread 删除时，相关数据不会级联删除

---

## 详细设计

### 1. 问题分析

**当前表结构**:

```sql
-- 已有外键约束的表
messages          → FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
working_memory    → FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
observations      → FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE

-- 缺乏外键约束的表 (P1 新增)
agent_state       → 无外键，只有索引 idx_agent_state_session_id
checkpoints       → 无外键，只有索引 idx_checkpoints_session_id
```

**当前 deleteThread() 实现**:

```typescript
// src/storage/sqlite-memory.ts:171-177
async deleteThread(threadId: string): Promise<void> {
  this.db!.run('DELETE FROM threads WHERE id = ?', [threadId]);
  this.db!.run('DELETE FROM messages WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM working_memory WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);
  // ❌ 缺少: agent_state, checkpoints
}
```

**数据孤岛问题**:
1. 删除 Thread 后，`agent_state` 和 `checkpoints` 数据残留
2. 残留数据占用存储空间
3. 可能导致数据不一致（孤儿记录）

**技术约束**:
1. sql.js 是 WebAssembly 版本的 SQLite，数据在内存中
2. SQLite 不支持 `ALTER TABLE ADD CONSTRAINT` 添加外键
3. SQLite 外键默认禁用，需要 `PRAGMA foreign_keys = ON`
4. `session_id` 与 `thread_id` 术语不一致（P3 Task 2 将统一）

---

### 2. 设计方案选择

#### Option A: 添加外键约束

```sql
-- 需要重建表才能添加外键
CREATE TABLE agent_state_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL,
  step INTEGER NOT NULL,
  max_steps INTEGER NOT NULL,
  error TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  UNIQUE(session_id, agent_name),
  FOREIGN KEY (session_id) REFERENCES threads(id) ON DELETE CASCADE
);

INSERT INTO agent_state_new SELECT * FROM agent_state;
DROP TABLE agent_state;
ALTER TABLE agent_state_new RENAME TO agent_state;
```

**优点**: 数据库级别保证一致性
**缺点**: 
- sql.js 每次启动都是新实例，迁移脚本每次都要执行
- 需要启用 `PRAGMA foreign_keys = ON`
- 复杂度高，容易出错

#### Option B: 手动级联删除（推荐）

```typescript
async deleteThread(threadId: string): Promise<void> {
  this.db!.run('DELETE FROM agent_state WHERE session_id = ?', [threadId]);
  this.db!.run('DELETE FROM checkpoints WHERE session_id = ?', [threadId]);
  this.db!.run('DELETE FROM messages WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM working_memory WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM threads WHERE id = ?', [threadId]);
}
```

**优点**: 
- 简单可靠，不依赖 SQLite pragma 状态
- 易于测试和验证
- 保持向后兼容
- 适用于 sql.js 内存数据库特性

**缺点**: 
- 代码级保证，非数据库级保证
- 删除顺序需要正确（先删子表，后删主表）

**决策**: 采用 **Option B（手动级联删除）**

---

### 3. 代码实现

#### 3.1 deleteThread() 方法完整实现

```typescript
// src/storage/sqlite-memory.ts

/**
 * Delete a thread and all associated data.
 * Cascade deletes to: messages, working_memory, observations, agent_state, checkpoints
 */
async deleteThread(threadId: string): Promise<void> {
  this.ensureInitialized();
  
  // Delete in correct order: child tables first, then parent
  // 1. Delete agent_state (references session_id = threadId)
  this.db!.run('DELETE FROM agent_state WHERE session_id = ?', [threadId]);
  
  // 2. Delete checkpoints (references session_id = threadId)
  this.db!.run('DELETE FROM checkpoints WHERE session_id = ?', [threadId]);
  
  // 3. Delete messages (has FK CASCADE, but delete explicitly for clarity)
  this.db!.run('DELETE FROM messages WHERE thread_id = ?', [threadId]);
  
  // 4. Delete working_memory (has FK CASCADE, but delete explicitly for clarity)
  this.db!.run('DELETE FROM working_memory WHERE thread_id = ?', [threadId]);
  
  // 5. Delete observations (has FK CASCADE, but delete explicitly for clarity)
  this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);
  
  // 6. Finally delete the thread itself
  this.db!.run('DELETE FROM threads WHERE id = ?', [threadId]);
}
```

#### 3.2 旧代码 vs 新代码对比

```typescript
// ❌ 旧代码 (缺失 agent_state, checkpoints)
async deleteThread(threadId: string): Promise<void> {
  this.db!.run('DELETE FROM threads WHERE id = ?', [threadId]);
  this.db!.run('DELETE FROM messages WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM working_memory WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);
}

// ✅ 新代码 (完整级联删除)
async deleteThread(threadId: string): Promise<void> {
  // 新增: 删除 agent_state
  this.db!.run('DELETE FROM agent_state WHERE session_id = ?', [threadId]);
  // 新增: 删除 checkpoints
  this.db!.run('DELETE FROM checkpoints WHERE session_id = ?', [threadId]);
  // 原有: 删除 messages, working_memory, observations, threads
  this.db!.run('DELETE FROM messages WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM working_memory WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM observations WHERE thread_id = ?', [threadId]);
  this.db!.run('DELETE FROM threads WHERE id = ?', [threadId]);
}
```

---

### 4. 文件变更清单

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `src/storage/sqlite-memory.ts` | **Modify** | `deleteThread()` 添加 agent_state 和 checkpoints 删除 |
| `tests/storage/sqlite-extension.test.ts` | **Modify** | 新增级联删除测试用例 |

---

### 5. 测试用例设计

```typescript
// tests/storage/sqlite-extension.test.ts

describe('Cascade Delete', () => {
  describe('deleteThread cascade', () => {
    it('should delete agent_state when thread is deleted', async () => {
      // Setup: create thread and agent_state
      await storage.saveThread({
        id: 'thread-cascade-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await storage.saveAgentState({
        id: 'state-cascade-1',
        sessionId: 'thread-cascade-1',
        agentName: 'test-agent',
        status: 'running',
        step: 1,
        maxSteps: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act: delete thread
      await storage.deleteThread('thread-cascade-1');

      // Assert: agent_state should be deleted
      const state = await storage.getAgentState('thread-cascade-1', 'test-agent');
      expect(state).toBeNull();
    });

    it('should delete checkpoints when thread is deleted', async () => {
      // Setup: create thread and checkpoint
      await storage.saveThread({
        id: 'thread-cascade-2',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await storage.saveCheckpoint({
        id: 'checkpoint-cascade-1',
        sessionId: 'thread-cascade-2',
        stepIndex: 1,
        messages: [],
        toolCalls: [],
        state: { status: 'running', step: 1, maxSteps: 10 },
        createdAt: Date.now(),
      });

      // Act: delete thread
      await storage.deleteThread('thread-cascade-2');

      // Assert: checkpoint should be deleted
      const checkpoint = await storage.getCheckpoint('checkpoint-cascade-1');
      expect(checkpoint).toBeNull();
    });

    it('should delete all related data when thread is deleted', async () => {
      // Setup: create thread with all related data
      const threadId = 'thread-full-cascade';
      await storage.saveThread({
        id: threadId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add messages
      await storage.addMessage(threadId, { role: 'user', content: 'test' });

      // Add working memory
      await storage.saveWorkingMemory(threadId, {
        content: 'working memory',
        updatedAt: new Date(),
      });

      // Add agent_state
      await storage.saveAgentState({
        id: 'state-full',
        sessionId: threadId,
        agentName: 'agent-1',
        status: 'running',
        step: 1,
        maxSteps: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add checkpoint
      await storage.saveCheckpoint({
        id: 'checkpoint-full',
        sessionId: threadId,
        stepIndex: 1,
        messages: [],
        toolCalls: [],
        state: { status: 'running', step: 1, maxSteps: 10 },
        createdAt: Date.now(),
      });

      // Act: delete thread
      await storage.deleteThread(threadId);

      // Assert: all related data should be deleted
      const thread = await storage.getThread(threadId);
      expect(thread).toBeNull();

      const messages = await storage.getMessages(threadId);
      expect(messages).toHaveLength(0);

      const wm = await storage.getWorkingMemory(threadId);
      expect(wm).toBeNull();

      const states = await storage.listAgentStates(threadId);
      expect(states).toHaveLength(0);

      const checkpoints = await storage.listCheckpoints(threadId);
      expect(checkpoints).toHaveLength(0);
    });

    it('should not affect other threads data', async () => {
      // Setup: create two threads with data
      await storage.saveThread({
        id: 'thread-keep',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await storage.saveThread({
        id: 'thread-delete',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.saveAgentState({
        id: 'state-keep',
        sessionId: 'thread-keep',
        agentName: 'agent-keep',
        status: 'running',
        step: 1,
        maxSteps: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.saveAgentState({
        id: 'state-delete',
        sessionId: 'thread-delete',
        agentName: 'agent-delete',
        status: 'running',
        step: 1,
        maxSteps: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Act: delete one thread
      await storage.deleteThread('thread-delete');

      // Assert: other thread's data should remain
      const keepState = await storage.getAgentState('thread-keep', 'agent-keep');
      expect(keepState).not.toBeNull();
      expect(keepState!.id).toBe('state-keep');
    });

    it('should handle deleting non-existent thread gracefully', async () => {
      // Act: delete non-existent thread (should not throw)
      await expect(storage.deleteThread('non-existent-thread')).resolves.toBeUndefined();
    });
  });
});
```

---

### 6. 实现步骤

```
Phase 1: 代码修改
├── [ ] src/storage/sqlite-memory.ts - deleteThread() 添加 agent_state 删除
├── [ ] src/storage/sqlite-memory.ts - deleteThread() 添加 checkpoints 删除
└── [ ] 验证: 编译通过

Phase 2: 测试更新
├── [ ] tests/storage/sqlite-extension.test.ts - 新增 Cascade Delete 测试套件
├── [ ] tests/storage/sqlite-extension.test.ts - 5 个新测试用例
└── [ ] 验证: 所有测试通过
```

---

### 7. 预期产出清单

- [ ] `deleteThread()` 方法完整级联删除
- [ ] agent_state 随 thread 删除
- [ ] checkpoints 随 thread 删除
- [ ] 5 个级联删除测试用例全部通过
- [ ] 不影响其他 thread 数据
- [ ] 删除不存在的 thread 不报错

---

### 8. 注意事项

**删除顺序很重要**:
1. 先删除子表数据 (agent_state, checkpoints, messages, etc.)
2. 最后删除主表 (threads)
3. 避免外键约束冲突（即使当前 agent_state/checkpoints 没有外键）

**术语说明**:
- `thread_id` = `session_id` (P3 Task 2 将统一术语)
- 当前 `agent_state.session_id` 和 `checkpoints.session_id` 对应 `threads.id`

---

### P2 Task 3: 错误处理增强

**目标**: 统一错误类型，提供更好的错误信息和调试体验

---

## 详细设计

### 1. 现状分析

**已有错误类** (`src/errors/types.ts`):
```typescript
AppError              // 基类 (code, message, status)
├── NotFoundError     // 404
├── BadRequestError   // 400
├── UnauthorizedError // 401
├── ValidationError   // 400 + errors[]
├── ToolNotFoundError // 404
├── ToolExecuteError  // 500
└── LLMError          // 500
```

**问题识别**:

| 问题 | 描述 | 影响 |
|------|------|------|
| **存储层错误缺失** | `SQLiteMemoryStorage` 使用 `throw new Error()` | 无法区分错误类型 |
| **错误信息不完整** | 缺少操作上下文、表名、查询参数 | 调试困难 |
| **重复定义** | `storage/filesystem.ts` 定义了独立的 `NotFoundError` | 与 `errors/types.ts` 冲突 |
| **错误恢复困难** | 无法通过 code 判断是否可重试 | 需要字符串匹配 |
| **结构化数据丢失** | 错误信息只有字符串 | 无法程序化处理 |

**错误使用统计**:
- `throw new Error()`: 41 处
- `catch` 块: 69 处
- 现有自定义错误类: 7 个

---

### 2. 设计目标

1. **类型安全**: 每种错误场景有对应的错误类
2. **信息丰富**: 包含操作名、表名、查询参数、原因
3. **可恢复性**: 提供 `recoverable` 标记，支持自动重试
4. **向后兼容**: 不破坏现有 API
5. **调试友好**: 包含调用栈和上下文

---

### 3. 核心接口设计

#### 3.1 AppError 增强

```typescript
// src/errors/types.ts

/**
 * 应用错误基类
 * 
 * @example
 * ```typescript
 * throw new AppError('CONFIG_ERROR', 'Invalid configuration', 500, {
 *   recoverable: false,
 *   context: { configPath: '/path/to/config.json' }
 * })
 * ```
 */
export class AppError extends Error {
  public readonly timestamp: Date;

  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 500,
    public readonly options?: {
      /** 是否可恢复（重试可能成功） */
      recoverable?: boolean;
      /** 原始错误（用于错误链追踪） */
      cause?: Error;
      /** 额外上下文信息 */
      context?: Record<string, unknown>;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.timestamp = new Date();
  }

  /** 是否可恢复 */
  get recoverable(): boolean {
    return this.options?.recoverable ?? false;
  }

  /** 获取上下文信息 */
  get context(): Record<string, unknown> | undefined {
    return this.options?.context;
  }

  /** 获取原始错误 */
  get cause(): Error | undefined {
    return this.options?.cause;
  }

  toJSON(): {
    error: {
      code: string;
      message: string;
      status: number;
      recoverable: boolean;
      timestamp: string;
      context?: Record<string, unknown>;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        status: this.status,
        recoverable: this.recoverable,
        timestamp: this.timestamp.toISOString(),
        context: this.context,
      },
    };
  }

  /** 格式化为可读字符串 */
  toString(): string {
    const parts = [`[${this.code}] ${this.message}`];
    if (this.context) {
      parts.push(`Context: ${JSON.stringify(this.context)}`);
    }
    if (this.cause) {
      parts.push(`Caused by: ${this.cause.message}`);
    }
    return parts.join('\n');
  }
}
```

#### 3.2 存储层错误

```typescript
// src/errors/storage.ts

import { AppError } from './types.js';

/**
 * 存储操作名称
 */
export type StorageOperation =
  | 'initialize'
  | 'close'
  | 'getThread'
  | 'saveThread'
  | 'deleteThread'
  | 'listThreads'
  | 'getMessages'
  | 'addMessage'
  | 'getWorkingMemory'
  | 'saveWorkingMemory'
  | 'getObservationalMemory'
  | 'saveObservationalMemory'
  | 'getAgentState'
  | 'saveAgentState'
  | 'deleteAgentState'
  | 'listAgentStates'
  | 'getCheckpoint'
  | 'saveCheckpoint'
  | 'listCheckpoints'
  | 'deleteCheckpoint';

/**
 * 存储层错误基类
 */
export class StorageError extends AppError {
  constructor(
    operation: StorageOperation,
    message: string,
    options?: {
      recoverable?: boolean;
      cause?: Error;
      context?: Record<string, unknown>;
      table?: string;
    }
  ) {
    super('STORAGE_ERROR', message, 500, {
      ...options,
      context: {
        operation,
        table: options?.table,
        ...options?.context,
      },
    });
    this.name = 'StorageError';
  }
}

/**
 * 存储未初始化错误
 */
export class StorageNotInitializedError extends StorageError {
  constructor(operation: StorageOperation) {
    super(operation, 'Storage not initialized. Call initialize() first.', {
      recoverable: true,
    });
    this.name = 'StorageNotInitializedError';
    this.code = 'STORAGE_NOT_INITIALIZED';
  }
}

/**
 * Thread 未找到错误
 */
export class ThreadNotFoundError extends StorageError {
  constructor(threadId: string) {
    super('getThread', `Thread not found: ${threadId}`, {
      context: { threadId },
    });
    this.name = 'ThreadNotFoundError';
    this.code = 'THREAD_NOT_FOUND';
    this.status = 404;
  }
}

/**
 * Checkpoint 未找到错误
 */
export class CheckpointNotFoundError extends StorageError {
  constructor(checkpointId: string) {
    super('getCheckpoint', `Checkpoint not found: ${checkpointId}`, {
      context: { checkpointId },
    });
    this.name = 'CheckpointNotFoundError';
    this.code = 'CHECKPOINT_NOT_FOUND';
    this.status = 404;
  }
}

/**
 * AgentState 未找到错误
 */
export class AgentStateNotFoundError extends StorageError {
  constructor(sessionId: string, agentName: string) {
    super('getAgentState', `Agent state not found: ${sessionId}/${agentName}`, {
      context: { sessionId, agentName },
    });
    this.name = 'AgentStateNotFoundError';
    this.code = 'AGENT_STATE_NOT_FOUND';
    this.status = 404;
  }
}

/**
 * 数据库损坏错误
 */
export class DatabaseCorruptionError extends StorageError {
  constructor(
    operation: StorageOperation,
    message: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super(operation, message, {
      ...options,
      recoverable: false,
    });
    this.name = 'DatabaseCorruptionError';
    this.code = 'DATABASE_CORRUPTION';
  }
}

/**
 * 数据库写入错误
 */
export class DatabaseWriteError extends StorageError {
  constructor(
    operation: StorageOperation,
    message: string,
    options?: {
      cause?: Error;
      table?: string;
    }
  ) {
    super(operation, message, {
      ...options,
      recoverable: true, // 写入失败通常可以重试
    });
    this.name = 'DatabaseWriteError';
    this.code = 'DATABASE_WRITE_ERROR';
  }
}

/**
 * JSON 解析错误（存储层）
 */
export class StorageParseError extends StorageError {
  constructor(
    operation: StorageOperation,
    field: string,
    cause?: Error
  ) {
    super(operation, `Failed to parse JSON field: ${field}`, {
      cause,
      context: { field },
      recoverable: false,
    });
    this.name = 'StorageParseError';
    this.code = 'STORAGE_PARSE_ERROR';
  }
}
```

#### 3.3 权限错误

```typescript
// src/errors/permission.ts

import { AppError } from './types.js';

/**
 * 权限错误基类
 */
export class PermissionError extends AppError {
  constructor(
    message: string,
    options?: {
      recoverable?: boolean;
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super('PERMISSION_ERROR', message, 403, options);
    this.name = 'PermissionError';
  }
}

/**
 * 权限被拒绝错误
 */
export class PermissionDeniedError extends PermissionError {
  constructor(
    category: string,
    input: string,
    agentName?: string
  ) {
    super(`Permission denied: ${category} "${input}"`, {
      context: { category, input, agentName },
    });
    this.name = 'PermissionDeniedError';
    this.code = 'PERMISSION_DENIED';
  }
}

/**
 * 权限规则无效错误
 */
export class InvalidPermissionRuleError extends PermissionError {
  constructor(rule: string, reason: string) {
    super(`Invalid permission rule: ${rule}. ${reason}`, {
      context: { rule, reason },
      recoverable: false,
    });
    this.name = 'InvalidPermissionRuleError';
    this.code = 'INVALID_PERMISSION_RULE';
    this.status = 400;
  }
}
```

#### 3.4 配置错误

```typescript
// src/errors/config.ts

import { AppError } from './types.js';

/**
 * 配置错误基类
 */
export class ConfigError extends AppError {
  constructor(
    message: string,
    options?: {
      recoverable?: boolean;
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super('CONFIG_ERROR', message, 400, options);
    this.name = 'ConfigError';
  }
}

/**
 * 配置文件未找到错误
 */
export class ConfigNotFoundError extends ConfigError {
  constructor(configPath: string) {
    super(`Configuration file not found: ${configPath}`, {
      context: { configPath },
    });
    this.name = 'ConfigNotFoundError';
    this.code = 'CONFIG_NOT_FOUND';
    this.status = 404;
  }
}

/**
 * 配置验证错误
 */
export class ConfigValidationError extends ConfigError {
  constructor(
    message: string,
    errors: { field: string; message: string }[]
  ) {
    super(message, {
      context: { errors },
    });
    this.name = 'ConfigValidationError';
    this.code = 'CONFIG_VALIDATION_ERROR';
  }
}

/**
 * 配置解析错误
 */
export class ConfigParseError extends ConfigError {
  constructor(configPath: string, cause?: Error) {
    super(`Failed to parse configuration: ${configPath}`, {
      cause,
      context: { configPath },
    });
    this.name = 'ConfigParseError';
    this.code = 'CONFIG_PARSE_ERROR';
  }
}
```

#### 3.5 Agent 错误

```typescript
// src/errors/agent.ts

import { AppError } from './types.js';

/**
 * Agent 错误基类
 */
export class AgentError extends AppError {
  constructor(
    message: string,
    options?: {
      recoverable?: boolean;
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super('AGENT_ERROR', message, 500, options);
    this.name = 'AgentError';
  }
}

/**
 * Agent 执行超限错误
 */
export class AgentMaxStepsError extends AgentError {
  constructor(maxSteps: number, currentStep: number) {
    super(`Agent exceeded maximum steps: ${currentStep}/${maxSteps}`, {
      context: { maxSteps, currentStep },
      recoverable: false,
    });
    this.name = 'AgentMaxStepsError';
    this.code = 'AGENT_MAX_STEPS';
  }
}

/**
 * Agent 超时错误
 */
export class AgentTimeoutError extends AgentError {
  constructor(timeout: number) {
    super(`Agent execution timed out after ${timeout}ms`, {
      context: { timeout },
      recoverable: true,
    });
    this.name = 'AgentTimeoutError';
    this.code = 'AGENT_TIMEOUT';
  }
}

/**
 * Agent 被取消错误
 */
export class AgentCancelledError extends AgentError {
  constructor(reason?: string) {
    super(`Agent execution cancelled${reason ? `: ${reason}` : ''}`, {
      context: { reason },
      recoverable: false,
    });
    this.name = 'AgentCancelledError';
    this.code = 'AGENT_CANCELLED';
  }
}
```

---

### 4. 类型守卫和辅助函数

```typescript
// src/errors/guards.ts

import { AppError } from './types.js';
import {
  StorageError,
  StorageNotInitializedError,
  ThreadNotFoundError,
  CheckpointNotFoundError,
  AgentStateNotFoundError,
} from './storage.js';
import {
  PermissionError,
  PermissionDeniedError,
} from './permission.js';
import {
  ConfigError,
  ConfigNotFoundError,
  ConfigValidationError,
} from './config.js';
import {
  AgentError,
  AgentMaxStepsError,
  AgentTimeoutError,
  AgentCancelledError,
} from './agent.js';

/** 类型守卫：是否为 AppError */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** 类型守卫：是否为存储错误 */
export function isStorageError(err: unknown): err is StorageError {
  return err instanceof StorageError;
}

/** 类型守卫：是否为权限错误 */
export function isPermissionError(err: unknown): err is PermissionError {
  return err instanceof PermissionError;
}

/** 类型守卫：是否为配置错误 */
export function isConfigError(err: unknown): err is ConfigError {
  return err instanceof ConfigError;
}

/** 类型守卫：是否为 Agent 错误 */
export function isAgentError(err: unknown): err is AgentError {
  return err instanceof AgentError;
}

/** 类型守卫：是否为 404 错误 */
export function isNotFoundError(err: unknown): err is AppError {
  return isAppError(err) && err.status === 404;
}

/** 类型守卫：是否可恢复 */
export function isRecoverable(err: unknown): boolean {
  return isAppError(err) && err.recoverable;
}

/**
 * 将任意错误转换为 AppError
 */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err : undefined;
  
  return new AppError('INTERNAL_ERROR', message, 500, { cause });
}

/**
 * 获取错误链（从 cause 向上追溯）
 */
export function getErrorChain(err: Error): Error[] {
  const chain: Error[] = [err];
  let current = err;
  
  while (current.cause instanceof Error) {
    chain.push(current.cause);
    current = current.cause;
  }
  
  return chain;
}
```

---

### 5. 模块导出

```typescript
// src/errors/index.ts

// 基类
export { AppError } from './types.js';

// 通用错误
export {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  ToolNotFoundError,
  ToolExecuteError,
  LLMError,
} from './types.js';

// 存储错误
export {
  StorageError,
  StorageNotInitializedError,
  ThreadNotFoundError,
  CheckpointNotFoundError,
  AgentStateNotFoundError,
  DatabaseCorruptionError,
  DatabaseWriteError,
  StorageParseError,
} from './storage.js';
export type { StorageOperation } from './storage.js';

// 权限错误
export {
  PermissionError,
  PermissionDeniedError,
  InvalidPermissionRuleError,
} from './permission.js';

// 配置错误
export {
  ConfigError,
  ConfigNotFoundError,
  ConfigValidationError,
  ConfigParseError,
} from './config.js';

// Agent 错误
export {
  AgentError,
  AgentMaxStepsError,
  AgentTimeoutError,
  AgentCancelledError,
} from './agent.js';

// 类型守卫和辅助函数
export {
  isAppError,
  isStorageError,
  isPermissionError,
  isConfigError,
  isAgentError,
  isNotFoundError,
  isRecoverable,
  toAppError,
  getErrorChain,
} from './guards.js';

// 类型导出
export type { AppError as AppErrorType } from './types.js';
```

---

### 6. SQLiteMemoryStorage 改造示例

```typescript
// src/storage/sqlite-memory.ts

import {
  StorageNotInitializedError,
  ThreadNotFoundError,
  CheckpointNotFoundError,
  AgentStateNotFoundError,
  DatabaseWriteError,
  StorageParseError,
} from '../errors/index.js';

export class SQLiteMemoryStorage implements MemoryStorage {
  // ...

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new StorageNotInitializedError('unknown');
    }
  }

  async initialize(): Promise<void> {
    try {
      const SQL = await initSqlJs();
      // ...
    } catch (err) {
      throw new DatabaseWriteError('initialize', 'Failed to initialize database', {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  async getThread(threadId: string): Promise<Thread | null> {
    this.ensureInitialized();
    
    try {
      const result = this.db!.exec(
        'SELECT id, title, created_at, updated_at FROM threads WHERE id = ?',
        [threadId]
      );

      if (result.length === 0 || result[0].values.length === 0) {
        return null; // 返回 null 而非抛出，符合接口约定
      }
      // ...
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new DatabaseWriteError('getThread', 'Failed to get thread', {
        cause: err instanceof Error ? err : undefined,
        context: { threadId },
      });
    }
  }

  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    this.ensureInitialized();
    
    try {
      const result = this.db!.exec(
        `SELECT id, session_id, step_index, messages, tool_calls, state, created_at, metadata
         FROM checkpoints WHERE id = ?`,
        [checkpointId]
      );

      if (result.length === 0 || result[0].values.length === 0) {
        return null;
      }

      const [id, sessionId, stepIndex, messages, toolCalls, state, createdAt, metadata] = result[0].values[0];
      
      return {
        id: id as string,
        sessionId: sessionId as string,
        stepIndex: stepIndex as number,
        messages: JSON.parse(messages as string),
        toolCalls: JSON.parse(toolCalls as string),
        state: JSON.parse(state as string),
        createdAt: createdAt as number,
        metadata: metadata ? JSON.parse(metadata as string) : undefined,
      };
    } catch (err) {
      // JSON 解析错误
      if (err instanceof SyntaxError) {
        throw new StorageParseError('getCheckpoint', 'unknown', err);
      }
      if (err instanceof StorageError) throw err;
      throw new DatabaseWriteError('getCheckpoint', 'Failed to get checkpoint', {
        cause: err instanceof Error ? err : undefined,
        context: { checkpointId },
      });
    }
  }
}
```

---

### 7. 文件变更清单

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `src/errors/types.ts` | **Modify** | 增强 AppError 类（options, recoverable, cause, context） |
| `src/errors/storage.ts` | **Create** | StorageError + 7 个子类 |
| `src/errors/permission.ts` | **Create** | PermissionError + 2 个子类 |
| `src/errors/config.ts` | **Create** | ConfigError + 3 个子类 |
| `src/errors/agent.ts` | **Create** | AgentError + 3 个子类 |
| `src/errors/guards.ts` | **Create** | 类型守卫 + 辅助函数 |
| `src/errors/index.ts` | **Modify** | 导出所有新错误类 |
| `src/storage/sqlite-memory.ts` | **Modify** | 使用新错误类替换 `throw new Error()` |
| `src/storage/filesystem.ts` | **Modify** | 移除重复 NotFoundError，使用 errors 模块 |
| `src/index.ts` | **Modify** | 导出错误模块 |
| `tests/errors/errors.test.ts` | **Create** | 错误类测试 |

---

### 8. 测试用例设计

```typescript
// tests/errors/errors.test.ts

import { describe, it, expect } from 'vitest';
import {
  AppError,
  StorageError,
  StorageNotInitializedError,
  ThreadNotFoundError,
  CheckpointNotFoundError,
  AgentStateNotFoundError,
  DatabaseCorruptionError,
  PermissionDeniedError,
  ConfigNotFoundError,
  AgentMaxStepsError,
  isAppError,
  isStorageError,
  isRecoverable,
  getErrorChain,
} from '../src/errors/index.js';

describe('AppError', () => {
  it('should create basic error', () => {
    const err = new AppError('TEST_ERROR', 'Test message', 400);
    expect(err.code).toBe('TEST_ERROR');
    expect(err.message).toBe('Test message');
    expect(err.status).toBe(400);
    expect(err.recoverable).toBe(false);
  });

  it('should support options', () => {
    const cause = new Error('Original error');
    const err = new AppError('TEST_ERROR', 'Test', 500, {
      recoverable: true,
      cause,
      context: { foo: 'bar' },
    });
    expect(err.recoverable).toBe(true);
    expect(err.cause).toBe(cause);
    expect(err.context).toEqual({ foo: 'bar' });
  });

  it('should serialize to JSON', () => {
    const err = new AppError('TEST', 'Message', 500, {
      context: { key: 'value' },
    });
    const json = err.toJSON();
    expect(json.error.code).toBe('TEST');
    expect(json.error.message).toBe('Message');
    expect(json.error.context).toEqual({ key: 'value' });
    expect(json.error.timestamp).toBeDefined();
  });
});

describe('Storage Errors', () => {
  it('StorageNotInitializedError should be recoverable', () => {
    const err = new StorageNotInitializedError('getThread');
    expect(err.recoverable).toBe(true);
    expect(err.code).toBe('STORAGE_NOT_INITIALIZED');
  });

  it('ThreadNotFoundError should have 404 status', () => {
    const err = new ThreadNotFoundError('thread-123');
    expect(err.status).toBe(404);
    expect(err.context).toEqual({ threadId: 'thread-123' });
  });

  it('CheckpointNotFoundError should have correct context', () => {
    const err = new CheckpointNotFoundError('cp-456');
    expect(err.code).toBe('CHECKPOINT_NOT_FOUND');
    expect(err.context).toEqual({ checkpointId: 'cp-456' });
  });

  it('AgentStateNotFoundError should include session and agent', () => {
    const err = new AgentStateNotFoundError('session-1', 'agent-1');
    expect(err.context).toEqual({ sessionId: 'session-1', agentName: 'agent-1' });
  });

  it('DatabaseCorruptionError should not be recoverable', () => {
    const err = new DatabaseCorruptionError('getThread', 'Corrupted data');
    expect(err.recoverable).toBe(false);
  });
});

describe('Permission Errors', () => {
  it('PermissionDeniedError should have 403 status', () => {
    const err = new PermissionDeniedError('bash', 'rm -rf /', 'agent-1');
    expect(err.status).toBe(403);
    expect(err.context).toEqual({
      category: 'bash',
      input: 'rm -rf /',
      agentName: 'agent-1',
    });
  });
});

describe('Config Errors', () => {
  it('ConfigNotFoundError should have 404 status', () => {
    const err = new ConfigNotFoundError('/path/to/config.json');
    expect(err.status).toBe(404);
    expect(err.context).toEqual({ configPath: '/path/to/config.json' });
  });
});

describe('Agent Errors', () => {
  it('AgentMaxStepsError should not be recoverable', () => {
    const err = new AgentMaxStepsError(10, 11);
    expect(err.recoverable).toBe(false);
    expect(err.context).toEqual({ maxSteps: 10, currentStep: 11 });
  });

  it('AgentTimeoutError should be recoverable', () => {
    const err = new AgentTimeoutError(30000);
    expect(err.recoverable).toBe(true);
  });
});

describe('Type Guards', () => {
  it('isAppError should work', () => {
    const err = new AppError('TEST', 'message');
    expect(isAppError(err)).toBe(true);
    expect(isAppError(new Error('test'))).toBe(false);
  });

  it('isStorageError should work', () => {
    const err = new ThreadNotFoundError('t1');
    expect(isStorageError(err)).toBe(true);
  });

  it('isRecoverable should work', () => {
    const err1 = new AgentTimeoutError(1000);
    const err2 = new AgentMaxStepsError(10, 11);
    expect(isRecoverable(err1)).toBe(true);
    expect(isRecoverable(err2)).toBe(false);
  });
});

describe('getErrorChain', () => {
  it('should return error chain', () => {
    const cause1 = new Error('Cause 1');
    const cause2 = new Error('Cause 2');
    Object.assign(cause2, { cause: cause1 });
    
    const err = new AppError('TEST', 'Main error', 500, { cause: cause2 });
    const chain = getErrorChain(err);
    
    expect(chain).toHaveLength(3);
    expect(chain[0]).toBe(err);
    expect(chain[1]).toBe(cause2);
    expect(chain[2]).toBe(cause1);
  });
});
```

---

### 9. 实现步骤

```
Phase 1: 增强基类
├── [ ] src/errors/types.ts - AppError 增加 options 参数
├── [ ] src/errors/types.ts - 增加 recoverable, cause, context 属性
├── [ ] src/errors/types.ts - 增强 toJSON() 和 toString()
└── [ ] 验证: 编译通过

Phase 2: 创建错误子类
├── [ ] src/errors/storage.ts - StorageError 基类
├── [ ] src/errors/storage.ts - 7 个存储错误子类
├── [ ] src/errors/permission.ts - PermissionError + 2 个子类
├── [ ] src/errors/config.ts - ConfigError + 3 个子类
├── [ ] src/errors/agent.ts - AgentError + 3 个子类
└── [ ] 验证: 编译通过

Phase 3: 类型守卫
├── [ ] src/errors/guards.ts - 8 个类型守卫函数
├── [ ] src/errors/guards.ts - toAppError 辅助函数
├── [ ] src/errors/guards.ts - getErrorChain 辅助函数
└── [ ] 验证: 编译通过

Phase 4: 模块导出
├── [ ] src/errors/index.ts - 导出所有新错误类
├── [ ] src/index.ts - 顶层导出
└── [ ] 验证: 导出正确

Phase 5: 存储层改造
├── [ ] src/storage/sqlite-memory.ts - ensureInitialized 使用 StorageNotInitializedError
├── [ ] src/storage/sqlite-memory.ts - JSON.parse 使用 StorageParseError
├── [ ] src/storage/sqlite-memory.ts - 数据库操作使用 DatabaseWriteError
├── [ ] src/storage/filesystem.ts - 移除重复 NotFoundError
└── [ ] 验证: 编译通过

Phase 6: 测试
├── [ ] tests/errors/errors.test.ts - AppError 测试
├── [ ] tests/errors/errors.test.ts - 存储错误测试
├── [ ] tests/errors/errors.test.ts - 权限错误测试
├── [ ] tests/errors/errors.test.ts - 配置错误测试
├── [ ] tests/errors/errors.test.ts - Agent 错误测试
├── [ ] tests/errors/errors.test.ts - 类型守卫测试
└── [ ] 验证: 所有测试通过
```

---

### 10. 预期产出清单

- [ ] AppError 基类增强（recoverable, cause, context）
- [ ] StorageError 基类 + 7 个子类
- [ ] PermissionError 基类 + 2 个子类
- [ ] ConfigError 基类 + 3 个子类
- [ ] AgentError 基类 + 3 个子类
- [ ] 8 个类型守卫函数
- [ ] 2 个辅助函数（toAppError, getErrorChain）
- [ ] SQLiteMemoryStorage 改造
- [ ] filesystem.ts 移除重复定义
- [ ] 25+ 测试用例全部通过
- [ ] 类型导出正确

---

### 11. 向后兼容说明

**兼容性**:
- 现有 `AppError` 构造函数签名保持兼容（options 为可选参数）
- 所有现有错误类（NotFoundError, BadRequestError 等）保持不变
- 新增错误类不影响现有代码

**迁移路径**:
```typescript
// 旧代码（继续工作）
throw new AppError('TEST', 'message', 500);

// 新代码（推荐）
throw new AppError('TEST', 'message', 500, {
  recoverable: true,
  cause: originalError,
  context: { foo: 'bar' },
});
```

---

### P2 Task 4: 可观测性集成

**目标**: 集成 OpenTelemetry/Sentry 风格的 tracing

**预期产出**:
- `src/observability/tracing.ts` - Span 创建和管理
- Permission check spans
- Tool execution spans
- Storage operation spans

---

## P3 架构优化 (计划)

> **目标**: 统一架构，完善功能

| 项目 | 状态 | 优先级 |
|------|------|--------|
| **P3 Task 1: CheckpointManager 迁移** | 待开发 | 高 |
| **P3 Task 2: Session/Thread 术语统一** | 待开发 | 中 |
| **P3 Task 3: 配置格式数组化** | 待开发 | 低 |
| **P3 Task 4: 文档与示例完善** | 待开发 | 中 |

### P3 Task 1: CheckpointManager 迁移

**问题来源**: P1 审视问题 #4 - CheckpointManager 未迁移到 SQLite

**当前状态**:
- `CheckpointManager` 使用 JSON 文件存储
- `SQLiteMemoryStorage` 支持 Checkpoint 存储
- 两套系统并存

**设计方案**:

Option A: 适配器模式
```typescript
interface CheckpointStorage {
  get(id: string): Promise<Checkpoint | null>;
  save(checkpoint: Checkpoint): Promise<void>;
  list(sessionId: string): Promise<Checkpoint[]>;
  delete(id: string): Promise<boolean>;
}

// 实现
class JsonCheckpointStorage implements CheckpointStorage { ... }
class SqliteCheckpointStorage implements CheckpointStorage { ... }

// CheckpointManager 使用
class CheckpointManager {
  constructor(private storage: CheckpointStorage) { ... }
}
```

Option B: 直接迁移
```typescript
// CheckpointManager 内部使用 SQLiteMemoryStorage
class CheckpointManager {
  private storage: SQLiteMemoryStorage;
  constructor(dbPath?: string) {
    this.storage = new SQLiteMemoryStorage(dbPath);
  }
}
```

**预期产出**:
- `CheckpointStorage` 接口
- 两套实现 (JSON/SQLite)
- 迁移测试用例
- 向后兼容指南

---

### P3 Task 2: Session/Thread 术语统一

**问题来源**: P1 审视 - 命名不一致

**当前问题**:
- `Thread.id` (memory 模块)
- `AgentState.sessionId` (storage 模块)
- `Checkpoint.sessionId` (session 模块)

**设计方案**:
统一为 `threadId` 或明确区分用途：
- `Thread` = 对话线程 (用户可见)
- `Session` = 执行会话 (agent 运行时状态)

**预期产出**:
- 术语定义文档
- 类型别名或重命名
- 迁移指南

---

### P3 Task 3: 配置格式数组化

**问题来源**: P1 审视问题 #2 - JSON 对象顺序不确定

**当前问题**:
```json
{
  "permission": {
    "bash": { "*": "ask", "git *": "allow" }  // 顺序不确定
  }
}
```

**设计方案**:
```json
{
  "permission": {
    "bash": [
      { "pattern": "*", "action": "ask" },
      { "pattern": "git *", "action": "allow" }
    ]
  }
}
```

**预期产出**:
- 支持数组格式解析
- 向后兼容对象格式
- 文档说明推荐数组格式

---

### P3 Task 4: 文档与示例完善

**预期产出**:
- `docs/permission.md` - 权限系统使用指南
- `docs/lifecycle.md` - 中间件开发指南
- `docs/storage.md` - 存储层架构文档
- `examples/` - 完整使用示例

**设计参考**: OpenCode pattern-based permission system

**已完成内容**:
- `src/permission/types.ts` - 核心类型 (PermissionAction, PermissionRule, Ruleset, ToolPermissionCategory, PermissionCheckResult, PermissionConfig)
- `src/permission/manager.ts` - PermissionManager 类 + glob pattern 匹配 + session always-allowed + per-agent rules
- `src/permission/presets.ts` - 4 个预设 (default, strict, permissive, read-only)
- `src/permission/index.ts` - 模块导出
- `src/types.ts` - Tool 接口添加 `permission?: ToolPermissionCategory`
- `src/registry.ts` - setPermissionManager() + checkPermission() 集成
- `src/index.ts` - 导出 permission 模块
- 10 个内置工具添加 permission 声明 (bash, write, edit, read, glob, grep, find, ls, fetch, diffpatch)
- `tests/permission/permission.test.ts` - 29 个测试用例全部通过

**核心设计**:
1. Pattern-based rules (inspired by OpenCode) - `allow`/`deny`/`ask` 三态
2. Last-match-wins - 最后匹配的规则生效
3. Per-agent overrides - Agent 级规则覆盖全局
4. Session always-allowed - 用户选择"总是允许"后缓存
5. 工具自声明 category - Tool.permission 声明权限类别和输入提取

**配置格式** (兼容 opencode.json):
```json
{
  "permission": {
    "bash": { "*": "ask", "git *": "allow", "rm *": "deny" },
    "edit": { "*": "ask", "src/**": "allow" }
  }
}
```

**权限类别映射**:
| 工具 | Category | 提取输入 |
|------|----------|----------|
| bash | bash | command |
| write | edit | filePath |
| edit | edit | filePath |
| diffpatch | edit | filePath |
| read | read | filePath |
| glob | glob | pattern |
| grep | grep | pattern |
| find | find | path |
| ls | ls | directory |
| fetch | webfetch | url |

---

### P1 Task 2: 生命周期 Middleware ✅ 已完成

**设计参考**: Agentscope 洋葱模型 + LangChain ToolRetryMiddleware + OpenCode Plugin hooks

**已完成内容**:
- `src/lifecycle/types.ts` - 核心类型 (ToolLifecycleContext, ToolLifecycleResult, ToolLifecycleMiddleware, RetryConfig, ErrorMiddlewareConfig, TimingMetadata, RetryMetadata)
- `src/lifecycle/manager.ts` - ToolLifecycleManager 类 + 洋葱链构建 + 上下文传递
- `src/lifecycle/middlewares/logging.middleware.ts` - 日志中间件 (执行前后 + 错误日志)
- `src/lifecycle/middlewares/timing.middleware.ts` - 计时中间件 (duration + startTime)
- `src/lifecycle/middlewares/retry.middleware.ts` - 重试中间件 (指数退避 + retryIf 谓词)
- `src/lifecycle/middlewares/error.middleware.ts` - 错误处理中间件 (catch + transform)
- `src/lifecycle/middlewares/index.ts` - 中间件导出
- `src/lifecycle/index.ts` - 模块主导出
- `src/registry.ts` - setLifecycleManager() + execute() 集成
- `src/index.ts` - 导出 lifecycle 模块
- `tests/lifecycle/lifecycle.test.ts` - 22 个测试用例全部通过

**核心设计**:
1. 洋葱模型中间件链 - `(context, next) => Promise<ToolLifecycleResult>`
2. First-registered = outermost - 第一个注册的中间件包裹最外层
3. 可修改 args/result - 中间件可以修改工具参数和结果
4. 可跳过执行 - 中间件可以不调用 next() 直接返回
5. 可选集成 - 通过 `registry.setLifecycleManager()` 启用
6. 权限优先 - 权限检查在 lifecycle 之前执行

**中间件使用示例**:
```typescript
import { ToolLifecycleManager, loggingMiddleware, timingMiddleware, retryMiddleware, errorMiddleware } from 'agentforge'

const manager = new ToolLifecycleManager()
  .use(loggingMiddleware())
  .use(timingMiddleware())
  .use(retryMiddleware({ maxRetries: 2, initialDelay: 1000 }))
  .use(errorMiddleware({ includeStack: true }))

registry.setLifecycleManager(manager)
```

**自定义中间件**:
```typescript
const auditMiddleware: ToolLifecycleMiddleware = async (context, next) => {
  auditLog('before', context.tool.name, context.args)
  const result = await next()
  auditLog('after', context.tool.name, result.result.output.length)
  return result
}
manager.use(auditMiddleware)
```

---

## 工作目录信息

- **主仓库**: `C:\Users\90514\bug\agentforge`
- **GitNexus 已更新**: 1,673 nodes, 127 flows
- **计划文档**: `docs/superpowers/plans/2026-04-23-production-ready-p0-p3.md`

---

## 新会话启动指令

复制以下内容到新会话：

```
继续 AgentForge 生产可用增强计划。

当前状态：
**P0 全部完成：**
- Task 1 (Provider) ✅ 58ca8b8
- Task 2 (Tool.Context) ✅ 15fdf5a
- Task 3 (内置工具适配) ✅ 8b141bd
- Task 4 (Truncate) ✅ f3d976d
- Task 5 (测试验证) ✅ 1635c41

**P1 全部完成：**
- Task 1 (权限 Ruleset) ✅ b2f1ae1
- Task 2 (生命周期 Middleware) ✅ ee00904
- Task 3 (持久化存储扩展) ✅ 已完成

**P2 待开发：**
- Task 1: 安全默认策略 (高优先级)
- Task 2: 存储层外键约束 (中优先级)
- Task 3: 错误处理增强 (中优先级)
- Task 4: 可观测性集成 (低优先级)

**P3 待开发：**
- Task 1: CheckpointManager 迁移 (高优先级)
- Task 2: Session/Thread 术语统一 (中优先级)
- Task 3: 配置格式数组化 (低优先级)
- Task 4: 文档与示例完善 (中优先级)

下一步：
- 开始 P2 Task 1: 安全默认策略
- 参考 docs/superpowers/plans/2026-04-23-production-ready-p0-p3.md
```

---

## 附录：已安装依赖

```json
{
  "@ai-sdk/anthropic": "^3.0.71",
  "@ai-sdk/amazon-bedrock": "^4.0.96",
  "@ai-sdk/google-vertex": "^4.0.112",
  "@ai-sdk/openai": "^3.0.50",
  "@ai-sdk/openai-compatible": "^2.0.38",
  "@ai-sdk/provider": "^3.0.8"
}
```
