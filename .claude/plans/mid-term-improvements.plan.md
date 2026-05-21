# Plan: 中期完善 — Sub-agent、Runner 并发、Summarize 内置化、事件溯源

**Source**: 差距分析报告 Phase 2/3 结论
**Complexity**: Medium
**Status**: pending

## Summary

基于三代码库（Pi、OpenCode、AgentForge）实际源码对比，AgentForge 的 P0 问题（结构化内容模型、流式事件）已解决。P1/P2 的 5 个中期项目中：sub-agent 和 TaskManager 骨架已存在、ConcurrencyController 可用、压缩插件已支持 summarize phase（但缺少内置 LLM 调用）。本计划聚焦：补完 sub-agent 验证、内置 summarize compaction、ConcurrencyController 接入 LoopOrchestrator、以及事件溯源。

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Naming | `packages/core/src/sub-agent.ts:14` | `createSubAgentTool(config, parent)` — factory 返回 ToolDefinition |
| Naming | `packages/core/src/task-manager.ts:86` | `TaskManagerImpl implements ITaskManager` — 实现 SDK interface |
| Errors | `packages/core/src/agent.ts:196-198` | `try/catch` → `autoInvalidateModel(error)` → `throw` |
| Errors | `packages/core/src/pipeline.ts:187-194` | hook error suppressed: `catch { /* hook error must not mask original */ }` |
| Data access | `packages/core/src/checkpoint-store.ts:29` | `JsonlCheckpointStore<T>` — generic, atomic write via `rename(tmp, target)` |
| Data access | `packages/plugins/src/compression/compression-processor.ts:81` | `createCompressionStrategy(config)` — 纯函数工厂，返回 `CompressionStrategy` |
| Tests | `packages/core/__tests__/sub-agent.test.ts:1` | `vitest`, `describe/it/expect/beforeEach/vi` |
| Tests | `packages/core/__tests__/agent-abort.test.ts:13` | tracer bullet pattern: 正常路径先验证 → 异常路径后验证 |

## Files to Change

| File | Action | Why |
|---|---|---|
| `packages/core/src/sub-agent.ts` | UPDATE | `summary-only` policy 的 `summarizeSessionState` 是 stub，需实现真正的 LLM summarize |
| `packages/core/__tests__/sub-agent.test.ts` | UPDATE | 补充 `inherit`/`summary-only`/error propagation 测试覆盖 |
| `packages/core/src/loop-orchestrator.ts` | UPDATE | 新增 `RunMode` (Normal vs Shell)，支持 shell-interrupt 和 work queue |
| `packages/core/__tests__/loop-orchestrator.test.ts` | CREATE | RunMode 状态转换 + shell-interrupt 测试 |
| `packages/plugins/src/compression/compression-processor.ts` | UPDATE | 新增 `BuiltInSummarizer` — 不需要外部 `summarizeFn`，内置调用 LLM |
| `packages/plugins/__tests__/compression-summarize.test.ts` | CREATE | summarize phase 的内置 LLM 调用测试 |
| `packages/core/src/event-bus.ts` | UPDATE | 新增 `version` 和 `sequence` 字段支持 |
| `packages/core/src/sync-event.ts` | CREATE | SyncEvent 定义/发射/回放 — 仿 opencode 的 SyncEvent.define() 模式 |
| `packages/core/__tests__/sync-event.test.ts` | CREATE | SyncEvent 版本化 + replay integrity 测试 |
| `packages/server/src/server.ts` | UPDATE | 修复 3 处接线 bug（sessionRoutes 传参、registerSession 调用） |
| `packages/server/__tests__/server-session-routing.test.ts` | CREATE | 验证多轮对话 sessionId 传递链 |

## Tasks

### Task 1: 修复 Server 接线（阻塞修复）
- **Action**: `server.ts:123` 传 `registry` + `eventStream` 给 `sessionRoutes`；`sessions.ts:132` 传 `{ sessionId }` 给 `agent.run()`；agent 注册时调用 `registry.registerSession()`
- **Mirror**: 现有 `server.ts:122` `agentRoutes(this.registry)` 传参模式
- **Validate**: `pnpm --filter @primo-ai/server vitest run __tests__/server-session-routing.test.ts`

### Task 2: Sub-agent `summary-only` 内置 summarize
- **Action**: 实现 `summarizeSessionState()` — 不依赖外部传入的 summarize 函数，而是接受一个可选的 `{ summarizeFn }` option，默认用拼接方式做简单摘要
- **Mirror**: 现有 `sub-agent.ts:50-60` 结构，Pi `compaction.ts:generateSummary()` 的 prompt 模板
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/sub-agent.test.ts`

### Task 3: Runner 并发状态管理
- **Action**: 在 `LoopOrchestrator` 中引入 `RunMode` 枚举 (`Normal` | `Shell`)，仿 opencode `Runner` 的 `ShellThenRun` 模式：shell 执行期间 queue 的 LLM run 在 shell 结束后自动启动
- **Mirror**: 现有 `StateMachine` 状态转换表模式 (`state-machine.ts:5-12`)
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/loop-orchestrator.test.ts`

### Task 4: 内置 Summarize Compaction
- **Action**: 在 `compression-processor.ts` 中新增 `BuiltInSummarizer` 类，内部用 AI SDK 调用 LLM 生成结构化摘要。仿 Pi 的 `SUMMARIZATION_PROMPT` 模板（Goal/Progress/Decisions/Next Steps/Critical Context）
- **Mirror**: 现有 `createCompressionStrategy()` 工厂模式 + Pi `compaction.ts` 的 prompt structure
- **Validate**: `pnpm --filter @primo-ai/plugins vitest run __tests__/compression-summarize.test.ts`

### Task 5: SyncEvent 事件溯源
- **Action**: 新建 `sync-event.ts`，定义 `SyncEvent<T>` 类型（带 version/aggregateId/seq），`SyncEventStore`（原子序列号分配 + 持久化 + 回放），基于现有 `EventBus` 但增加版本化和 sequence integrity check
- **Mirror**: 现有 `CheckpointStore` 的 `InMemoryCheckpointStore` / `JsonlCheckpointStore` 双层实现模式
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/sync-event.test.ts`

## Validation

```bash
# 全量类型检查
pnpm check-types

# 核心包测试
pnpm --filter @primo-ai/core vitest run

# 插件包测试
pnpm --filter @primo-ai/plugins vitest run

# Server 测试
pnpm --filter @primo-ai/server vitest run

# 全量回归
pnpm test
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| SyncEvent 与现有 EventBus 的兼容迁移成本高 | Medium | 新实现独立模块，不修改 EventBus 现有接口，通过 adapter 桥接 |
| 内置 summarize 的 LLM 调用增加延迟和成本 | Medium | 仅在 `summarizeFn` 未提供时 fallback；添加 maxTokens 限制；通过 modelFactory 复用现有 provider |
| Shell-interrupt 引入状态爆炸 | Low | 仅定义 4 状态（opencode Runner 也是 4 状态），有现成参考 |
| Sub-agent error propagation 丢失上下文 | Medium | `createSubAgentTool` 已有 error wrapping（line 79），加强测试覆盖即可 |

## Acceptance

- [ ] Server 接线修复后，多轮对话 `POST /sessions/:id/prompt` 携带历史
- [ ] `sub-agent.test.ts` 全部通过（inherit / isolated / summary-only / error）
- [ ] `compression-summarize.test.ts` 验证内置 summarize 产出合法摘要
- [ ] `sync-event.test.ts` 验证版本化事件的原子序列号 + replay integrity
- [ ] `loop-orchestrator.test.ts` 验证 ShellThenRun 状态转换
- [ ] 全量 `pnpm check-types` 通过
- [ ] 全量 `pnpm test` 不给现存测试引入 regression
