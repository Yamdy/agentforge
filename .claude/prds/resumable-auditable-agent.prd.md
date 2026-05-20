# 可恢复、可审计的 Agent 运行能力

## Problem

企业级端侧 Agent 应用需要支撑**长时任务**和**人机协同（HITL）**场景，要求 Agent 运行过程中可中断、可恢复。同时，企业安全合规要求 Agent 对文件系统的操作必须留痕可审计，避免"胡乱操作不留痕"的风险。

目前 AgentForge 缺乏：
1. **结构化并发控制**：RunMode 只是简单状态标记，无法实现真正的中断-恢复
2. **文件系统快照**：无法追踪 Agent 修改了哪些文件，无法回滚

## Evidence

- **长时任务需求**：Agent 运行可能持续数小时，中断后需要能恢复继续
- **HITL 需求**：人机协同场景要求 Agent 可暂停等待人工确认后继续
- **安全合规需求**：企业内部使用，高安全高可靠是必要条件

## Users

- **Primary**: 基于 AgentForge 开发端侧 Agent 应用的开发者
- **Secondary**: 使用这些 Agent 应用的企业用户（需要可审计能力）
- **Not for**: 云侧多租户 Server 场景（延后处理）

## Hypothesis

我们相信**实现结构化并发和文件系统快照**将**支撑长时任务和企业级审计**，为**端侧 Agent 开发者**提供**可恢复、可审计的 Agent 运行能力**。

我们将在以下场景验证成功：
- Agent 中断后可从断点恢复继续执行
- Agent 文件修改可追溯、可回滚
- 进程崩溃后未完成任务可恢复

## Success Metrics

| Metric | Target | How measured |
|--------|--------|--------------|
| 恢复成功率 | ≥ 99% | 中断后恢复测试用例通过率 |
| 审计完整性 | 100% 文件操作记录 | 快照覆盖所有文件修改 |
| 持久化队列可靠性 | 崩溃后任务不丢失 | 模拟崩溃测试 |

## Scope

**MVP** — 支持端侧 Agent 可恢复、可审计运行的最小能力集：

1. **Runner 模式**（结构化并发）
   - `ensureRunning`: 确保任务运行，支持排队
   - `startShell`: 启动可中断的 Shell 模式任务
   - `cancel`: 取消当前任务
   - `resume`: 从断点恢复任务
   - 持久化队列支持（崩溃后恢复）

2. **Snapshot 服务**（文件系统审计）
   - `track()`: 开始追踪文件系统变更
   - `patch(snapshotId)`: 获取变更差异
   - `revert(snapshotId)`: 回滚到指定快照
   - 抽象 `FileSystemAdapter` 接口（预留远程文件系统扩展）

3. **集成**
   - 与现有 `CheckpointStore` 集成
   - 与 `SessionStorage` 集成
   - 与 `LoopOrchestrator` 集成

**Out of scope**

- 实例隔离（多租户场景） — 延后到 Server 多租户需求
- Effect 框架引入 — 架构决策，非需求驱动
- 云侧多租户 Server — 低优先级
- 远程文件系统实现 — 仅预留接口

## Delivery Milestones

| # | Milestone | Outcome | Status | Plan |
|---|-----------|---------|--------|------|
| 1 | Runner 模式 | Agent 可中断、可恢复、崩溃后可恢复 | complete | `.claude/plans/resumable-auditable-agent.plan.md` |
| 2 | Snapshot 服务 | 文件修改可追踪、可回滚 | complete | `.claude/plans/milestone-2-snapshot-service.plan.md` |
| 3 | 集成与测试 | 端到端可恢复、可审计能力 | in-progress | `.claude/plans/milestone-3-integration.plan.md` |

## Open Questions

- [x] 文件系统快照是否需要支持远程文件（如 S3）？→ **接口预留，未来扩展**
- [x] Runner 模式是否需要支持持久化队列？→ **需要支持**
- [ ] 持久化队列存储后端选择？（SQLite / JSONL / 其他）
- [ ] Snapshot 性能要求？（大仓库场景下的追踪开销）

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| 快照开销影响 Agent 性能 | Medium | High | 增量追踪 + 异步写入 |
| 持久化队列写入延迟 | Low | Medium | 批量写入 + 写前日志 |
| 接口设计不够抽象 | Low | Medium | 参考业界实践（git、opencode） |

## Technical Notes

### Runner 状态机设计

```
Idle → Running → (cancel/interrupt) → Idle
     → Shell   → (resume) → Running
     → ShellThenRun → (shell complete) → Running
```

### Snapshot 接口设计

```typescript
interface FileSystemAdapter {
  readFile(path: string): Promise<string | Buffer>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(pattern: string): Promise<string[]>;
  hashFile(path: string): Promise<string>;
}

interface SnapshotService {
  track(): Promise<SnapshotId>;
  patch(snapshotId: SnapshotId): Promise<FilePatch>;
  revert(snapshotId: SnapshotId): Promise<void>;
}
```

### 持久化队列设计

```typescript
interface TaskQueue {
  enqueue(input: string, options?: TaskOptions): Promise<TaskHandle>;
  getStatus(taskId: string): Promise<TaskStatus>;
  resume(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  // 崩溃恢复
  recoverPending(): Promise<void>;
}
```

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
