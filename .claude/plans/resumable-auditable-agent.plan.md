# Plan: Runner 模式实现

**Source PRD**: `.claude/prds/resumable-auditable-agent.prd.md`
**Selected Milestone**: #1 Runner 模式
**Complexity**: Medium

## Summary

将现有的简单 RunMode 枚举升级为完整的 Runner 模式，实现结构化并发控制，支持中断-恢复、持久化队列和崩溃恢复。参考 opencode 的 Runner 设计，适配 AgentForge 的 async/await 风格。

## Patterns to Mirror

| Category | Source | Pattern |
|----------|--------|---------|
| Naming | `loop-orchestrator.ts:31` | `RunMode` enum → `RunnerState` enum |
| State Machine | `state-machine.ts` | 状态转换验证 + 监听器模式 |
| Error Handling | `errors.ts` | 自定义 Error 类 + cause chain |
| Tests | `__tests__/state-machine.test.ts` | describe/it + expect 状态转换 |
| Persistence | `checkpoint-store.ts` | JSONL 文件存储模式 |

## Files to Change

| File | Action | Why |
|------|--------|-----|
| `packages/core/src/runner.ts` | CREATE | 新的 Runner 服务 |
| `packages/core/src/runner-state.ts` | CREATE | Runner 状态机 |
| `packages/core/src/task-queue/persistent-queue.ts` | CREATE | 持久化队列实现 |
| `packages/core/src/loop-orchestrator.ts` | UPDATE | 集成 Runner 模式 |
| `packages/core/src/index.ts` | UPDATE | 导出 Runner 相关类型 |
| `packages/core/__tests__/runner.test.ts` | CREATE | Runner 单元测试 |
| `packages/core/__tests__/persistent-queue.test.ts` | CREATE | 队列持久化测试 |
| `packages/sdk/src/index.ts` | UPDATE | 添加 Runner 相关类型定义 |
| `packages/core/src/task-queue/queue.ts` | UPDATE | 扩展现有队列为持久化队列 |

## Tasks

### Task 1: 定义 Runner 接口和状态机

- **Action**: 创建 `runner.ts` 和 `runner-state.ts`，定义 Runner 接口和状态机
- **Mirror**: 参考 `state-machine.ts` 的状态转换模式
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/runner.test.ts`

```typescript
// runner-state.ts
type RunnerState =
  | { _tag: 'Idle' }
  | { _tag: 'Running'; taskId: string; abortController: AbortController }
  | { _tag: 'Shell'; taskId: string; latch: Latch }
  | { _tag: 'ShellThenRun'; shellTask: TaskHandle; pendingTask: TaskHandle }

// runner.ts
interface Runner {
  readonly state: RunnerState
  readonly busy: boolean
  ensureRunning<T>(work: () => Promise<T>, options?: RunOptions): Promise<T>
  startShell<T>(work: () => Promise<T>, onReady?: () => void): Promise<T>
  cancel(): Promise<void>
  resume(taskId: string): Promise<void>
}
```

### Task 2: 实现持久化队列

- **Action**: 创建 `persistent-queue.ts`，支持崩溃恢复
- **Mirror**: 参考 `checkpoint-store.ts` 的 JSONL 存储模式
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/persistent-queue.test.ts`

```typescript
interface PersistentQueue {
  enqueue(task: QueuedTask): Promise<string>
  dequeue(): Promise<QueuedTask | undefined>
  complete(taskId: string): Promise<void>
  recoverPending(): Promise<QueuedTask[]>
}
```

### Task 3: 集成 Latch 原语

- **Action**: 实现 `Latch` 用于 Shell 模式的中断-恢复同步
- **Mirror**: 参考 opencode 的 `Latch` 实现
- **Validate**: 包含在 runner.test.ts 中

```typescript
class Latch {
  private released = false
  private waiters: Array<() => void> = []

  release(): void { ... }
  await(): Promise<void> { ... }
}
```

### Task 4: 集成到 LoopOrchestrator

- **Action**: 修改 `LoopOrchestrator` 使用新的 Runner 模式替代简单的 RunMode
- **Mirror**: 保持现有的 `runLoop`/`streamLoop` 接口不变
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/loop-orchestrator.test.ts`

### Task 5: 更新 SDK 类型定义

- **Action**: 在 `@primo-ai/sdk` 中添加 Runner 相关类型
- **Mirror**: 参考 `sdk/src/types.ts` 现有类型定义风格
- **Validate**: `pnpm check-types`

## Validation

```bash
# 类型检查
pnpm check-types

# 单元测试
pnpm --filter @primo-ai/core test

# 集成测试（Runner 集成后）
pnpm --filter @primo-ai/core vitest run __tests__/loop-orchestrator.test.ts
```

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 状态转换复杂度 | Medium | 参考 opencode 已验证的状态机设计 |
| 持久化写入性能 | Low | JSONL 追加写入，批量刷新 |
| 与现有代码冲突 | Low | 保持 LoopOrchestrator 接口不变 |

## Acceptance

- [x] Runner 接口和状态机实现完成 (commit: abaf3d2, 8eb26d0)
- [x] 持久化队列支持崩溃恢复 (commit: 69e9d13)
- [x] Latch 原语支持中断-恢复同步 (commit: abaf3d2)
- [x] LoopOrchestrator 集成完成 (commit: 70ff022)
- [x] 所有测试通过 (884 tests)
- [x] 类型检查通过

---
*Status: COMPLETE — Milestone #1 Runner 模式已实现*

## Open Questions (from PRD)

- [ ] 持久化队列存储后端选择？→ **建议：JSONL（简单可靠，与 CheckpointStore 一致）**
- [ ] Snapshot 性能要求？→ **在 Milestone #2 处理**

---
*Status: DRAFT — waiting for confirmation*
