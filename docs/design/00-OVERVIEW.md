# AgentForge 架构铁律

> 设计日期: 2026-04-24 | 最后修订: 2026-05-02
> 核心理念: 命令式 while(true) 事件循环 + Zod 类型安全 + Harness 硬管控
> 铁律总数: 15 条（5 架构 + 6 运行时 + 4 实现）

---

## 架构定位

AgentForge 是一个 **Agent Harness 框架**。核心职责不是 AI 推理（那是 LLM 的事），而是**工程管控**——执行控制、资源约束、状态持久、安全隔离、行为可观测。

```
Agent = LLM（认知决策核心）+ Harness（工程管控基座）
```

- **LLM 负责**：推理、决策、语义理解
- **Harness 负责**：执行管控、资源约束、状态持久、安全隔离、行为可观测
- **所有 Agent 行为必须经过 Harness 管控，不可绕过**

---

## 架构层铁律（5 条 — 决定"框架是什么"）

> 违反将导致架构退化或不可维护。

| # | 铁律 | 说明 | 执行状态 |
|---|------|------|---------|
| **A1** | **命令式循环 + 事件发射器** | 核心引擎是 `while(true)` + `await`，非递归 expand，非流驱动。所有操作通过 `AgentEventEmitter` 分发，`on()` 必须返回 unsubscribe 函数。 | ✅ 已执行 |
| **A2** | **Harness 硬管控，不可绕过** | LLM 决定做什么，Harness 确保做得好。安全校验（命令/路径/审批）必须硬编码在 loop 内，不可依赖 prompt 或 LLM 自觉。 | ⚠️ 部分接线 — `checkCommand` 已接入(agent-loop.ts:272)，`rateLimiter`/`inputSanitizer`/`permissionController` 未接线 |
| **A3** | **Zod 分层数据契约** | Tier 1（外部 LLM/用户输入）Zod 强校验+兜底降级；Tier 2（模块边界）Schema 契约；Tier 3（内部）TypeScript 类型。`as any` 是类型契约的敌人。 | ⚠️ 部分执行 — 38 处 `as any` 待清理（9 文件，`create-agent.ts` 最多 19 处） |
| **A4** | **DI 解耦 + 上下文闭包** | 核心 Loop 只依赖接口，禁止内部 `new` 硬编码实现。依赖通过 `AgentContext` 闭包传递，非全局单例。 | ✅ 基本执行 |
| **A5** | **三层 API 渐进式复杂度** | L1（零代码 JSON）→ L2（`createAgent` 配置）→ L3（`ContextBuilder` 编程）。每层可用能力必须是上层超集，不可出现能力断层。 | ⚠️ 待完善 — L3 缺部分 builder 方法，L1 缺 `history` 等字段 |

---

## 运行时铁律（6 条 — 决定"loop 必须保证什么"）

> 违反将导致运行时错误或安全漏洞。

| # | 铁律 | 说明 | 执行状态 |
|---|------|------|---------|
| **R1** | **错误即事件，不 throw** | 所有可恢复错误转化为 `agent.error` + `done` 事件。loop 内消化异常，永不 throw 到调用方。`try/catch` 包裹所有外部调用。 | 🔴 P0 — `agent-loop.ts:839` 仍在 emit 后 throw |
| **R2** | **Hook 异常隔离，不击穿** | 每个 Plugin/LifecycleHook 独立 `try/catch`，单插件崩溃绝不拖垮主循环。 | ✅ 已执行 |
| **R3** | **工具调用必经注册表** | 所有外部交互（读写文件、执行命令、网络请求）必须通过 `ToolRegistry` 以 Zod 工具形式注册。不可在 loop 内直接 `exec()` 或 `fetch()`。 | ✅ 已执行 |
| **R4** | **主流程串行，副作用并行** | `while(true)` 内 LLM→工具→检查点 严格串行。独立工具调用可 `Promise.all` 并行。不可在串行路径中写同步阻塞。 | ✅ 已执行 |
| **R5** | **状态外部化，可中断恢复** | 长任务状态通过 Checkpoint 持久化。暂停/恢复通过 `AbortController` + `pause/resume` Promise 模式。不可依赖内存状态存活。 | ✅ 基本执行 |
| **R6** | **检查点声明式接线** | 所有 Harness 跨切面关注点（安全、配额、熔断、限流、压缩、审计）必须通过统一的 CheckpointRegistry 注册到生命周期阶段（pre-llm / post-llm / pre-tool / post-tool / on-error）。loop 在每个阶段自动执行已注册的所有检查点。禁止在各阶段内独立硬编码 `if (ctx.X)` 门控。未注册的模块=未接线，注册表为编译时可验证的完整清单。 | 🔮 提案中 — 2026-05-02 新增。当前 `rateLimiter`/`inputSanitizer`/`permissionController` 有接口无接线 |

---

## 实现铁律（4 条 — 决定"代码怎么写"）

> 违反将导致技术债务累积或类型安全退化。

| # | 铁律 | 说明 | 执行状态 |
|---|------|------|---------|
| **I1** | **类型安全零容忍** | `as any`、`@ts-ignore`、`@ts-expect-error` 视为技术债务。每个 `as any` 必须有 `eslint-disable` 注释说明原因。目标是零 `as any`。 | ⚠️ 38 处待清理（9 文件） |
| **I2** | **ESM + verbatimModuleSyntax** | 所有 import 使用 `.js` 扩展名。类型导入使用 `import type`。禁止 `require()`。项目不含 RxJS 依赖或术语。 | ✅ 已执行 |
| **I3** | **外部输入永远不信任** | LLM 响应、用户输入、MCP 消息全部经 Zod `safeParse`，失败时降级而非崩溃。LLM 输出数值不可直接作为评分或决策依据。 | ✅ 基本执行 |
| **I4** | **测试即文档** | 每个模块必须有测试覆盖核心路径。Mock 用于隔离外部依赖，不可 mock 被测模块自身。 | ⚠️ 部分模块零测试 |

---

## 铁律分级

```
P0（运行时强制 — 违反则功能错误或安全漏洞）:
  A2  Harness 硬管控     R1  错误即事件
  R2  Hook 异常隔离      R3  工具注册表
  R6  检查点声明式接线

P1（架构约束 — 违反则技术债务累积）:
  A3  Zod 分层契约       I1  类型安全零容忍
  I3  外部输入校验       R4  主流程串行

P2（设计指导 — 违反则长期维护成本增加）:
  A1  命令式循环         A4  DI 解耦
  A5  三层 API           R5  状态外部化
  I2  ESM 规范           I4  测试文档
```

---

## 铁律约束矩阵

| 铁律 | 违反后果 | 检测方式 | 禁止模式 |
|------|---------|---------|---------|
| A1 命令式循环 | 内存泄漏、事件丢失 | `grep "expand\(" src/loop/` 无结果 | 禁止递归 expand、禁止流驱动 |
| A2 Harness 硬管控 | 安全绕过 | `grep "rateLimiter" src/loop/agent-loop.ts` 应有引用 | 禁止仅在 prompt 中声明安全规则 |
| A3 Zod 分层 | 脏数据传播 | `grep "as any" src/` 计数递减 | 禁止 `as any` 绕过类型，禁止 Tier1 数据不经 Zod |
| R1 错误即事件 | 双报、调用方崩溃 | `grep "throw error" src/loop/` 无结果 | 禁止 emit error 后又 throw |
| R2 Hook 隔离 | 主循环崩溃 | 每个 Hook 包裹 try/catch | 禁止未捕获的 Hook 异常 |
| R3 工具注册表 | 不可观测的外部调用 | 所有外部 IO 经 ToolRegistry | 禁止 loop 内直接 exec/fetch/readFile |
| R6 检查点声明式接线 | 接线遗漏、功能空洞 | `grep "if (ctx\." src/loop/agent-loop.ts` 计数递减 | 禁止硬编码 `if (ctx.X)` 门控，必须通过 CheckpointRegistry |
| I1 类型安全 | 类型系统信任破裂 | `as any` 计数 ≤ 0 | 禁止 @ts-ignore、@ts-expect-error |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计（RxJS 事件流架构） |
| v2 | 2026-04-30 | 移除 RxJS，切换到命令式 while(true) + AgentEventEmitter |
| v3 | 2026-05-02 | 重写铁律体系。14 条（5A+5R+4I）+ 分级 + 约束矩阵。消灭所有 RxJS 术语。 |
| **v4** | **2026-05-02** | **架构审计 + 文档追认。新增 R6 检查点声明式接线（5A+6R+4I=15 条）。修正行号/计数/状态描述。** |
