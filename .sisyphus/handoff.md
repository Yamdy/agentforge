---
## Goal

设计 AgentForge 框架的新架构，基于 RxJS 事件流 + Zod 类型安全作为底座，实现可观测、可中断、可恢复、重试、超时、打点、HITL 等核心能力。**Phase 0 原型验证已完成 ✅**

## Instructions

- 忽略现有实现，从需求出发重新设计
- 不使用 Effect-TS，保留 RxJS
- 暴露简单的配置式 API，底层 RxJS 可编程
- 设计轻量 DI，配置驱动自动装配
- 补充流层陷阱与约束（生命周期、竞态、错误边界）
- 补充 Zod 数据契约层设计
- 修复 P0/P1/P2/P3 所有设计缺陷
- Phase 0 原型验证：编写 `agent-loop.spec.ts`，用纯 RxJS + Zod 实现 `expand + StepContext` 的简化版，**完全独立于现有代码**

## Discoveries

1. **框架定位**：agentforge 是开发框架，opencode 是产品，不应混入产品级特性
2. **RxJS 统一模型**：Observable<AgentEvent> + expand 递归 = Agent Loop 核心
3. **三层 API**：L1 零代码配置文件、L2 配置式 createAgent()、L3 RxJS 编程式
4. **Zod 校验按信任度分级**：外部强校验+兜底、跨模块编译时校验、内部仅 TypeScript 类型
5. **Skill = 知识包**：静态文件 + SKILL.md，不是执行子系统
6. **A2A 是 P2P 模式**：A2AClient 实质是对等端点，不是传统客户端-服务器
7. **PromptBuilder 状态隔离**：必须是 Agent 级实例，loadedSkills 不可跨 Agent 共享
8. **压缩不可逆**：CompactionManager + Checkpoint 需要兼容性设计（compactionHistory + 可选 snapshotRef）
9. **RxJS expand 异步陷阱**：`expand` 中返回 `Promise` 会导致事件重复/丢失，必须用 `from(promise).pipe(mergeMap(...))` 模式正确包装异步调用
10. **errors-as-events 设计**：LLM/工具错误转换为 `agent.error` + `done` 事件，而非让流抛出异常

## Accomplished

### 设计文档（全部完成）
- `docs/architecture/RXJS-EVENT-STREAM-DESIGN.md` — 完整设计文档（~8868行）
- `docs/analysis/OPENCODE-GAP-ANALYSIS.md` — 差距分析报告

### P0-P3 缺陷修复（全部完成）
- 并行工具调用：移除 `toArray()`，用 `mergeMap` 独立发出
- `state` 在 `expand` 外部被修改：用 `scan` + `{event, state}` 模式
- `z.instanceof(Error)` 无法序列化：改为 `SerializedErrorSchema`
- 缺少 LLM 输出校验修复闭环：新增 `llm.output.invalid` + 修复循环
- 缺少 PromptBuilder：完整实现
- Zod → FunctionDefinition 转换：完整实现
- 其他 P1/P2/P3 修复：全部写入设计文档

### Phase 0 原型验证（已完成 ✅）
- `tests/agent-loop.spec.ts` — 全部 9 个测试通过
- 核心实现要点：
  - `step()` 函数正确路由所有事件类型：`agent.start`, `llm.response`, `tool.result`, `tool.batch.complete`, `done`, `agent.error`
  - 单工具执行：`from(promise).pipe(mergeMap(arr => from(arr)))` 模式
  - 批量工具：`Promise.all()` 收集结果 → 按顺序发出事件
  - `state.batchContext` 区分批量与单工具 `tool.result`
  - maxSteps 检查在 step 增量时进行
  - errors-as-events：LLM 错误转换为事件而非抛出异常

## Relevant files / directories

- `docs/architecture/RXJS-EVENT-STREAM-DESIGN.md` — 主设计文档（已完成）
- `docs/analysis/OPENCODE-GAP-ANALYSIS.md` — 差距分析报告（已完成）
- `tests/agent-loop.spec.ts` — Phase 0 原型验证测试（已完成 ✅）
- `vitest.config.mts` — 已更新支持 `*.spec.ts`

---

## Remaining Tasks

Phase 0 完成。下一步是 **Phase 1：核心类型实现**：

1. 从设计文档提取 Zod schemas 到 `src/core/events.ts`
2. 实现 `AgentState` + `Checkpoint` 类型
3. 实现 `StepContext` + 事件构建器
4. 编写核心类型单元测试

---

## Phase 0 Test Results

```
✓ Scenario 1: Normal conversation - should complete without tool calls
✓ Scenario 2: Single tool call - should execute single tool and continue
✓ Scenario 3: Parallel tool calls - should execute tools in parallel and detect batch completion
✓ Scenario 3: Parallel tool calls - should handle batch with tool failure
✓ Scenario 4: LLM output validation - should detect invalid tool call
✓ Scenario 5: HITL simulation - should execute tool that simulates HITL
✓ Scenario 6: Error handling - should handle tool execution errors gracefully
✓ Scenario 6: Error handling - should handle LLM errors
✓ Scenario 6: Error handling - should respect max steps limit

Test Files  1 passed
Tests       9 passed
```
