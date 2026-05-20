# Plan: Milestone #3 集成与测试

**Source PRD**: `.claude/prds/resumable-auditable-agent.prd.md`
**Selected Milestone**: #3 集成与测试
**Complexity**: Medium

## Summary

将 SnapshotService 与现有 CheckpointStore、SessionStorage、LoopOrchestrator 集成，实现端到端的可恢复、可审计 Agent 运行能力。核心设计：会话与快照关联，暂停时自动创建快照，恢复时检测文件变更。

## Patterns to Mirror

| Category | Source | Pattern |
|----------|--------|---------|
| Naming | `checkpoint-store.ts:9,29` | `InMemory*` + `Jsonl*` dual implementation |
| Error Handling | `errors.ts:9-23` | `AgentForgeError` base class with `code` + `recoverable` |
| Persistence | `checkpoint-store.ts:42-48` | JSONL file storage with atomic rename |
| Integration | `loop-orchestrator.ts:139,143` | Optional params: `checkpointStore?:`, `eventBus?:` |
| Tests | `snapshot-service.test.ts:13-26` | `mkdtemp` + `beforeEach/afterEach` cleanup |
| Events | `session-storage.ts:14-19` | Append JSONL event for audit trail |

## Integration Design

### 1. CheckpointStore + SnapshotService 关联

```
PipelineContext (checkpoint)
  └── metadata.snapshotId?: string  ← 新增字段
```

在 checkpoint 中记录 snapshotId，形成会话-快照追踪链。

### 2. SessionStorage 事件扩展

新增事件类型：
- `snapshot:track` - 开始追踪
- `snapshot:patch` - 检测变更
- `snapshot:revert` - 回滚变更

### 3. LoopOrchestrator 集成点

```
LoopOrchestrator
  ├── checkpointStore: CheckpointStore
  ├── snapshotService?: SnapshotService  ← 新增可选依赖
  └── 暂停时: saveCheckpoint() + track()
  └── 恢复时: loadCheckpoint() + patch()
```

## Files to Change

| File | Action | Why |
|------|--------|-----|
| `packages/sdk/src/index.ts` | UPDATE | 添加 `SnapshotSessionEvent` 类型 |
| `packages/core/src/loop-orchestrator.ts` | UPDATE | 添加 SnapshotService 集成 |
| `packages/core/src/serialize.ts` | UPDATE | 支持序列化 snapshotId |
| `packages/core/src/session-manager.ts` | UPDATE | 添加快照事件处理 |
| `packages/core/__tests__/loop-orchestrator-snapshot.test.ts` | CREATE | 集成测试 |
| `packages/core/__tests__/session-snapshot.test.ts` | CREATE | 会话-快照关联测试 |

## Tasks

### Task 1: 扩展 SDK 类型定义

- **Action**: 添加快照相关事件类型
- **Mirror**: 参考 `sdk/src/index.ts` 现有 `SessionEvent` 定义
- **Validate**: `pnpm check-types`

```typescript
// 新增事件类型
export interface SnapshotTrackEvent {
  type: 'snapshot:track';
  payload: { snapshotId: string; patterns: string[]; fileCount: number };
}

export interface SnapshotPatchEvent {
  type: 'snapshot:patch';
  payload: { snapshotId: string; patches: FilePatch[] };
}

export interface SnapshotRevertEvent {
  type: 'snapshot:revert';
  payload: { snapshotId: string; revertedCount: number };
}

// 扩展 SessionEvent
export type SessionEvent =
  | ExistingSessionEventTypes
  | SnapshotTrackEvent
  | SnapshotPatchEvent
  | SnapshotRevertEvent;

// CheckpointContext 扩展
export interface CheckpointContext {
  pipelineContext: SerializedPipelineContext;
  snapshotId?: string;  // 关联的快照ID
}
```

### Task 2: LoopOrchestrator 集成 SnapshotService

- **Action**: 添加可选的 SnapshotService 依赖，在暂停/恢复时调用
- **Mirror**: 参考 `loop-orchestrator.ts:139` 可选参数 `checkpointStore?:` 模式
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/loop-orchestrator-snapshot.test.ts`

```typescript
// loop-orchestrator.ts
export interface LoopOptions {
  // ... existing fields
  /** Create snapshot on suspend */
  snapshotOnSuspend?: boolean;
}

export class LoopOrchestrator {
  private snapshotService?: SnapshotService;

  constructor(
    // ... existing params
    snapshotService?: SnapshotService,
  ) {
    this.snapshotService = snapshotService;
  }

  // In streamCore, on suspend:
  if (event.type === 'suspended') {
    let snapshotId: string | undefined;
    if (options.snapshotOnSuspend && this.snapshotService) {
      snapshotId = await this.snapshotService.track();
      this.eventBus?.emit('snapshot:track', { snapshotId, sessionId });
    }
    await this.saveCheckpoint(sessionId, loopCtx, snapshotId);
    // ...
  }
}
```

### Task 3: 序列化支持 snapshotId

- **Action**: 扩展 `serialize.ts` 支持快照ID存储
- **Mirror**: 参考 `serialize.ts` 现有序列化逻辑
- **Validate**: 包含在单元测试中

```typescript
// serialize.ts
export interface SerializedContext {
  // ... existing fields
  snapshotId?: string;
}

export function serialize(ctx: PipelineContext, snapshotId?: string): SerializedContext {
  return {
    ...existingSerialization(ctx),
    snapshotId,
  };
}
```

### Task 4: SessionManager 集成

- **Action**: 处理快照事件，提供会话快照查询能力
- **Mirror**: 参考 `session-manager.ts` 现有事件处理
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/session-snapshot.test.ts`

```typescript
// session-manager.ts
export interface SessionManager {
  // ... existing methods

  /** Get snapshots associated with a session */
  getSessionSnapshots(sessionId: string): Promise<string[]>;

  /** Get file patches since a session's last snapshot */
  getSessionPatches(sessionId: string): Promise<FilePatch[]>;
}
```

### Task 5: 端到端集成测试

- **Action**: 创建完整的集成测试场景
- **Mirror**: 参考 `snapshot-service.test.ts` 测试模式
- **Validate**: `pnpm --filter @primo-ai/core test`

```typescript
// loop-orchestrator-snapshot.test.ts
describe('LoopOrchestrator with SnapshotService', () => {
  it('creates snapshot on suspend', async () => {
    // Setup: Agent with SnapshotService
    // Act: Run agent, trigger suspend
    // Assert: Snapshot created and linked to checkpoint
  });

  it('detects file changes on resume', async () => {
    // Setup: Suspended agent with snapshot
    // Act: Modify file, resume agent
    // Assert: patch() returns correct changes
  });

  it('can revert changes before resume', async () => {
    // Setup: Suspended agent with snapshot
    // Act: Modify files, call revert(), resume
    // Assert: Files restored, agent continues
  });
});
```

## Validation

```bash
# 类型检查
pnpm check-types

# 单元测试
pnpm --filter @primo-ai/core vitest run __tests__/loop-orchestrator-snapshot.test.ts
pnpm --filter @primo-ai/core vitest run __tests__/session-snapshot.test.ts

# 全量测试
pnpm --filter @primo-ai/core test
```

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 快照开销影响暂停性能 | Medium | 异步创建快照，不阻塞暂停 |
| 序列化兼容性 | Low | snapshotId 为可选字段，向后兼容 |
| 大量文件追踪性能 | Medium | 限制 patterns 范围，增量追踪 |
| 事件存储膨胀 | Low | 快照事件仅存储元数据，不存储内容 |

## Acceptance

- [ ] SDK 类型扩展完成（SnapshotSessionEvent）
- [ ] LoopOrchestrator 支持 SnapshotService 注入
- [ ] 暂停时自动创建快照（可选）
- [ ] 恢复时检测文件变更
- [ ] SessionManager 支持快照查询
- [ ] 端到端集成测试通过
- [ ] 类型检查通过
- [ ] 测试覆盖率 ≥ 80%

---
*Status: DRAFT — Awaiting confirmation to proceed*
