# AgentForge P1/P2 缺口设计方案（草稿）

> 草稿文档，审视完毕后可删除
> 创建时间：2026-04-29
> 审视更新：2026-04-29 — 已合并审视反馈
> 一致性分析：2026-04-29 — 已合并 DI/Plugin/MemoryStore 一致性检查结果

---

## 总结（修正后）

| 缺口 | 诊断 | 方案 | 一致性 | 修正 |
|------|------|------|--------|------|
| P1-1 PromptBuilder | 正确 | `AgentContext.promptBuilder?` | ✅ DI 一致 | 实施时需改 `llm.ts` 的 `callLLMInner` |
| P1-2 LLMAdapterFactory | 正确 | 替换空壳 | ⚠️ DI 冲突 | **不需要修改** — `create-agent.ts` 已正确绕过 |
| P2-1 Memory 持久化 | 正确 | 修复 SemanticMemory | ⚠️ 接口冲突 | `PersistentMemoryStore` 不要 extends `MemoryStore` |
| P2-2 Summarization | 正确 | 百分比阈值 | ⚠️ Plugin 冲突 | Plugin 不依赖 CompactionManager，自行实现百分比阈值 |
| P2-3 Filesystem Backend | 正确 | `FilesystemBackend` 接口 | ⚠️ 位置冲突 | 放 `tools/filesystem.ts`，不放 `interfaces.ts` |
| ~~P2-4 Embedding Provider~~ | 与 P2-1 重叠 | 合并到 P2-1 Phase 1 | — | 无 |

**P1 两个缺口都是"接线"问题** — 实现已存在，只是没有正确接入。P2 的核心是修复 SemanticMemory 的 placeholder embedding。

---

## 一致性分析详情

### DI 系统一致性（bg_6997e559）

| 设计 | 一致性 | 具体问题 |
|------|--------|---------|
| P1-1 PromptBuilder | ✅ DI 一致 | `PromptBuilder` 接口已存在，加到 `AgentContext` 是可选依赖模式 |
| P1-2 LLMAdapterFactory | ⚠️ DI 冲突 | `createDefaultAppServices()` 是全局单例，但 DI 哲学是"构造函数注入" |
| P2-1 SemanticMemory async | ✅ 无冲突 | `SemanticMemory` 不是 `MemoryStore` 的实现，是独立系统 |
| P2-2 Summarization | ✅ 插件一致 | 扩展 config 是 additive 变更，不破坏 Plugin 接口 |
| P2-3 FilesystemBackend | ⚠️ 位置冲突 | `interfaces.ts` 是框架级 DI，不是工具特定后端 |

### Plugin 系统一致性（bg_773bebe2）

| 发现 | 影响 |
|------|------|
| SummarizationPlugin 不使用 CompactionManager | 直接调用 `truncateOldest()` from `strategies.ts` |
| CompactionManager 不在 PluginContext 中 | PluginContext 故意限制了对 memory/llm/tools/checkpoint 的访问 |
| 语义不匹配 | `tokenThreshold`（绝对值）vs `triggerThreshold`（百分比，0-1 范围） |
| Plugin 架构说 plugins 不应该访问 memory 相关服务 | CompactionManager 是 memory 相关服务 |

### MemoryStore 使用一致性（bg_b918750a）

| 发现 | 影响 |
|------|------|
| `ctx.memory` 在 agent loop 中完全没有被使用 | 消息存储在 `state.messages` 中，不通过 `MemoryStore` |
| `SemanticMemory` 当前没有被任何代码调用 | async 化不会破坏现有代码 |
| `PersistentMemory` 接口已经是 async 的 | `save(): Promise<boolean>`, `search(): Promise<MemoryEntry[]>` |
| `MemoryStore` 是同步的 | `add(): void`, `getAll(): Message[]` — 不同层级的接口 |

## P1-1: PromptBuilder 实现

### 现状

**接口已定义** (`interfaces.ts:667-689`)，**实现已存在** (`prompt-builder.ts`，291 行测试覆盖)，但 `agent-loop.ts` **完全不使用它**。

当前 `run()` 手动拼接消息：
```typescript
// agent-loop.ts:403-412 — 手动拼接，无模板、无工具指令、无 token 估算
const messages: Message[] = [];
if (config.systemPrompt) messages.push({ role: 'system', content: config.systemPrompt });
if (config.history) messages.push(...config.history);
messages.push({ role: 'user', content: input });
```

### 设计方案

**目标**：让 `agent-loop.ts` 使用 `PromptBuilder` 构建 prompt，而不是手动拼接。

**变更点**：

| 文件 | 变更 |
|------|------|
| `src/core/interfaces.ts` | ✅ 已有 `PromptBuilder` 接口 — 无需修改 |
| `src/core/prompt-builder.ts` | ✅ 已有 `DefaultPromptBuilder` — 无需修改 |
| `src/core/context.ts` | 将 `PromptBuilder` 加入 `AgentContext`（可选字段） |
| `src/loop/handlers/llm.ts` | `callLLMInner` 中用 `promptBuilder.build()` 替代直接传 `state.messages` |

**关键设计决策**：

1. **PromptBuilder 应该放在哪层？**
   - 选项 A：`ApplicationServices`（全局单例）— 模板是全局的
   - 选项 B：`AgentContext`（会话级）— 每个 Agent 可以有不同的 prompt 策略
   - **推荐 B**：不同 Agent 可能需要不同的 system prompt 模板

2. **何时调用 build()？**
   - 选项 A：`run()` 入口一次性构建 — 当前行为
   - 选项 B：每次 `callLLM()` 前构建 — 支持动态模板（如 token budget 压缩）
   - **推荐 B**：支持 token budget 和动态上下文注入

3. **向后兼容**：
   - 如果 `promptBuilder` 未注入，回退到当前手动拼接逻辑
   - `ContextBuilder` 提供 `withPromptBuilder()` 方法，不强制

**接口变更**：
```typescript
// AgentContext 新增（可选）
export interface AgentContext {
  // ... existing fields ...
  promptBuilder?: PromptBuilder;  // 可选，未注入则回退手动拼接
}

// AgentLoopConfig 新增（可选）
export interface AgentLoopConfig {
  // ... existing fields ...
  promptBuilder?: PromptBuilder;
}
```

**实现逻辑**（在 `src/loop/handlers/llm.ts` 的 `callLLMInner` 中）：

> **关键**：`promptBuilder.build()` 应在 `callLLMInner` 中调用，不是在 `run()` 中。
> `history` 参数应传入 `state.messages`（完整消息历史），不是 `config.history`（初始历史）。
> 这样 promptBuilder 才能基于完整上下文做 token budget 截断。

```typescript
// src/loop/handlers/llm.ts — callLLMInner() 中
function buildMessages(
  state: AgentState,
  config: AgentLoopConfig,
  ctx: AgentContext
): Message[] {
  if (ctx.promptBuilder) {
    // 传入 state.messages 作为 history，而非 config.history
    const result = ctx.promptBuilder.build(
      state.messages,  // ← 完整消息历史，支持 token budget 截断
      '',  // input 已在 state.messages 最后一条
      ctx.tools.list().map(name => ctx.tools.get(name)!),
      { systemTemplate: config.systemPrompt }
    );
    return result.messages;
  }
  // 回退：当前逻辑（直接传 state.messages）
  return state.messages;
}

// callLLMInner() 中
const messages = buildMessages(state, config, ctx);
return from(ctx.llm.chat(messages, llmOptions)).pipe(...)
```

---

## P1-2: LLMAdapterFactory 实现

### 现状

**接口已定义** (`interfaces.ts:160-179`)，**实现已存在** (`adapters/index.ts` 的 `LLMAdapterFactoryImpl`)，但：

1. `createDefaultAppServices()` 使用 **空壳 stub**（throw Error）
2. `create-agent.ts` **绕过** `ctx.services.llmFactory`，直接调用 `createLLMAdapter()`

### 一致性分析结果

**DI 哲学冲突**：`createDefaultAppServices()` 是全局单例工厂，但 AgentForge 的 DI 哲学是"构造函数注入"——依赖由外部传入，不由内部创建。

**当前代码已正确**：
```typescript
// create-agent.ts:762-768 — 直接调用 createLLMAdapter()，绕过 ApplicationServices.llmFactory
const llmAdapter = resolveLLMAdapterFromConfig(resolved);
builder = builder.withLLM(llmAdapter);
```

### 设计方案（修正）

**结论：不需要修改**。`create-agent.ts` 已经正确地直接调用 `createLLMAdapter()`（singleton），不需要通过 `ApplicationServices.llmFactory`。保持 `createDefaultAppServices()` 的空壳 stub 不变。

**`getLLMAdapterFactory()` 是 singleton**，`createDefaultAppServices()` 中调用它是安全的，但当前架构不需要这一步。

---

## P2-1: Memory 持久化

### 现状

- `MemoryStore` 接口只有会话级内存存储（InMemoryStore）
- `PersistentMemory` 接口存在但 `vectorSearch()` 未实现
- `SQLiteVectorStore` 存在但 `search()` 是 O(n) 全扫描
- `SemanticMemory` 的 `save()`/`search()` 使用 **空 placeholder embedding**

### 设计方案

**目标**：让 SemanticMemory 真正工作（调用 embed()），并提供会话级持久化。

**Phase 1: 修复 SemanticMemory（立即）**

| 文件 | 变更 |
|------|------|
| `src/memory/semantic-memory.ts` | `save()`/`search()` 改为 async，调用 `embeddingModel.embed()` |

**⚠️ 破坏性变更**：`save()` 从 `void` 改为 `Promise<void>`，`search()` 从同步改为 `Promise<MemoryEntry[]>`。需要检查所有调用方是否已使用 `await`。

```typescript
// 修复前（当前代码）
save(entry: MemoryEntry): void {
  const doc: VectorDocument = {
    embedding: [], // ⚠️ PLACEHOLDER
    // ...
  };
}

// 修复后
async save(entry: MemoryEntry): Promise<void> {
  const embedding = await this.embeddingModel.embed(entry.content);
  const doc: VectorDocument = {
    embedding, // ✅ 真实 embedding
    // ...
  };
  this.vectorStore.insert(doc);
}

async search(query: string, limit?: number, threshold?: number): Promise<MemoryEntry[]> {
  const queryEmbedding = await this.embeddingModel.embed(query);
  const results = this.vectorStore.search(queryEmbedding, limit, threshold);
  return results.map(/* ... */);
}
```

**Phase 2: 会话持久化（1-2 周）**

| 文件 | 变更 |
|------|------|
| `src/core/interfaces.ts` | 新增 `PersistentMemoryStore` 接口（**不要 extends MemoryStore**） |
| `src/memory/persistent-store.ts` | 新文件：实现 `PersistentMemoryStore` |

**⚠️ 接口层级冲突修正**：`MemoryStore` 是同步接口（`add(): void`），`PersistentMemoryStore` 如果是 async 就不应该 extends `MemoryStore`。它们是不同层级的接口。

```typescript
// 正确设计 — 不要 extends MemoryStore
export interface PersistentMemoryStore {
  /** 持久化当前会话消息 */
  persist(sessionId: string): Promise<void>;
  
  /** 从持久化存储恢复会话消息 */
  restore(sessionId: string): Promise<Message[]>;
}
```

**一致性分析发现**：
- `ctx.memory` 在 agent loop 中**完全没有被使用**——消息存储在 `state.messages` 中
- `SemanticMemory` 当前没有被任何代码调用
- `PersistentMemory` 接口**已经是 async 的**（`save(): Promise<boolean>`）
- `MemoryStore` 是同步的，用于 session 级内存存储

**Phase 3: SQLite 向量索引优化（2-4 周）**

当前 `SQLiteVectorStore.search()` 是 O(n) 全扫描。生产环境需要：

| 选项 | 适用场景 | 依赖 |
|------|---------|------|
| **SQLite + vector0 扩展** | < 10K 向量 | `sqlite-vss` npm 包 |
| **PostgreSQL + pgvector** | 生产环境 | PostgreSQL 服务器 |
| **外部向量 DB** | SaaS | Pinecone/Weaviate/Qdrant |

**推荐**：Phase 1 用当前 SQLite（开发够用），Phase 3 提供 pgvector 适配器。

---

## P2-2: Summarization 完整实现

### 现状

- `createSummarizationPlugin()` 存在，使用绝对 `tokenThreshold`
- `CompactionManager` 有百分比 `triggerThreshold: 0.8` 但未接入 plugin
- 三个策略存在（truncate-oldest, summarize, importance-weighted）但 plugin 只用 truncateOldest

### 设计方案

**目标**：支持百分比阈值（如 85%）自动触发压缩，集成 CompactionManager。

**⚠️ Plugin 与 CompactionManager 冲突修正**：

一致性分析发现：
1. 当前 `SummarizationPlugin` **不使用** `CompactionManager`——直接调用 `truncateOldest()` from `strategies.ts`
2. `CompactionManager` **不在** `PluginContext` 中——`PluginContext` 故意限制了对 memory/llm/tools/checkpoint 的访问
3. Plugin 架构说 plugins 不应该访问 memory 相关服务

**修正方案**：Plugin 不依赖 `CompactionManager`。Plugin 继续直接使用 `strategies.ts` 的函数，自行实现百分比阈值逻辑。

**变更点**：

| 文件 | 变更 |
|------|------|
| `src/plugins/summarization-plugin.ts` | 扩展 config 支持百分比阈值，自行实现逻辑 |
| `src/api/types.ts` | 更新 `SummarizationConfig` |

**接口变更**：
```typescript
// 扩展 SummarizationPluginConfig
export interface SummarizationPluginConfig {
  // 现有（向后兼容）
  tokenThreshold?: number;     // 绝对阈值
  preserveRecent: number;
  offloadDir?: string;
  
  // 新增
  triggerThreshold?: number;   // 百分比阈值（0.85 = 85%）
  maxTokens?: number;          // 模型最大 token 数（用于计算百分比）
  strategy?: 'truncate-oldest' | 'summarize' | 'importance-weighted';
}
```

**实现逻辑**（不依赖 CompactionManager）：
```typescript
// summarization-plugin.ts — intercept() 中
function shouldCompact(tokens: number, config: SummarizationPluginConfig): boolean {
  if (config.triggerThreshold && config.maxTokens) {
    // 百分比模式：85% of 128k = 108800 tokens
    return tokens > config.maxTokens * config.triggerThreshold;
  }
  
  if (config.tokenThreshold) {
    // 绝对值模式（向后兼容）
    return tokens > config.tokenThreshold;
  }
  
  return false;
}
```

---

## P2-3: Filesystem Backend

### 现状

- 6 个文件系统工具直接使用 `fs/promises`，无抽象层
- 无法替换为云存储（S3、Azure Blob）

### 设计方案

**目标**：创建 `FilesystemBackend` 接口，让文件系统工具可替换后端。

**⚠️ 接口位置冲突修正**：

一致性分析发现：`interfaces.ts` 定义的是**框架级 DI 接口**（LLMAdapter, ToolRegistry, MemoryStore 等），不是工具特定的后端。

**修正方案**：`FilesystemBackend` 放 `tools/filesystem.ts`，不放 `interfaces.ts`。因为它是工具实现细节，不是框架核心能力。

**变更点**：

| 文件 | 变更 |
|------|------|
| `src/tools/filesystem.ts` | 新增 `FilesystemBackend` 接口 + `LocalFilesystemBackend` 实现 |
| `src/core/interfaces.ts` | ❌ 不放这里 |

**接口设计**（在 `src/tools/filesystem.ts` 中）：
```typescript
export interface FilesystemBackend {
  /** 读取文件内容 */
  read(path: string): Promise<string>;
  
  /** 写入文件内容 */
  write(path: string, content: string): Promise<void>;
  
  /** 列出目录内容 */
  list(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  
  /** 获取文件信息 */
  stat(path: string): Promise<{ size: number; mtime: Date; isFile: boolean }>;
  
  /** 创建目录 */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  
  /** 删除文件/目录 */
  delete(path: string): Promise<void>;
}
```

**实现**（在 `src/tools/filesystem.ts` 中）：
```typescript
export class LocalFilesystemBackend implements FilesystemBackend {
  constructor(private rootDir: string) {}
  
  async read(path: string): Promise<string> {
    const safePath = resolveSafePath(this.rootDir, path);
    return readFile(safePath, 'utf-8');
  }
  
  async write(path: string, content: string): Promise<void> {
    const safePath = resolveSafePath(this.rootDir, path);
    await mkdir(dirname(safePath), { recursive: true });
    await writeFile(safePath, content, 'utf-8');
  }
  
  // ... 其他方法
}
```

**工具注入**：
```typescript
// src/tools/filesystem.ts
export function createFilesystemTools(config: FilesystemToolsConfig): ToolDefinition[] {
  const backend = config.backend ?? new LocalFilesystemBackend(config.rootDir);
  
  return [
    {
      name: 'read_file',
      execute: async (args) => backend.read(args.path as string),
    },
    // ... 其他工具
  ];
}
```

---

## ~~P2-4: Embedding Provider~~ → 已合并到 P2-1

> 与 P2-1 完全重叠，核心修复相同（修复 SemanticMemory 的 embedding 调用）
> 不再作为独立缺口，P2-1 Phase 1 已覆盖此需求

---

## 总结

| 缺口 | 优先级 | 复杂度 | 核心变更 |
|------|--------|--------|---------|
| **PromptBuilder** | P1 | 低 | 已有实现，只需接入 agent-loop |
| **LLMAdapterFactory** | P1 | 低 | 已有实现，只需替换 context.ts 空壳 |
| **Memory 持久化** | P2 | 中 | 修复 SemanticMemory + 新增 PersistentMemoryStore |
| **Summarization** | P2 | 中 | 扩展 config 支持百分比阈值 + 集成 CompactionManager |
| **Filesystem Backend** | P2 | 中 | 新增 FilesystemBackend 接口 + 重构工具 |
| **Embedding Provider** | P2 | 低 | 修复 SemanticMemory（与 Memory 持久化同） |

**P1 两个缺口都是"接线"问题** — 实现已存在，只是没有正确接入。P2 的核心是修复 SemanticMemory 的 placeholder embedding。
