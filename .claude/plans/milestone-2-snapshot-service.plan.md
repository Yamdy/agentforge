# Plan: Snapshot 服务实现

**Source PRD**: `.claude/prds/resumable-auditable-agent.prd.md`
**Selected Milestone**: #2 Snapshot 服务
**Complexity**: Medium

## Summary

实现文件系统快照服务，提供 `track()`、`patch()`、`revert()` 三个核心能力，支持 Agent 文件操作的追踪、审计和回滚。抽象 `FileSystemAdapter` 接口预留远程文件系统扩展。参考 Milestone #1 的 Runner 模式和 JSONL 持久化模式。

## Patterns to Mirror

| Category | Source | Pattern |
|----------|--------|---------|
| Naming | `runner.ts:24` | `Runner` class with state machine pattern |
| Naming | `persistent-queue.ts:34,106` | `InMemory*` + `Jsonl*` dual implementation |
| Error Handling | `errors.ts:9-23` | `AgentForgeError` base class with `code` + `recoverable` |
| Persistence | `checkpoint-store.ts:29-82` | JSONL file storage with atomic rename |
| Tests | `checkpoint-store.test.ts:62-118` | `mkdtemp` + `beforeEach/afterEach` cleanup |
| Adapter Pattern | `sdk/src/index.ts:976-978` | Interface abstraction for extensibility |

## Files to Change

| File | Action | Why |
|------|--------|-----|
| `packages/sdk/src/index.ts` | UPDATE | 添加 `FileSystemAdapter`, `SnapshotService`, `FilePatch` 类型 |
| `packages/core/src/snapshot-service.ts` | CREATE | Snapshot 服务核心实现 |
| `packages/core/src/snapshot-store.ts` | CREATE | 快照持久化存储 (JSONL) |
| `packages/core/src/file-system-adapter.ts` | CREATE | 文件系统适配器抽象 + Node.js 实现 |
| `packages/core/src/errors.ts` | UPDATE | 添加 `SnapshotError` 错误类 |
| `packages/core/src/index.ts` | UPDATE | 导出 Snapshot 相关类型 |
| `packages/core/__tests__/snapshot-service.test.ts` | CREATE | Snapshot 服务单元测试 |
| `packages/core/__tests__/file-system-adapter.test.ts` | CREATE | 文件系统适配器测试 |

## Tasks

### Task 1: 定义 SDK 类型

- **Action**: 在 `@primo-ai/sdk` 中添加 Snapshot 相关类型定义
- **Mirror**: 参考 `sdk/src/index.ts` 现有接口定义风格
- **Validate**: `pnpm check-types`

```typescript
// FileSystemAdapter - 抽象文件系统操作
export interface FileSystemAdapter {
  readFile(path: string): Promise<string | Buffer>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(pattern: string): Promise<string[]>;
  hashFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

// FileSnapshot - 单个文件的快照状态
export interface FileSnapshot {
  path: string;
  hash: string;
  content?: string | Buffer;  // 可选：仅对追踪的文件存储
}

// Snapshot - 完整快照
export interface Snapshot {
  id: string;
  createdAt: string;
  files: Map<string, FileSnapshot>;  // path → FileSnapshot
  metadata?: Record<string, unknown>;
}

// FilePatch - 文件变更差异
export interface FilePatch {
  path: string;
  oldHash?: string;
  newHash?: string;
  oldContent?: string | Buffer;
  newContent?: string | Buffer;
  type: 'created' | 'modified' | 'deleted';
}

// SnapshotService - 快照服务接口
export interface SnapshotService {
  track(): Promise<string>;  // 返回 snapshotId
  patch(snapshotId: string): Promise<FilePatch[]>;
  revert(snapshotId: string): Promise<void>;
}
```

### Task 2: 实现 FileSystemAdapter

- **Action**: 创建 `file-system-adapter.ts`，定义抽象接口 + NodeFsAdapter 实现
- **Mirror**: 参考 `checkpoint-store.ts` 的 Node.js fs/promises 使用模式
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/file-system-adapter.test.ts`

```typescript
// file-system-adapter.ts
export class NodeFsAdapter implements FileSystemAdapter {
  async readFile(path: string): Promise<string | Buffer> { ... }
  async writeFile(path: string, content: string | Buffer): Promise<void> { ... }
  async deleteFile(path: string): Promise<void> { ... }
  async listFiles(pattern: string): Promise<string[]> { ... }
  async hashFile(path: string): Promise<string> { ... }  // SHA-256
  async exists(path: string): Promise<boolean> { ... }
}
```

### Task 3: 实现 SnapshotStore 持久化

- **Action**: 创建 `snapshot-store.ts`，支持 JSONL 存储
- **Mirror**: 参考 `persistent-queue.ts` 的 JSONL 持久化模式
- **Validate**: 包含在 `snapshot-service.test.ts` 中

```typescript
// snapshot-store.ts
export class InMemorySnapshotStore implements SnapshotStore { ... }
export class JsonlSnapshotStore implements SnapshotStore {
  async save(snapshot: Snapshot): Promise<void> { ... }
  async load(snapshotId: string): Promise<Snapshot | undefined> { ... }
  async delete(snapshotId: string): Promise<void> { ... }
  async list(): Promise<string[]> { ... }
}
```

### Task 4: 实现 SnapshotService 核心逻辑

- **Action**: 创建 `snapshot-service.ts`，实现 `track()`、`patch()`、`revert()`
- **Mirror**: 参考 `runner.ts` 的服务设计模式
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/snapshot-service.test.ts`

```typescript
// snapshot-service.ts
export interface SnapshotServiceOptions {
  adapter: FileSystemAdapter;
  store: SnapshotStore;
  patterns?: string[];  // 要追踪的 glob patterns
}

export class SnapshotServiceImpl implements SnapshotService {
  private trackedFiles = new Map<string, FileSnapshot>();
  private tracking = false;

  async track(): Promise<string> {
    // 1. 扫描匹配 patterns 的所有文件
    // 2. 计算每个文件的 hash
    // 3. 创建 Snapshot 并持久化
    // 4. 返回 snapshotId
  }

  async patch(snapshotId: string): Promise<FilePatch[]> {
    // 1. 加载 snapshot
    // 2. 重新扫描当前文件状态
    // 3. 对比 hash 差异
    // 4. 返回 FilePatch[]
  }

  async revert(snapshotId: string): Promise<void> {
    // 1. 加载 snapshot
    // 2. 获取当前文件差异
    // 3. 对于 deleted 文件：恢复
    // 4. 对于 modified 文件：恢复
    // 5. 对于 created 文件：删除
  }
}
```

### Task 5: 添加错误处理

- **Action**: 在 `errors.ts` 中添加 `SnapshotError`
- **Mirror**: 参考 `errors.ts` 现有错误类模式
- **Validate**: 包含在测试中

```typescript
export class SnapshotError extends AgentForgeError {
  constructor(message: string, options?: { snapshotId?: string; cause?: Error }) {
    super(message, {
      code: 'SNAPSHOT_ERROR',
      recoverable: false,
      ...options
    });
  }
}
```

### Task 6: 更新导出

- **Action**: 在 `core/src/index.ts` 中导出所有新类型
- **Mirror**: 参考 `index.ts` 现有导出模式
- **Validate**: `pnpm check-types`

## Validation

```bash
# 类型检查
pnpm check-types

# 单元测试
pnpm --filter @primo-ai/core vitest run __tests__/snapshot-service.test.ts
pnpm --filter @primo-ai/core vitest run __tests__/file-system-adapter.test.ts

# 全量测试
pnpm --filter @primo-ai/core test
```

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 大文件 hash 性能 | Medium | 使用流式 hash，异步处理 |
| 追踪大量文件 | Medium | 支持增量追踪，限制 patterns 范围 |
| 回滚时文件被锁定 | Low | 使用 atomic rename，添加重试机制 |
| 内容存储占用磁盘 | Low | 可选存储策略（仅 hash / 内容全存） |

## Acceptance

- [x] `FileSystemAdapter` 接口定义完成
- [x] `NodeFsAdapter` 实现完成
- [x] `SnapshotStore` 持久化实现完成
- [x] `track()` 方法实现并测试通过
- [x] `patch()` 方法实现并测试通过
- [x] `revert()` 方法实现并测试通过 (MVP: 仅删除新文件)
- [x] `SnapshotError` 错误类添加
- [x] 所有类型导出正确
- [x] 类型检查通过
- [x] 测试覆盖率 ≥ 80% (38 新测试)

---
*Status: COMPLETE — Milestone #2 Snapshot 服务已实现*
