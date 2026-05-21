# Plan: 自研 Memory 系统

**Source PRD**: docs/competitor-analysis-2025-05.md (P0 Memory 差距)
**Complexity**: Medium → Large (Phase 3 可选)
**Status**: Reviewed by Momus ✅

## 一、竞品 Memory 特性对比

### 1. 架构模式对比

| 竞品 | 架构类型 | 核心创新 | 存储后端 |
|------|---------|---------|---------|
| **Mastra** | 三层 Memory | Observer + Reflector 后台 agent | LibSQL / PostgreSQL |
| **OpenHarness** | 文件系统 Memory | Layer 1/2/3 分层索引 | Markdown 文件 |
| **LangGraph** | Checkpointing | Super-step 快照 + Thread | SQLite / PostgreSQL |
| **CrewAI** | Unified Memory | Hierarchical Scopes + LLM 分析 | LanceDB |
| **Letta** | 虚拟内存 | Core/Archival/Recall 三层 | Vector Store |
| **神经科学启发** | 认知架构 | 离线整合 + 自适应遗忘 | Graph + Vector |

### 2. 功能特性矩阵

| 特性 | Mastra | OpenHarness | LangGraph | CrewAI | Letta |
|------|--------|-------------|-----------|--------|-------|
| Working Memory | ✅ | ❌ | ❌ | ✅ | ✅ Core |
| Semantic Recall | ✅ | ⚠️ SQLite | ❌ | ✅ | ✅ Archival |
| Episodic Memory | ❌ | ✅ logs/ | ✅ Thread | ✅ | ✅ Recall |
| Observational | ✅ Observer | ❌ | ❌ | ❌ | ❌ |
| Auto-Compact | ❌ | ✅ | ❌ | ❌ | ❌ |
| Hierarchical Scope | ❌ | ✅ | ❌ | ✅ | ❌ |
| Checkpointing | ❌ | ❌ | ✅ | ❌ | ❌ |
| LLM-Driven | ✅ | ❌ | ❌ | ✅ | ❌ |

### 3. 关键设计决策

**Mastra Observational Memory**:
```
Observer Agent → 提取 observations (token 阈值触发)
Reflector Agent → 压缩 observations (第二阈值触发)
Result: 3-6× 压缩率，context window 稳定可缓存
```

**CrewAI Unified Memory**:
```
remember() → LLM 分析 content → 推断 scope/categories/importance
recall()   → Composite Score = 0.5×semantic + 0.3×recency + 0.2×importance
Hierarchical Scopes → /crew/research/agent/researcher/findings
```

**OpenHarness Three-Layer Memory**:
```
Layer 1 (heartbeat.md) → < 2KB 索引，始终加载
Layer 2 (knowledge/*.md) → 按需加载，topic-specific
Layer 3 (logs/execution_stream.log) → 只 grep，不全文读取
```

**神经科学启发**:
```
Short-term (PFC) → Hot Cache (TTL: min-hrs)
Medium-term (Hippocampus) → Episodic Store (TTL: days-weeks)
Long-term (Neocortex) → Knowledge Graph (permanent)
Consolidation: 离线整合，dedup，merge
Forgetting: Ebbinghaus 曲线 + retrieval-induced interference
```

---

## 二、自研架构设计

### 设计原则

1. **Memory 是 Harness 属性**：不是可插拔模块，与 Pipeline 紧密耦合
2. **三层架构**：Working + Episodic + Semantic
3. **LLM-Driven**：自动分析、分类、压缩
4. **渐进式复杂度**：基础功能零依赖，高级功能可选

### 核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      MemorySystem                                │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  WorkingMemory  │ EpisodicMemory  │     SemanticMemory          │
│  (结构化状态)    │  (时间索引事件)  │     (知识图谱 + 向量检索)    │
│                 │                 │                             │
│  - userProfile  │  - events[]     │  - facts[]                  │
│  - taskState    │  - toolCalls[]  │  - entities[]               │
│  - preferences  │  - decisions[]  │  - relations[]              │
│                 │  - timestamps   │  - embeddings[]             │
├─────────────────┴─────────────────┴─────────────────────────────┤
│                     Memory Operations                            │
│  remember() | recall() | consolidate() | forget() | reflect()   │
├─────────────────────────────────────────────────────────────────┤
│                     Storage Backends                             │
│  InMemory | SQLite | PostgreSQL (with pgvector)                 │
└─────────────────────────────────────────────────────────────────┘
```

### 三层 Memory 定义

#### Layer 1: Working Memory (工作记忆)

```typescript
interface WorkingMemory {
  /** 用户画像 - 跨会话持久 */
  userProfile: {
    name?: string;
    preferences: Record<string, unknown>;
    goals: string[];
    constraints: string[];
  };

  /** 当前任务状态 - 会话级别 */
  taskState: {
    currentGoal: string;
    progress: number;
    blockers: string[];
    nextSteps: string[];
  };

  /** 上下文注入点 - 始终在 context 中 */
  injection: {
    template: string;  // Markdown 模板
    scope: 'thread' | 'resource';
  };
}
```

#### Layer 2: Episodic Memory (情景记忆)

```typescript
interface EpisodicMemory {
  /** 事件记录 - 时间索引 */
  events: Array<{
    id: string;
    timestamp: string;
    type: 'user_input' | 'agent_response' | 'tool_call' | 'decision';
    content: string;
    importance: number;  // 0-1
    metadata?: Record<string, unknown>;
  }>;

  /** 检索策略 */
  retrieval: {
    /** 时间范围过滤 */
    timeRange?: { start: string; end: string };
    /** 重要性阈值 */
    minImportance?: number;
    /** 类型过滤 */
    types?: string[];
  };
}
```

#### Layer 3: Semantic Memory (语义记忆)

```typescript
interface SemanticMemory {
  /** 事实知识 */
  facts: Array<{
    id: string;
    content: string;
    embedding?: number[];
    scope: string;  // e.g., "/project/alpha"
    categories: string[];
    importance: number;
    createdAt: string;
    lastAccessed: string;
    accessCount: number;
  }>;

  /** 实体关系 */
  entities: Array<{
    id: string;
    name: string;
    type: string;
    attributes: Record<string, unknown>;
  }>;

  relations: Array<{
    from: string;  // entity id
    to: string;
    type: string;
    weight: number;
  }>;
}
```

---

## 三、核心 Operations

### 1. remember() - 记忆存储

```typescript
async remember(
  content: string,
  options?: {
    scope?: string;           // 默认 LLM 推断
    categories?: string[];    // 默认 LLM 推断
    importance?: number;      // 默认 LLM 打分
    type?: 'fact' | 'event' | 'preference';
  }
): Promise<MemoryId>;
```

**流程**：
1. 如果未提供 scope/categories/importance，调用 LLM 分析
2. 生成 embedding（如果启用向量检索）
3. 检查是否与已有记忆重复（consolidation）
4. 存储到对应 layer

### 2. recall() - 记忆检索

```typescript
async recall(
  query: string | RecallQuery,
  options?: {
    mode: 'shallow' | 'deep';      // shallow=向量检索, deep=LLM分析
    topK?: number;
    scope?: string;
    timeRange?: { start: string; end: string };
  }
): Promise<MemoryEntry[]>;
```

**Composite Score**：
```
score = 0.5 × semantic_similarity +
        0.3 × recency_score +
        0.2 × importance_score
```

### 3. consolidate() - 离线整合

```typescript
async consolidate(options?: {
  scope?: string;
  dedupThreshold?: number;  // 相似度阈值
  mergeStrategy?: 'keep_latest' | 'merge' | 'llm_decide';
}): Promise<ConsolidationResult>;
```

**整合策略**：
- 去重：相似度 > threshold 的记忆合并
- 压缩：Episodic → Semantic 抽取
- 遗忘：低重要性 + 长时间未访问

### 4. reflect() - 反思压缩

```typescript
async reflect(options?: {
  trigger: 'token_threshold' | 'time_interval' | 'manual';
  threshold?: number;
}): Promise<ReflectionResult>;
```

**Mastra 模式**：
- Observer Agent: 提取 observations from raw messages
- Reflector Agent: 压缩 observations into reflections

---

## 四、与 AgentForge 集成

### Pipeline 集成点

| Stage | Memory Operation | 说明 |
|-------|------------------|------|
| `buildContext` | `recall()` + Working Memory 注入 | 加载相关记忆到 context |
| `invokeLLM` | - | - |
| `processStepOutput` | `remember()` | 存储 tool calls、decisions |
| `processOutput` | `remember()` | 存储对话 turn |
| `evaluateIteration` | `reflect()` (可选) | 触发压缩 |

### Processor 实现

```typescript
// packages/core/src/processors/memory-processor.ts

export function createMemoryRecallProcessor(
  memory: MemorySystem
): Processor {
  return {
    stage: 'buildContext',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const userInput = ctx.request.input;

      // 1. Recall 相关记忆
      const memories = await memory.recall(userInput, {
        mode: 'shallow',
        topK: 10,
        scope: ctx.request.sessionId,
      });

      // 2. 注入 Working Memory
      const workingMemory = await memory.getWorkingMemory(
        ctx.request.sessionId
      );

      // 3. 组装 context
      ctx.session.messageHistory = [
        ...memoriesToMessages(memories),
        ...(ctx.session.messageHistory ?? []),
      ];

      ctx.agent.promptFragments.push(
        formatWorkingMemory(workingMemory)
      );
    },
  };
}
```

---

## 五、存储后端设计

### Backend Interface

```typescript
interface MemoryStorage {
  // Working Memory
  getWorkingMemory(scope: string): Promise<WorkingMemory>;
  setWorkingMemory(scope: string, memory: WorkingMemory): Promise<void>;

  // Episodic Memory
  appendEvent(scope: string, event: MemoryEvent): Promise<void>;
  getEvents(scope: string, query: EventQuery): Promise<MemoryEvent[]>;

  // Semantic Memory
  upsertFact(scope: string, fact: Fact): Promise<void>;
  searchFacts(query: string, options: SearchOptions): Promise<Fact[]>;

  // Graph Operations
  upsertEntity(entity: Entity): Promise<void>;
  upsertRelation(relation: Relation): Promise<void>;
  traverse(startId: string, depth: number): Promise<GraphResult>;
}
```

### 后端实现优先级

| Backend | 优先级 | 用例 |
|---------|-------|------|
| InMemoryStore | P0 | 测试、开发 |
| SQLiteStore | P0 | 单机部署、轻量级 |
| PostgresStore | P1 | 生产环境、多实例 |
| LanceDBStore | P2 | 向量密集型 |

---

## 六、Files to Change

| File | Action | Why |
|------|--------|-----|
| `packages/sdk/src/index.ts` | UPDATE | 添加 Memory 类型定义 |
| `packages/core/src/memory/` | CREATE | Memory 核心实现目录 |
| `packages/core/src/memory/types.ts` | CREATE | Memory 类型定义 |
| `packages/core/src/memory/memory-system.ts` | CREATE | MemorySystem 核心类 |
| `packages/core/src/memory/working-memory.ts` | CREATE | Working Memory 实现 |
| `packages/core/src/memory/episodic-memory.ts` | CREATE | Episodic Memory 实现 |
| `packages/core/src/memory/semantic-memory.ts` | CREATE | Semantic Memory 实现 |
| `packages/core/src/memory/storage/` | CREATE | 存储后端目录 |
| `packages/core/src/memory/storage/in-memory.ts` | CREATE | 内存存储 |
| `packages/core/src/memory/storage/sqlite.ts` | CREATE | SQLite 存储 |
| `packages/plugins/src/memory/index.ts` | UPDATE | 集成新 Memory 系统 |

---

## 七、实现阶段

### Phase 1: 基础架构 (3-4 天)

- [ ] 定义 Memory 类型接口 (`types.ts`)
- [ ] 实现 `MemorySystem` 核心类
- [ ] 实现 `InMemoryStore` 后端
- [ ] 实现 Working Memory 基础功能
- [ ] 集成到 `buildContext` processor

### Phase 2: Episodic Memory (2-3 天)

- [ ] 实现 `EpisodicMemory` 事件存储
- [ ] 实现时间索引检索
- [ ] 实现 `remember()` / `recall()` 操作
- [ ] 实现 `SQLiteStore` 后端

### Phase 3: Semantic Memory (3-4 天)

- [ ] 实现 `SemanticMemory` 事实存储
- [ ] 实现向量 embedding 集成
- [ ] 实现 Composite Score 检索
- [ ] 实现 Hierarchical Scopes

### Phase 4: 高级功能 (2-3 天)

- [ ] 实现 `consolidate()` 整合
- [ ] 实现 `reflect()` 压缩（可选 LLM）
- [ ] 实现 Ebbinghaus 遗忘曲线
- [ ] 实现 `PostgresStore` 后端

### Phase 5: 测试与文档 (2 天)

- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试
- [ ] API 文档
- [ ] 使用示例

---

## 八、Validation

```bash
# 构建核心包
pnpm --filter @primo-ai/core build

# 运行测试
pnpm --filter @primo-ai/core test

# 类型检查
pnpm check-types

# 示例运行
cd examples && npx tsx memory-demo.ts
```

---

## 九、Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 向量检索性能 | Medium | 使用 HNSW 索引，限制 topK |
| Embedding 成本 | Medium | 支持本地模型，缓存 embedding |
| LLM 分析延迟 | High | 异步处理，可选禁用 |
| 存储膨胀 | Medium | 自动整合，遗忘策略 |
| 与现有 memory plugin 冲突 | Low | 作为增强版本，向后兼容 |

---

## 十、Acceptance

- [ ] Working Memory 可存储/检索用户画像
- [ ] Episodic Memory 支持时间索引事件
- [ ] Semantic Memory 支持向量检索
- [ ] `remember()` / `recall()` API 可用
- [ ] 集成到 Pipeline `buildContext` 阶段
- [ ] InMemory + SQLite 后端可用
- [ ] 单元测试覆盖率 > 80%
- [ ] 类型检查通过

---

## 十一、Estimated Timeline

| Phase | Duration | Total |
|-------|----------|-------|
| Phase 1: 基础架构 | 3-4 天 | 3-4 天 |
| Phase 2: Episodic | 2-3 天 | 5-7 天 |
| Phase 3: Semantic | 3-4 天 | 8-11 天 |
| Phase 4: 高级功能 | 2-3 天 | 10-14 天 |
| Phase 5: 测试文档 | 2 天 | 12-16 天 |

**总计: 12-16 天**（可并行开发缩减）

---

## 十二、设计取舍

| 决策 | 选择 | 放弃 | 理由 |
|------|------|------|------|
| 架构模式 | 三层 Memory | 单层 Vector Store | 符合认知科学，功能完整 |
| 触发机制 | Token 阈值 | 时间间隔 | 与 context window 管理一致 |
| 存储格式 | 结构化 + 向量 | 纯向量 | 支持复杂查询，降低 LLM 依赖 |
| Scope 设计 | Hierarchical | Flat | 支持多 Agent 隔离，CrewAI 验证 |
| 整合策略 | 离线 + LLM | 实时 | 降低延迟，Mastra 验证 |
