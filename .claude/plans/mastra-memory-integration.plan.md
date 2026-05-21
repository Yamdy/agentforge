# Plan: Mastra Memory 集成

**Source PRD**: docs/competitor-analysis-2025-05.md (P0 Memory 差距)
**Selected Milestone**: Memory 架构升级
**Complexity**: Medium

## Summary

将 Mastra Memory (`@mastra/memory`) 集成到 AgentForge，填补竞品分析中识别的 Memory 系统缺口（Working Memory + Semantic Recall + Observational Memory）。采用扩展现有 `@primo-ai/plugins` memory 模块的方案，添加 Mastra 适配器。

## 竞品差距映射

| 竞品分析缺口 | Mastra Memory 对应 | 实现方式 |
|-------------|-------------------|---------|
| Working Memory | `workingMemory` option | `MastraMemoryBackend` 适配器 |
| Semantic Recall | `semanticRecall` option | 向量检索注入 messageHistory |
| Observational Memory | `observationalMemory` option | 后台压缩处理器 |

## Patterns to Mirror

| Category | Source | Pattern |
|----------|--------|---------|
| Plugin Factory | `packages/plugins/src/memory/index.ts:27` | `(api: HarnessAPI) => PluginRegistration` 工厂函数 |
| Processor | `packages/plugins/src/memory/memory-processor.ts:29` | `createMemoryProcessor()` 返回 `{ stage, execute }` |
| Backend Interface | `packages/plugins/src/memory/backend.ts` | `MemoryBackend` 接口定义存储/检索 API |
| Test Structure | `packages/plugins/__tests__/memory-processor.test.ts` | Vitest + `makeContext()` fixture |
| Dependency | `packages/plugins/package.json` | workspace:* + 外部依赖 |

## Files to Change

| File | Action | Why |
|------|--------|-----|
| `packages/plugins/package.json` | UPDATE | 添加 `@mastra/memory`, `@mastra/libsql` 依赖 |
| `packages/plugins/src/memory/mastra-backend.ts` | CREATE | Mastra Memory 适配器实现 |
| `packages/plugins/src/memory/mastra-processor.ts` | CREATE | Observational Memory 后台压缩处理器 |
| `packages/plugins/src/memory/index.ts` | UPDATE | 导出新的 Mastra 相关类型和工厂函数 |
| `packages/plugins/__tests__/mastra-backend.test.ts` | CREATE | Mastra 适配器单元测试 |
| `packages/plugins/__tests__/mastra-processor.test.ts` | CREATE | Observational 处理器测试 |

## Tasks

### Task 1: 添加 Mastra Memory 依赖

- **Action**: 在 `packages/plugins/package.json` 添加依赖
- **Mirror**: 现有 `better-sqlite3` 依赖模式
- **Validate**: `pnpm install && pnpm --filter @primo-ai/plugins build`

```json
{
  "dependencies": {
    "@mastra/memory": "^1.8.0",
    "@mastra/libsql": "^0.0.1"
  }
}
```

### Task 2: 实现 MastraMemoryBackend 适配器

- **Action**: 创建 `packages/plugins/src/memory/mastra-backend.ts`
- **Mirror**: `packages/plugins/src/memory/backend.ts` 接口
- **Validate**: `pnpm --filter @primo-ai/plugins test mastra-backend`

```typescript
// 核心接口
export interface MastraMemoryConfig {
  storage: 'libsql' | 'postgres' | 'memory';
  dbPath?: string;
  embedder?: EmbedderConfig;
  options: {
    workingMemory?: WorkingMemoryConfig;
    semanticRecall?: SemanticRecallConfig;
    observationalMemory?: boolean;
  };
}

export class MastraMemoryBackend implements MemoryBackend {
  private memory: Memory;
  private config: MastraMemoryConfig;

  constructor(config: MastraMemoryConfig) { ... }

  // 实现 MemoryBackend 接口
  async store(sessionId: string, entry: MemoryEntry): Promise<void>;
  async retrieve(sessionId: string, query?: RetrieveQuery): Promise<MemoryEntry[]>;
  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>;
  async deleteEntries(sessionId: string, predicate: Predicate): Promise<number>;

  // Mastra 特有方法
  async getWorkingMemory(sessionId: string, userId: string): Promise<WorkingMemory>;
  async updateWorkingMemory(sessionId: string, userId: string, memory: string): Promise<void>;
  async semanticRecall(query: string, userId: string, topK?: number): Promise<MemoryEntry[]>;
}
```

### Task 3: 实现 Observational Memory 处理器

- **Action**: 创建 `packages/plugins/src/memory/mastra-processor.ts`
- **Mirror**: `packages/plugins/src/memory/memory-processor.ts` 模式
- **Validate**: `pnpm --filter @primo-ai/plugins test mastra-processor`

```typescript
// Observational Memory 后台压缩
export function createObservationalProcessor(config: ObservationalConfig): Processor {
  return {
    stage: 'evaluateIteration',
    execute: async (pCtx: ProcessorContext) => {
      // 1. 检查是否需要压缩历史
      // 2. 调用 Mastra observational memory 压缩
      // 3. 更新 session.messageHistory 为压缩后的观察
    }
  };
}

// Working Memory 注入
export function createWorkingMemoryProcessor(config: WorkingMemoryConfig): Processor {
  return {
    stage: 'buildContext',
    execute: async (pCtx: ProcessorContext) => {
      // 1. 从 Mastra 获取 working memory
      // 2. 注入到 promptFragments
    }
  };
}
```

### Task 4: 更新 memory 插件导出

- **Action**: 更新 `packages/plugins/src/memory/index.ts`
- **Mirror**: 现有导出模式
- **Validate**: `pnpm --filter @primo-ai/plugins build`

```typescript
// 新增导出
export {
  MastraMemoryBackend,
  type MastraMemoryConfig,
  type WorkingMemoryConfig,
  type SemanticRecallConfig,
} from './mastra-backend.js';

export {
  createObservationalProcessor,
  createWorkingMemoryProcessor,
  mastraMemoryPlugin,
  type MastraPluginOptions,
} from './mastra-processor.js';
```

### Task 5: 编写单元测试

- **Action**: 创建测试文件
- **Mirror**: `packages/plugins/__tests__/memory-processor.test.ts`
- **Validate**: `pnpm --filter @primo-ai/plugins test`

```typescript
// mastra-backend.test.ts
describe('MastraMemoryBackend', () => {
  it('stores and retrieves entries', async () => { ... });
  it('supports semantic recall', async () => { ... });
  it('manages working memory', async () => { ... });
});

// mastra-processor.test.ts
describe('ObservationalProcessor', () => {
  it('compresses history when threshold exceeded', async () => { ... });
});

describe('WorkingMemoryProcessor', () => {
  it('injects working memory into promptFragments', async () => { ... });
});
```

### Task 6: 集成测试

- **Action**: 创建端到端集成测试
- **Mirror**: 现有集成测试模式
- **Validate**: `pnpm test`

```typescript
// examples/mastra-memory-demo.ts
import { Agent } from '@primo-ai/core';
import { mastraMemoryPlugin } from '@primo-ai/plugins';

const agent = new Agent({
  config: { model: 'openai/gpt-4' },
  plugins: [
    mastraMemoryPlugin({
      storage: 'libsql',
      dbPath: './data/memory.db',
      options: {
        workingMemory: { enabled: true },
        semanticRecall: { topK: 5 },
        observationalMemory: true,
      },
    }),
  ],
});

// 测试对话记忆
const result1 = await agent.run('My name is Alice');
const result2 = await agent.run('What is my name?');
// expect result2 to contain 'Alice'
```

## Validation

```bash
# 安装依赖
pnpm install

# 构建插件包
pnpm --filter @primo-ai/plugins build

# 运行测试
pnpm --filter @primo-ai/plugins test

# 类型检查
pnpm --filter @primo-ai/plugins check-types

# 运行示例
cd examples && npx tsx mastra-memory-demo.ts
```

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mastra Memory API 变更 | Medium | 锁定版本，定期更新 |
| LibSQL 兼容性问题 | Low | 测试 Windows/macOS/Linux |
| Embedding 依赖额外配置 | Medium | 支持多种 embedder，提供默认配置 |
| 向量索引性能 | Low | Mastra 使用 HNSW，性能已优化 |
| 与现有 memory plugin 冲突 | Low | 作为独立 backend，可共存 |

## Acceptance

- [ ] `MastraMemoryBackend` 实现完整
- [ ] `mastraMemoryPlugin` 工厂函数可用
- [ ] Working Memory 注入到 promptFragments
- [ ] Semantic Recall 通过向量检索工作
- [ ] Observational Memory 压缩历史消息
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成示例运行成功
- [ ] 类型检查通过
- [ ] 文档更新（CLAUDE.md 或 README）

## Estimated Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| Phase 1: 依赖 + 接口设计 | 2h | Task 1, 2 |
| Phase 2: 处理器实现 | 3h | Task 3 |
| Phase 3: 测试 + 集成 | 3h | Task 5, 6 |
| **Total** | **8h** | |

## Alternatives Considered

1. **PowerMem-TS**: 纯 TS，但社区较小，缺乏 Observational Memory
2. **自建三层 Memory**: 工作量大，需要实现向量索引、压缩策略等
3. **memU Cloud**: 需要 Python 后端，不符合要求

**选择 Mastra Memory 的原因**：
- Apache 2.0 许可证兼容
- 纯 TypeScript，无需 Python 依赖
- 三层 Memory 架构完整
- 社区活跃（195K+ 周下载）
- 支持多种存储后端
