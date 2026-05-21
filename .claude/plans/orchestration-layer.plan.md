# Plan: 编排抽象层 (P1-1)

**Source PRD**: docs/gap-analysis-server-sdk.md
**Selected Milestone**: P1-1 编排抽象层
**Complexity**: Large

## Summary

实现多 Agent 编排抽象层，支持 Sequential/Parallel/Conditional 三种基本编排模式。复用现有 `PipelineRunner`、`LoopOrchestrator` 和 `Agent` 架构，提供流畅的链式 API 体验。

## Requirements Restatement

- 支持多 Agent 协作系统
- 三种基本模式：Sequential（串行）、Parallel（并行）、Conditional（条件路由）
- 与现有 `Agent` 类无缝集成
- 支持结果聚合和错误处理
- 可观测性：事件追踪、Span 集成

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Naming | `core/loop-orchestrator.ts:65` | `LoopOrchestrator` 类命名，`runLoop`/`streamEvents` 方法 |
| Naming | `core/agent.ts:67` | `Agent` 类，`run`/`stream`/`streamEvents` 方法三元组 |
| Errors | `core/loop-orchestrator.ts:365` | `handleLoopError` 模式，`compatRetry` 统计 |
| Events | `core/loop-orchestrator.ts:383` | `eventBus.emit('compat:retry', {...})` 事件发射 |
| Tests | `__tests__/pipeline.test.ts` | Vitest + `describe/it/expect` 模式 |
| Types | `sdk/src/index.ts:821` | `SubAgentConfig` + `SubAgentResult` 类型定义风格 |
| Factory | `core/agent.ts:431` | `createAgent()` 工厂函数 |

## Architecture Design

### Core Concepts

```
编排抽象层架构:

┌─────────────────────────────────────────────────────────────┐
│  OrchestrationPipeline                                       │
│  - steps: OrchestrationStep[]                               │
│  - run(input) → OrchestrationResult                         │
│  - streamEvents(input) → AsyncGenerator<StreamEvent>        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  OrchestrationStep                                           │
│  - type: 'agent' | 'router' | 'parallel'                     │
│  - agent?: Agent | AgentConfig                              │
│  - router?: RouterFunction                                   │
│  - parallel?: Agent[]                                        │
│  - name: string                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  AgentRouter (条件路由)                                      │
│  - routes: Map<string, Agent>                               │
│  - default?: Agent                                          │
│  - route(context) → Agent                                   │
└─────────────────────────────────────────────────────────────┘
```

### Three Orchestration Modes

```typescript
// Mode 1: Sequential (串行)
const pipeline = new OrchestrationPipeline()
  .step('planner', plannerAgent)
  .step('executor', executorAgent)
  .step('reviewer', reviewerAgent);

// Mode 2: Parallel (并行)
const pipeline = new OrchestrationPipeline()
  .step('research', [
    researchAgent1,  // 并行执行
    researchAgent2,
    researchAgent3,
  ], { aggregator: mergeResearchResults });

// Mode 3: Conditional (条件路由)
const router = new AgentRouter({
  routes: {
    'code': codeAgent,
    'research': researchAgent,
    'general': generalAgent,
  },
  classifier: (input) => classifyTask(input),
});

const pipeline = new OrchestrationPipeline()
  .step('classify', router);
```

## Files to Change

| File | Action | Why |
|---|---|---|
| `packages/sdk/src/index.ts` | UPDATE | 添加编排相关类型定义 |
| `packages/core/src/orchestration/types.ts` | CREATE | 编排类型定义 |
| `packages/core/src/orchestration/pipeline.ts` | CREATE | `OrchestrationPipeline` 核心实现 |
| `packages/core/src/orchestration/router.ts` | CREATE | `AgentRouter` 条件路由 |
| `packages/core/src/orchestration/parallel-executor.ts` | CREATE | 并行执行器 |
| `packages/core/src/orchestration/aggregators.ts` | CREATE | 结果聚合器 |
| `packages/core/src/orchestration/index.ts` | CREATE | 模块导出 |
| `packages/core/src/index.ts` | UPDATE | 导出编排模块 |
| `packages/core/__tests__/orchestration.test.ts` | CREATE | 单元测试 |

## Tasks

### Task 1: Define Orchestration Types (SDK)

- **Action**: 在 `packages/sdk/src/index.ts` 添加类型定义
- **Mirror**: `SubAgentConfig` 类型定义风格 (`sdk/src/index.ts:821`)
- **Validate**: `pnpm --filter @primo-ai/sdk check-types`

```typescript
// 新增类型
export interface OrchestrationStepConfig {
  name: string;
  agent?: AgentConfig | Agent;
  agents?: Array<AgentConfig | Agent>;  // 并行模式
  router?: RouterConfig;
  options?: OrchestrationStepOptions;
}

export interface OrchestrationStepOptions {
  /** 并行模式下的结果聚合器 */
  aggregator?: AggregatorFunction;
  /** 失败策略: 'fail-fast' | 'continue' */
  failureStrategy?: 'fail-fast' | 'continue';
  /** 超时 (ms) */
  timeout?: number;
}

export interface RouterConfig {
  routes: Record<string, AgentConfig | Agent>;
  default?: AgentConfig | Agent;
  classifier: RouterClassifier;
}

export type RouterClassifier = (input: string, context: PipelineContext) => string | Promise<string>;
export type AggregatorFunction = (results: OrchestrationStepResult[]) => string | Promise<string>;

export interface OrchestrationStepResult {
  stepName: string;
  response: string;
  tokenUsage: TokenUsage;
  sessionId: string;
  error?: Error;
}

export interface OrchestrationResult {
  response: string;
  steps: OrchestrationStepResult[];
  totalTokenUsage: TokenUsage;
  sessionId: string;
}
```

### Task 2: Create OrchestrationPipeline Class

- **Action**: 实现 `OrchestrationPipeline` 核心类
- **Mirror**: `Agent` 类模式 (`agent.ts:67`) + `LoopOrchestrator` 循环模式 (`loop-orchestrator.ts:190`)
- **Validate**: `pnpm --filter @primo-ai/core build`

```typescript
// packages/core/src/orchestration/pipeline.ts
export class OrchestrationPipeline {
  private steps: OrchestrationStep[] = [];
  private eventBus?: EventBus;

  constructor(options?: { eventBus?: EventBus }) {
    this.eventBus = options?.eventBus;
  }

  /** Add a sequential step */
  step(name: string, agent: Agent | AgentConfig): this;

  /** Add a parallel step */
  step(name: string, agents: Array<Agent | AgentConfig>, options?: OrchestrationStepOptions): this;

  /** Add a router step */
  step(name: string, router: AgentRouter): this;

  /** Execute the pipeline */
  async run(input: string, options?: OrchestrationOptions): Promise<OrchestrationResult>;

  /** Stream events from the pipeline */
  async *streamEvents(input: string, options?: OrchestrationOptions): AsyncGenerator<StreamEvent>;
}
```

### Task 3: Implement AgentRouter

- **Action**: 实现条件路由器
- **Mirror**: 工厂模式 + 函数式设计
- **Validate**: 单元测试通过

```typescript
// packages/core/src/orchestration/router.ts
export class AgentRouter {
  private routes: Map<string, Agent>;
  private defaultAgent?: Agent;
  private classifier: RouterClassifier;

  constructor(config: RouterConfig) {
    this.classifier = config.classifier;
    // 初始化 routes...
  }

  async route(input: string, context: PipelineContext): Promise<Agent> {
    const routeKey = await this.classifier(input, context);
    return this.routes.get(routeKey) ?? this.defaultAgent!;
  }
}

// 便捷工厂函数
export function createRouter(
  routes: Record<string, Agent>,
  classifier: RouterClassifier,
): AgentRouter;
```

### Task 4: Implement ParallelExecutor

- **Action**: 实现并行执行器
- **Mirror**: `Promise.all` + 错误聚合模式
- **Validate**: 并行测试通过

```typescript
// packages/core/src/orchestration/parallel-executor.ts
export class ParallelExecutor {
  constructor(
    private agents: Agent[],
    private options?: OrchestrationStepOptions,
  ) {}

  async execute(input: string, signal?: AbortSignal): Promise<OrchestrationStepResult[]> {
    const promises = this.agents.map(agent =>
      agent.run(input, { signal }).catch(error => ({ error }))
    );

    if (this.options?.failureStrategy === 'fail-fast') {
      return Promise.all(promises);
    }

    // Continue on failure - collect all results
    const results = await Promise.allSettled(promises);
    return results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason });
  }
}
```

### Task 5: Implement Result Aggregators

- **Action**: 实现常用结果聚合器
- **Mirror**: 函数式设计
- **Validate**: 单元测试

```typescript
// packages/core/src/orchestration/aggregators.ts

/** 合并所有响应，用分隔符连接 */
export function concatenateAggregator(separator = '\n\n---\n\n'): AggregatorFunction {
  return (results) => results.map(r => r.response).join(separator);
}

/** 取第一个成功的结果 */
export function firstSuccessAggregator(): AggregatorFunction {
  return (results) => {
    const success = results.find(r => !r.error);
    return success?.response ?? results[0]?.response ?? '';
  };
}

/** 投票式聚合 - 取多数结果 */
export function votingAggregator(): AggregatorFunction {
  return (results) => {
    // 实现投票逻辑...
  };
}
```

### Task 6: Add Event Emission

- **Action**: 在关键节点发射事件
- **Mirror**: `eventBus.emit` 模式 (`loop-orchestrator.ts:383`)
- **Validate**: 事件测试通过

```typescript
// 事件类型
- 'orchestration:start' - 编排开始
- 'orchestration:step_start' - 步骤开始
- 'orchestration:step_complete' - 步骤完成
- 'orchestration:step_error' - 步骤错误
- 'orchestration:complete' - 编排完成
```

### Task 7: Write Unit Tests

- **Action**: 编写完整单元测试
- **Mirror**: `__tests__/pipeline.test.ts` 模式
- **Validate**: `pnpm --filter @primo-ai/core test`

```typescript
// packages/core/__tests__/orchestration.test.ts
describe('OrchestrationPipeline', () => {
  describe('sequential mode', () => {
    it('should execute agents in sequence', async () => {
      const pipeline = new OrchestrationPipeline()
        .step('a', mockAgentA)
        .step('b', mockAgentB);

      const result = await pipeline.run('test input');

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].response).toBe('response from A');
      expect(result.steps[1].response).toBe('response from B');
    });
  });

  describe('parallel mode', () => {
    it('should execute agents in parallel', async () => {
      // ...
    });
  });

  describe('conditional mode', () => {
    it('should route to correct agent', async () => {
      // ...
    });
  });
});
```

### Task 8: Update Exports

- **Action**: 更新模块导出
- **Mirror**: `core/src/index.ts` 导出模式
- **Validate**: `pnpm build`

## Validation

```bash
# 类型检查
pnpm check-types

# 单元测试
pnpm --filter @primo-ai/core test -- orchestration

# 构建验证
pnpm build

# 集成测试示例
cd examples && npx tsx orchestration-demo.ts
```

## Implementation Phases

### Phase 1: Foundation (Day 1-2)
- Task 1: 类型定义 (SDK)
- Task 2: OrchestrationPipeline 骨架
- Task 8: 导出更新

### Phase 2: Core Features (Day 3-4)
- Task 3: AgentRouter
- Task 4: ParallelExecutor
- Task 5: Aggregators

### Phase 3: Polish (Day 5)
- Task 6: Event Emission
- Task 7: Unit Tests
- Integration Example

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Agent 实例复用导致状态污染 | Medium | 每次执行创建新 Agent 或确保 reset() |
| 并行执行内存压力 | Low | 限制最大并行数，提供 `maxConcurrency` 选项 |
| 路由分类器失败 | Medium | 提供 `default` 路由，错误时 fallback |
| 事件风暴 | Low | 事件节流，提供 `emitLevel` 配置 |
| 与现有 Hook 系统冲突 | Low | 编排层使用独立 Hook namespace: `orchestration:*` |

## Dependencies

- 现有 `Agent` 类 (无需修改)
- 现有 `EventBus` (无需修改)
- 现有 `PipelineRunner` (无需修改)
- 新增 `AbortSignal` 传播机制

## Acceptance

- [ ] 所有 Tasks 完成
- [ ] 类型检查通过
- [ ] 单元测试覆盖率 > 80%
- [ ] Sequential/Parallel/Conditional 三种模式均可用
- [ ] 事件正确发射
- [ ] 示例代码可运行
- [ ] 文档更新 (可选)
