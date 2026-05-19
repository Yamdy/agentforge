# Processor API 激进重构计划

**创建时间**: 2026-05-19
**状态**: ✅ 已完成
**完成时间**: 2026-05-19
**破坏性变更**: 是（无向后兼容）

## 1. 重构目标

移除 v1/v2 API 双轨制，一步到位采用 **ProcessorContext API**：

```typescript
// 新 API（唯一）
interface Processor {
  stage: StageName;
  execute(context: ProcessorContext): Promise<PipelineContext | void>;
  isNoOp?: boolean;
}

interface ProcessorContext {
  state: PipelineContext;      // 可变上下文
  control: ProcessorControl;   // 流程控制 API
}

interface ProcessorControl {
  abort(reason: string, retryFrom?: StageName): never;
  suspend(suspensionId: string, checkpoint?: Partial<PipelineCheckpoint>): never;
}
```

**优势**：
- 更简洁的 API（单一路径）
- 直接访问可变状态，无需返回值
- 流程控制通过异常机制，代码更清晰
- 与 OpenCode 风格扩展一致

## 2. 需要修改的文件

### 2.1 SDK 类型定义

**文件**: `packages/sdk/src/index.ts`

**变更**:
```typescript
// 删除
export type ProcessorResult = PipelineContext | AbortSignal | SuspensionSignal | ErrorResult;

// 修改 Processor 接口
export interface Processor {
  stage: StageName;
  execute(context: ProcessorContext): Promise<PipelineContext | void>;
  isNoOp?: boolean;
}

// 保留（作为事件数据结构，不作为返回值）
export interface AbortSignal { ... }
export interface SuspensionSignal { ... }
export interface ErrorResult { ... }
```

### 2.2 Core Pipeline

**文件**: `packages/core/src/pipeline.ts`

**变更** (executeStage 方法):
```typescript
private async executeStage(
  ctx: PipelineContext,
  stage: StageName,
  stageSpan: Span,
): Promise<PipelineContext | AbortSignal | SuspensionSignal | ErrorResult> {
  // ... hook 调用 ...

  for (const processor of stageProcessors) {
    const processorCtx = new ProcessorContextImpl(ctxWithSpan);

    try {
      const result = await processor.execute(processorCtx);
      // 结果可以是 void（原地修改）或 PipelineContext
      currentCtx = result ? deepFreeze({ ...result }) : deepFreeze({ ...processorCtx.state });
    } catch (error) {
      if (error instanceof AbortControlFlow) {
        return { type: 'abort', reason: error.reason, retryFrom: error.retryFrom };
      }
      if (error instanceof SuspendControlFlow) {
        return { type: 'suspend', suspensionId: error.suspensionId, ... };
      }
      throw error;
    }
  }

  // ... hook 调用 ...
  return currentCtx;
}
```

### 2.3 内置处理器 (packages/core/src/processors/)

| 文件 | 当前 API | 需要变更 |
|------|----------|----------|
| `process-input.ts` | execute → ctx | 重命名 execute，参数改为 ProcessorContext |
| `build-context.ts` | execute → ctx | 同上 |
| `prepare-step.ts` | execute → ctx | 同上 |
| `invoke-llm.ts` | execute → ctx | 同上 |
| `process-step-output.ts` | isNoOp | 无需变更 |
| `gate-tool.ts` | execute → ctx | 同上 |
| `execute-tools.ts` | execute → ctx | 同上 |
| `evaluate-iteration.ts` | execute → ctx | 同上 |
| `process-output.ts` | isNoOp | 无需变更 |
| `provider-history-compat.ts` | execute → ctx | 同上 |

**模板**:
```typescript
// 旧
async execute(ctx: PipelineContext): Promise<PipelineContext> {
  // 直接返回修改后的 ctx
  return { ...ctx, ... };
}

// 新
async execute(ctx: ProcessorContext): Promise<PipelineContext | void> {
  // 直接修改 ctx.state
  ctx.state.session.messageHistory = [...];
  // 无需返回（void）
}
```

### 2.4 适配器 (packages/core/src/adapters/)

**文件**: `modifiers.ts`, `gates.ts`

**变更**: 将 `executeV2` 重命名为 `execute`

```typescript
// modifiers.ts
export function message(fn: MessageModifier): Processor {
  return {
    stage: 'invokeLLM',
    async execute(ctx: ProcessorContext) {  // 原为 executeV2
      const msgs = ctx.state.session.messageHistory ?? [];
      ctx.state.session.messageHistory = await fn(msgs, ctx.state);
    },
  };
}

// gates.ts
export function permission(config: PermissionGateConfig): Processor {
  return {
    stage: 'gateTool',
    async execute(ctx: ProcessorContext) {  // 原为 executeV2
      const toolCalls = ctx.state.iteration.pendingToolCalls ?? [];
      for (const tc of toolCalls) {
        const decision = config.check(tc.name, tc.args, ctx.state);
        if (decision === 'deny') {
          ctx.control.abort(config.onDeny?.(tc.name) ?? `Tool '${tc.name}' denied`);
        }
        // ...
      }
    },
  };
}
```

### 2.5 插件 (packages/plugins/src/)

所有插件中的 processor 需要更新：

| 插件 | 文件 | 变更 |
|------|------|------|
| compression | `compression-plugin.ts` | execute → ProcessorContext |
| memory | `memory-plugin.ts` | 同上 |
| permission | `permission-plugin.ts` | 同上 |
| skill | `skill-plugin.ts` | 同上 |
| mcp | `mcp-plugin.ts` | 同上 |
| eviction | `eviction-plugin.ts` | 同上 |

### 2.6 测试文件

**packages/core/__tests__/**:
- `adapters.test.ts` - 更新 mock control 实现
- `processor-context.test.ts` - 无需变更（测试 ProcessorContext 本身）
- `pipeline.test.ts` - 更新 processor mock

**packages/plugins/__tests__/**:
- 所有插件测试需要更新

### 2.7 文档

| 文件 | 变更 |
|------|------|
| `packages/core/README.md` | 移除 v1/v2 对比，只保留新 API |
| `docs/api-reference.md` | 同上 |
| `docs/plugins.md` | 同上 |

## 3. 执行顺序

1. **SDK 层** - 修改类型定义
2. **Core 层** - 更新 PipelineRunner 和内置处理器
3. **Adapters** - 更新 modifiers/gates
4. **Plugins** - 更新所有插件
5. **Tests** - 运行测试确保通过
6. **Docs** - 更新文档

## 4. 验证命令

```bash
# 类型检查
pnpm check-types

# 运行所有测试
pnpm test

# 单独运行 core 测试
pnpm --filter @primo-ai/core test

# 构建
pnpm build
```

## 5. 风险

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 外部插件不兼容 | 高 | 这是一个破坏性变更，需要发布 major 版本 |
| 遗漏文件 | 中 | 使用 grep 搜索 `executeV2` 和 `ProcessorResult` 确认覆盖完整 |
| 测试失败 | 中 | 分步骤提交，每步验证 |

## 6. 搜索命令

```bash
# 查找所有 executeV2 引用
grep -r "executeV2" packages/ --include="*.ts"

# 查找所有 ProcessorResult 引用
grep -r "ProcessorResult" packages/ --include="*.ts"

# 查找所有 processor.execute 调用
grep -r "processor.execute" packages/ --include="*.ts"
```

## 7. 代码片段参考

### ProcessorContext 实现 (已有)

```typescript
// packages/core/src/processor-context.ts
export class ProcessorContextImpl implements IProcessorContext {
  constructor(public state: PipelineContext) {}
  get control(): ProcessorControl {
    return {
      abort: (reason: string, retryFrom?: StageName): never => {
        throw new AbortControlFlow(reason, retryFrom);
      },
      suspend: (suspensionId: string, checkpoint?: Partial<PipelineCheckpoint>): never => {
        throw new SuspendControlFlow(suspensionId, checkpoint);
      },
    };
  }
}
```

### Control Flow Errors (已有)

```typescript
// packages/core/src/control-flow.ts
export class AbortControlFlow extends Error {
  constructor(
    public readonly reason: string,
    public readonly retryFrom?: StageName,
  ) {
    super(`Abort: ${reason}`);
    this.name = 'AbortControlFlow';
  }
}

export class SuspendControlFlow extends Error {
  constructor(
    public readonly suspensionId: string,
    public readonly checkpoint?: Partial<PipelineCheckpoint>,
  ) {
    super(`Suspend: ${suspensionId}`);
    this.name = 'SuspendControlFlow';
  }
}
```

## 8. 下次会话启动指令

```
执行 Processor API 激进重构计划，参考 .claude/plans/processor-api-radical-refactor.md
```
