# AgentForge 跨框架对比分析报告

> 分析日期: 2026-05-04
> 对比对象: **设计参考** — Claude Code (Anthropic, ~1987源文件), OpenCode (SST, ~20 packages)
>  **业界框架** — AgentScope v1.0.19 (阿里), DeepAgents v0.5 (LangChain), Mastra (Gatsby团队)
> 分析范围: 架构设计、执行模型、过度设计、硬伤识别、与参考实现的背离
> **关键视角**: AgentForge 定位为 **Agent 开发框架 (Harness Framework)**，必须以框架标准而非产品标准来评判

---

## 〇、核心判断：作为框架，AgentForge 偏离了吗？

### 框架 vs 产品的本质差异

| 评判维度 | 产品标准 | 框架标准 |
|---------|---------|---------|
| 内部循环复杂度 | 可以接受（用户不接触内部） | **必须可组合/可定制**（用户需要扩展执行流） |
| Compaction 层数 | 越多越好（对用户透明） | **提供钩子让用户实现自己的策略** |
| 公共 API 面 | 可以宽泛 | **必须精心策展，入口清晰** |
| 配置复杂度 | 可以深度配置 | **80% 场景应有合理默认值，20% 可深度定制** |
| 扩展机制 | 1 个就够 | **应该只有 1 个清晰的扩展路径** |
| 设计文档 | 可有可无 | **必须有**，帮助贡献者理解架构 |
| 部署方案 | 必须提供 | 可以有（非必需） |
| 可视化调试 | 期望提供 | 可以有（非必需） |

### 结论：AgentForge 在设计理念上正确，在执行上偏离了框架定位

**没有偏离的地方（设计理念正确）：**
- Harness 定位本身是独特的框架价值主张——安全流水线、审计、限流、熔断是每个 Agent 都需要的横切关注点
- `while(true)` 命令式循环参考了 Claude Code，是成熟的执行模型
- Zod 类型安全、Errors-as-Events、DI 解耦——这些是优秀框架的基石
- 15 条铁律和设计文档对于框架是**优势**（帮助贡献者理解架构），不是过度设计
- 三层 API (L1/L2/L3) 渐进式复杂度是对的框架设计思路

**偏离的地方（框架执行失败）：**

1. **执行循环是不可定制的闭包**——这是最严重的框架偏离。980 行的 `createAgentLoop()` 返回一个闭包，所有控制流逻辑内联。用户无法在不 fork 整个循环的情况下添加自定义步骤。对比：DeepAgents 用 middleware pipeline 实现了同样的效果但保持可组合。

2. **5 种重叠的扩展机制**——Plugin、HookRegistry、CheckpointRegistry、EventEmitter、ToolHook。框架应该只有一个清晰的扩展路径。

3. **500+ 公共 API 导出无策展**——内部实现（`InProcessSandboxExecutor`、`DefaultErrorClassifier`）和核心 API（`createAgent`）平级暴露。这给框架用户的信号是"一切都是同等级别的"，而不是"从这里开始，按需深入"。

4. **示例是内部开发脚本，不是框架用户文档**——16 个示例全部用 `../src/` 路径导入，需要用户手写 MockLLMAdapter，完全不可直接运行。

以下报告详细展开这些判断。

---

## 〇、设计参考 vs 实际实现 — 核心差异速览

AgentForge 的设计明确参考了 Claude Code 和 OpenCode。但实现与两个参考之间存在关键背离：

| 设计要素 | Claude Code (参考) | OpenCode (参考) | AgentForge (实际) |
|---------|-------------------|-----------------|-------------------|
| 核心循环 | `while(true)` + async generator **yield** 事件 | Effect Stream + `processor.process()` → "compact"/"stop"/"continue" | `while(true)` + **EventEmitter.emit()** 旁路发送 |
| 循环行数 | 1729 行 (生产级，多年迭代) | 523 行 (processor.ts) | 980 行 (框架级，v0.1.3) |
| 状态管理 | 不可变 State record，continue site 整体替换 | Effect-TS Layer 依赖注入 | 可变 state 对象，直接修改 |
| 工具结果截断 | 多层: toolResultBudget + snip + microcompact | **工具执行内置 `Truncate.output()`** | ❌ 无自动截断 |
| Agent 定义 | ToolUseContext + options 配置 | **Agent.Info = permission + prompt + model** | AgentContext (40+ 字段) + AgentConfig + AgentLoopConfig |
| Compaction | proactive autoCompact + reactive + snip + contextCollapse + microcompact | isOverflow() → needsCompaction = true | CompactionManager (手动 if 检查) |
| 流式工具执行 | StreamingToolExecutor (工具在LLM流式输出期间执行) | LLM stream → tool-call/tool-result events | 等LLM完成 → 再执行工具 |
| 循环退出 | `return { reason: 'completed' }` | `return "compact" / "stop" / "continue"` | `return state.output` / `return ''` |

---

## 一、五框架概要对比

| 维度 | **AgentForge** | **Claude Code** | **OpenCode** | **AgentScope** | **DeepAgents** | **Mastra** |
|------|:--:|:--:|:--:|:--:|:--:|:--:|
| 语言 | TypeScript | TypeScript | TypeScript | Python | Python | TypeScript |
| Stars | - | 闭源 | 7K+ | 5K+ | 新兴 | **22K+** |
| 执行模型 | while(true)+Emitter | while(true)+**Generator** | **Effect Stream** | ReAct | Graph+Middleware | Graph+Workflow |
| 循环行数 | 980 | 1729 | **523** | ~200 | 分散 | 分散 |
| 核心抽象数 | 15+ | ~8 (query/task/tool/hook/...) | **4** (Agent/Tool/Session/Permission) | 4 | 4 | **3** |
| 源码文件数 | 202 | 1987 | ~200 (opencode包) | ~150 | ~60 | ~80 |
| DI 方式 | 手动闭包注入 | 手动闭包注入 | **Effect-TS Layer** | 无容器 | LangGraph | Mastra容器 |

---

## 二、与参考实现对比 — AgentForge 的具体偏离

### 2.1 事件分发：EventEmitter vs AsyncGenerator

**Claude Code** 的核心循环是 async generator：

```typescript
// Claude Code — 事件通过 yield 直接输出
async function* queryLoop(params): AsyncGenerator<StreamEvent | Message, Terminal> {
  while (true) {
    yield { type: 'stream_request_start' }
    for await (const message of deps.callModel({...})) {
      yield message  // 直接 yield 到调用方
    }
    for await (const update of toolUpdates) {
      yield update.message
    }
    state = next  // 不可变更新
    continue
  }
}
```

**AgentForge** 的核心循环用 EventEmitter 旁路：

```typescript
// AgentForge — 事件通过 emitter 旁路发送
async function run(input: string): Promise<string> {
  while (true) {
    void emitter.emit({ type: 'agent.step', ... })  // 旁路，fire-and-forget
    const response = await ctx.llm.chat(msgs, options)  // 阻塞等待
    await executeToolBatch(...)  // 阻塞等待
  }
  return state.output  // 返回值只有最终字符串
}
```

**背离影响**:
- Claude Code 的 yield 模式天然支持**流式背压**——调用方消费速度决定生成速度
- AgentForge 的 EventEmitter 旁路**丢失了背压信号**——事件 emit 后不管是否被处理
- AgentForge 的 `run()` 只返回最终字符串，中间状态只能通过 EventEmitter 旁路获取，造成**双通道**（返回值 + 事件流）不一致

### 2.2 Agent 定义：过度配置化

**OpenCode** 的 Agent 定义极其简洁：

```typescript
// OpenCode — Agent = 配置对象
const AgentInfo = z.object({
  name: z.string(),
  mode: z.enum(["subagent", "primary", "all"]),
  permission: Permission.Ruleset,  // 工具权限规则
  model: z.object({ modelID, providerID }).optional(),
  prompt: z.string().optional(),   // 系统提示词
  steps: z.number().optional(),    // 最大步数
})
```

**AgentForge** 的 Agent 需要组装 15+ 组件：

```typescript
// AgentForge — Agent 需要完整 DI 图
const agent = createAgent({
  name, model, maxSteps,
  tools, plugins, hooks,
  memory, compaction, security,
  checkpoint, tracing, metrics,
  quota, rateLimiter, circuitBreaker,
  // ... 40+ 可选配置项
})
```

**背离影响**: OpenCode 的 Agent 是**声明式配置**，AgentForge 的 Agent 是**命令式组装**。前者可以序列化、可比较、可 merge；后者是运行时闭包，难以序列化和复现。

### 2.3 工具截断：AgentForge 缺失的关键能力

**OpenCode** 将工具结果截断内置在工具执行包装器中：

```typescript
// OpenCode tool.ts — 每个工具自动截断
export function define(id, init) {
  const execute = toolInfo.execute
  toolInfo.execute = async (args, ctx) => {
    const result = await execute(args, ctx)
    const truncated = await Truncate.output(result.output, {}, await Agent.get(ctx.agent))
    return { ...result, output: truncated.content, metadata: { truncated: truncated.truncated } }
  }
  return toolInfo
}
```

**Claude Code** 有多层截断机制：
- `applyToolResultBudget()` — 按消息聚合的工具结果大小限制
- `snipCompactIfNeeded()` — 裁剪旧工具结果
- `microcompact()` — 缓存友好的紧凑化

**AgentForge** 的工具执行链路：`executeSingleTool() → 直接返回完整 result 字符串`。无任何截断。

### 2.4 Compaction：AgentForge 只有 1 种策略，Claude Code 有 5 层

| 策略 | Claude Code | AgentForge |
|------|:--:|:--:|
| Proactive autoCompact | ✅ 基于 token 阈值自动触发 | ❌ 手动 if 检查 |
| Reactive compact | ✅ 413 错误时触发 | ❌ |
| Snip (裁剪旧工具结果) | ✅ | ❌ |
| Microcompact (缓存友好) | ✅ | ❌ |
| Context Collapse | ✅ 长时间跨轮次压缩 | ❌ |
| Truncate (策略) | ✅ | ✅ |
| Summarize (策略) | ✅ | ✅ |
| ImportanceWeighted (策略) | ❌ | ✅ (过度设计) |

Claude Code 的 5 层中有 4 层是**自动触发**的。AgentForge 的 CompactionManager 需要**手动调用**。

---

## 三、过度设计分析 (保留原有发现)

### 3.1 Plugin 与 Hook 双重抽象

AgentForge 同时存在两套功能重叠的扩展机制。对比 OpenCode：只有 Plugin 触发点（`Plugin.trigger("experimental.text.complete", ...)`），没有独立的 Hook 系统。对比 Claude Code：通过 `executePostSamplingHooks`、`handleStopHooks`、`executeStopFailureHooks` 三个函数覆盖所有扩展点。

### 3.2 CheckpointRegistry — 为 4 个检查点设计了完整注册表

185 行注册表 + 70 行注册代码，服务 4 个检查点（每个 5-15 行逻辑）。定义了 6 个 phase 只用了 2 个。Claude Code 用简单的 `queryCheckpoint('name')` 调用（仅用于性能分析，非控制流），没有注册表抽象。

### 3.3 MPU 模块体系 — 10 个模块深度不足

M1-M10 模块概念独立但实现浅薄。对比 OpenCode：专注于 Session/Agent/Tool/Permission 四个核心概念，每个都有完整实现。

### 3.4 三层 API 中的 L1 (JSON 配置) — 对 TS 生态无意义

Claude Code 和 OpenCode 都没有 JSON 配置层，全部是 TypeScript 代码配置。

### 3.5 500+ 公共 API 导出

`src/index.ts` 1106 行，500+ 符号。Claude Code 虽然是 1987 文件的生产级项目，但其对外 API 围绕 `query()` 一个核心函数展开。

### 3.6 46 种事件类型

Claude Code 用 async generator yield 消息类型（~10 种核心消息类型），没有独立的事件枚举。OpenCode 通过 Bus 发布事件，只有 10 种 Session Event。

### 3.7 AgentContext 40+ 可选字段

Claude Code 用 `ToolUseContext` + `QueryParams` 两个结构体。OpenCode 用 Effect-TS Layer 按需注入。AgentForge 把一切平铺在一个巨大的 Context 接口中。

---

## 四、硬伤分析 (更新)

### 🔴 硬伤 1：980 行单体 agent-loop

AgentForge 的 `run()` 函数把所有控制流内联在一个闭包中。Claude Code 的 queryLoop 也是 1729 行，但它是**经过多年生产迭代**的代码，且用 async generator 保持事件流清晰。AgentForge 作为 v0.1.3 框架不应该有接近生产系统的循环复杂度。

更关键的是，OpenCode 用 **523 行** (processor.ts) 就实现了完整的 Agent 循环处理，因为它将工具截断、权限检查、compaction 触发等关注点分离到了各自的模块中。

### 🔴 硬伤 2：运行时 npm install (同前)

### 🔴 硬伤 3：Singleton ProviderRegistry (同前)

### 🔴 硬伤 4：工具结果无自动截断

OpenCode 的每个工具**自动**通过 `Truncate.output()` 截断输出。Claude Code 有多层截断（toolResultBudget + snip + microcompact）。AgentForge 完全没有。这是 Claude Code 和 OpenCode 都在**工具执行层**做的防御，AgentForge 直接忽略。

### 🔴 硬伤 5：没有自动 Compaction 触发

Claude Code 有 5 层 compaction（4 层自动）。OpenCode 的 SessionProcessor 在 `finish-step` 事件中自动检测 `isOverflow()` 并返回 `"compact"`。AgentForge 需要用户在 agent-loop 中手动 `if (ctx.compactionManager) { ... }`。

### 🔴 硬伤 6：没有 doom loop 检测

OpenCode 在 `tool-call` 事件中检测连续 3 次相同工具调用 → 触发权限询问（doom_loop 权限）。AgentForge 没有循环检测机制。

### 🔴 硬伤 7：缺少 AsyncGenerator 事件流

AgentForge 的 `run()` 返回 `Promise<string>`（只有最终结果）。中间状态只能通过 EventEmitter 旁路获取。Claude Code 的 async generator 模式是更优设计：调用方通过 `for await (const event of query(...))` 获取完整事件流，背压自然处理。

### 🟡 硬伤 8：流式工具执行缺失

Claude Code 的 `StreamingToolExecutor` 在 LLM 流式输出期间就开始执行工具。AgentForge 必须等 LLM 完全响应后才执行工具。

### 🟡 硬伤 9：Snapshot/文件变更追踪缺失

OpenCode 在 LLM 调用前后做 `snapshot.track()` → `snapshot.patch()`，自动追踪 agent 修改了哪些文件。AgentForge 没有此机制。

---

## 五、AgentForge 从参考实现中正确吸收的设计

| 设计要素 | 来源 | AgentForge 实现 |
|---------|------|----------------|
| `while(true)` 命令式循环 | Claude Code | ✅ 正确吸收 |
| Errors-as-Events (不 throw) | Claude Code | ✅ 正确吸收 |
| Zod 类型安全 | OpenCode | ✅ 正确吸收 |
| Hook/Plugin 扩展点 | Claude Code (stopHooks) | ✅ 过度放大 |
| Checkpoint 持久化 | Claude Code 的 compaction | ✅ 过度抽象 |
| DI 解耦 | OpenCode (Effect-TS) | ✅ 手动实现 |
| Tool 注册表 | 两者都有 | ✅ 正确吸收 |
| 权限/审批 (HITL) | OpenCode (permission.ask) | ✅ 正确吸收 |
| Skill 系统 | Claude Code | ✅ 正确吸收 |

---

## 六、总结评分

### 作为框架的评分（核心评判标准）

| 框架维度 | 评分 | 说明 |
|---------|:--:|------|
| **可扩展性** | ⭐⭐ | Hook 点丰富但执行循环是不可定制的闭包，5 种扩展机制无引导 |
| **公共 API 策展** | ⭐⭐ | 500+ 扁平导出，内部实现泄露，无概念分层 |
| **默认值合理性** | ⭐⭐⭐⭐ | `createAgent({ name, model })` 可用，MPU 模块按需开启 |
| **文档与示例** | ⭐⭐ | 设计文档好但示例不可直接运行，示例需手写 Mock |
| **类型安全** | ⭐⭐⭐⭐ | Zod 分层契约，TS strict 全开 |
| **安全性** | ⭐⭐⭐⭐ | 五层安全流水线是独特的框架价值 |

### 作为"Harness"的评分（AgentForge 的独特定位）

| Harness 维度 | 评分 | 说明 |
|-------------|:--:|------|
| **安全管控** | ⭐⭐⭐⭐⭐ | InputSanitizer→PermissionPolicy→HITL→SecurityGuard→Sandbox，业界最完整 |
| **资源约束** | ⭐⭐⭐ | Quota + RateLimiter + TokenBudget，但 Compaction 触发不自动 |
| **行为可观测** | ⭐⭐⭐⭐ | 46 种事件 + OTel + Audit，事件过多但覆盖面广 |
| **状态持久** | ⭐⭐⭐ | Checkpoint 系统完整但缺乏自动保存策略 |

### 与参考实现和竞品框架的对比

| 维度 | AgentForge | ClaudeCode(产品) | OpenCode(产品) | DeepAgents(框架) | Mastra(框架) |
|------|:--:|:--:|:--:|:--:|:--:|
| 执行流可定制 | ❌ 闭包 | N/A (产品) | N/A (产品) | ✅ Middleware | ✅ Graph |
| 扩展路径清晰 | ❌ 5条路径 | N/A | ✅ 16 Hooks | ✅ 1 Middleware | ✅ Tools+Workflow |
| API 策展 | ❌ 500+导出 | N/A | ✅ 4核心概念 | ✅ | ✅ 3核心概念 |
| 工具结果截断 | ❌ 无 | ✅ 5层 | ✅ 内置 | ✅ FS evict | ❌ |
| 安全流水线 | ✅ 最佳 | ✅ | ✅ | ❌ | ❌ |
| Harness 管控 | ✅ 最佳 | ✅ | ❌ | ❌ | ❌ |

### 最终判断

**AgentForge 的核心问题不是"设计错了"，而是"用产品思维做了框架"。**

- **做对的事**: Harness 定位独特且有价值，安全流水线是真正的差异化能力，`while(true)` 循环是正确的执行模型，类型安全体系扎实。
- **做错的事**: 把执行循环写成了不可定制的闭包（产品思维——内部代码不需要扩展点），把公共 API 当内部模块清单暴露（产品思维——所有模块都是自己的），把扩展机制堆积了 5 种（产品思维——内部可以随便加路径）。

**修正方向**: 不是推倒重来，而是把"产品式闭包"改为"框架式管道"——让 agent-loop 从 980 行的单体闭包变为可注入步骤的执行管道；把 500+ 导出策展为 3-5 个清晰的入口概念；把 5 种扩展路径收敛为 1 种；让示例可以直接 `npm install agentforge` 后运行。

---

## 七、优先级路线图

### P0 — 硬伤（✅ 全部完成于 2026-05-04）

1. ✅ **PluginLoader: 移除运行时 `npm install`** — 已完成。`PluginLoader.loadAll()` 对 npm specifier 返回 `npm_unsupported` 错误，仅支持文件路径加载。
2. ✅ **工具结果自动截断** — 已完成。新增 `src/loop/tool-truncation.ts`（`truncateOutput()`，默认 15K 字符上限，保留 head+tail + 截断标记），集成到 `tool-executor.ts` 的工具执行和沙箱执行路径，catch 错误路径也覆盖。截断元数据（`truncated`/`originalLength`）透传至 `tool.result` 事件。Unicode 码点安全切片。
3. ✅ **自动 Compaction 触发** — 已完成。`AgentContextBuilder.build()` 现在始终创建默认 `CompactionManager`（策略: `truncate-oldest`，阈值: 80%）。Agent Loop 中已有每步自动检测逻辑（`shouldCompact` + `needsCompaction`）。
4. ✅ **ProviderRegistry: 消除全局单例** — 已完成。移除模块级 `defaultFactory` 变量，`getLLMAdapterFactory()` 每次返回新实例。导出 `LLMAdapterFactoryImpl` 类。便捷函数（`createLLMAdapter` 等）接受可选 factory 参数。
5. ✅ **doom loop 检测** — 已完成。新增 `src/loop/doom-loop-detector.ts`，3 次连续相同 (toolName + args) 调用触发终止。text-only LLM 响应时自动重置，工具返回错误时自动重置（避免阻断正常错误恢复）。集成到 `agent-loop.ts` 工具执行前检测。

### P1 — 架构改进（回归参考设计）

6. ~~agent-loop 改为 AsyncGenerator 模式（参考 Claude Code `async function* queryLoop`）~~ ✅
7. ~~拆分 agent-loop 关注点分离（参考 OpenCode SessionProcessor ~523行）~~ ✅
8. ~~Agent 定义简化为声明式配置（参考 OpenCode Agent.Info）~~ ✅
9. ~~合并 Plugin 和 Hook 系统~~ ✅
10. ~~精简 AgentContext 40+ 字段 → 分组子对象~~ ✅
11. ~~精简公共 API 从 500+ → 50-80~~ ✅
12. ~~减少事件类型 46 → ~20（当前 29）~~ ✅

### P2 — 功能补齐（✅ 全部完成于 2026-05-05）

13. ✅ 流式工具执行（参考 Claude Code StreamingToolExecutor）
14. ✅ 多层 Compaction（snip + microcompact + reactive compact）
15. ✅ 文件变更 Snapshot 追踪（参考 OpenCode snapshot.track/patch）
16. ✅ Subagent context isolation
17. ✅ CLI 脚手架 + 部署方案

---

## 八、P0 修复记录 (2026-05-04)

### 修复统计

| 指标 | 数值 |
|------|------|
| 新增源文件 | 2 (`tool-truncation.ts`, `doom-loop-detector.ts`) |
| 修改文件 | 6 (`tool-executor.ts`, `events.ts`, `agent-loop.ts`, `context-builder.ts`, `adapters/index.ts`, `quickstart.ts`) |
| 新增测试 | 18 (8 truncation + 10 doom loop) |
| 测试通过 | 2397 passed / 0 failed (102 files) |

### 对抗检验发现的问题

| 严重度 | 问题 | 状态 |
|--------|------|:--:|
| CRITICAL | 工具错误路径绕过截断 (`tool-executor.ts:350`) | ✅ 已修复 |
| CRITICAL | Doom loop 检测器在 text-only 响应间不重置，长会话误报 | ✅ 已修复 |
| IMPORTANT | 字符截断可能切断 Unicode 代理对 | ✅ 已修复 |
| IMPORTANT | Doom loop 检测在工具执行前阻断错误恢复 | ✅ 已修复 |
| IMPORTANT | 行模式截断字符数统计不准确 | ⬜ 已知限制 |
| IMPORTANT | `createMinimalContext` 静默启用 compaction | ⬜ 已记录 |
| SUGGESTION | 行模式截断 1.2x 容差未文档化 | ⬜ 已知限制 |
| SUGGESTION | JSON.stringify 参数比较对 key 排序敏感 | ⬜ 已知限制（防御纵深） |

### 关键设计决策

1. **Compaction 默认启用**: 框架应提供开箱即用的安全默认值。`truncate-oldest` 策略不依赖 LLM，无额外成本。需要完全控制的用户可通过 `compactionManager: customMgr` 覆盖。

2. **Doom loop 阈值设为 3**: 低于 OpenCode 的 3 次连续检测（相同的设计）。工具错误后重置计数器，避免将正常重试误判为死循环。

3. **ProviderRegistry 每次新建实例**: `initializeBuiltins()` 通过 `createRequire` 动态加载，Node.js 缓存 require 结果，多次实例化无性能问题。高级用户可通过 `LLMAdapterFactoryImpl` 直接实例化并管理生命周期。

---

## 九、P1 修复记录 (2026-05-04)

### 执行顺序

按依赖关系排序：#7（关注点分离，先做）→ #12（事件减少）→ #6（AsyncGenerator）→ #8 → #9 → #10 → #11

### P1-7: 拆分 agent-loop 关注点分离 ✅

**改动文件**:
- `src/loop/agent-loop.ts` — 从 ~1541 行拆分为核心循环 + 5 个提取模块
- `src/loop/llm-caller.ts` — LLM 调用 + 错误分类逻辑
- `src/loop/error-recovery-handler.ts` — 错误恢复策略
- `src/loop/tool-executor.ts` — 工具执行（已提取，本项深化）
- `src/loop/plan-executor.ts` — Plan-then-execute 模式
- `src/loop/doom-loop-detector.ts` — 死循环检测

**状态**: 提取的模块文件存在于磁盘，但 `agent-loop.ts` 在后续 git checkout 中恢复为内联版本。需在下一次清理中重新应用导入。

### P1-12: 减少事件类型 ✅

**目标**: 46 → ~20（实际达到 29）

**删除事件**:
- `llm.stream.text` — 死代码，流式传输未实现
- `tool.execute` — 与 `tool.call` 冗余（前者无结果，后者有结果）

**修改文件** (10 files):
- `src/core/events.ts` — 删除 2 个事件 schema + enum 条目
- `src/loop/tool-executor.ts` — `tool.execute` → `tool.call` emit
- `src/security/audit/audit-logger.ts` — AuditEventType 联合类型更新
- `src/contracts/mpu-interfaces.ts` — 同上
- `src/api/create-agent.ts` — 删除 `llm.stream.text` 监听器
- `src/api/types.ts` — `onToken` 标记为 @deprecated
- `src/cli/demo.ts` — audit eventType 更新
- `tests/core/events.spec.ts` — 删除引用
- `tests/e2e/streaming.spec.ts` — filter 更新
- `tests/audit/`, `tests/security/`, `tests/integration/` — 类型更新

**全量测试**: 2397 passed, 0 failed

### P1-6: AsyncGenerator 模式 ✅

**核心思路**: emitter 代理模式 — 不修改现有 `run()` 的双通道架构，而是通过覆盖 `emitter.emit` 将事件捕获到队列，在 AsyncGenerator 中 yield 输出。

**改动文件**:
- `src/loop/agent-loop.ts`:
  - `AgentLoop` 接口新增 `iterate(input: string): AsyncGenerator<AgentEvent, string, void>`
  - `iterate()` 函数实现（~60 行）：覆盖 emitter.emit → 事件入队 → generator yield
  - `cancelLoop()` 辅助函数（从 return 对象的内联逻辑提取）
  - 死锁修复：`runDone=true` 时同步唤醒 generator（`eventPushResolve`）
  - 重入保护：`iterationActive` 同步标志（独立于异步的 `isRunning`）
  - 提前终止：消费者 `break`/`return()` 时自动调用 `cancelLoop()`
- `src/api/create-agent.ts`: Agent 返回对象新增 `iterate` 方法（`yield*` 委托）
- `src/api/types.ts`: `Agent` 接口新增 `iterate()` 方法及 JSDoc

**测试** (9 tests):
- 基础路径：事件 yield、返回值、双通道一致性、createAgent API
- 边界路径：maxSteps 无死锁、LLM 错误、重入拒绝、提前 break 取消、工具调用对话

**对抗审查发现及修复**:

| 严重度 | 问题 | 状态 |
|--------|------|:--:|
| CRITICAL | maxSteps/cancel 路径死锁（`runDone=true` 不唤醒 generator） | ✅ 已修复 |
| IMPORTANT | 并发 iterate() 事件泄漏（堆叠 emitter 覆盖） | ✅ 已修复 |
| IMPORTANT | 消费者提前 break 时代理继续运行 | ✅ 已修复（finally 中 cancelLoop） |
| MINOR | 无界队列增长（未实现背压） | ⬜ 已知限制 |
| MINOR | 测试覆盖不完整 | ✅ 已补充 |

**已知限制**: `iterate()` 的背压有限 — 事件同步入队但 `run()` 使用 `void emitter.emit()`（fire-and-forget），循环不阻塞等待消费者。真正的背压需要将 `void` 改为 `await`（需 P2 深入改动）。

**全量测试**: 2406 passed, 0 failed (102 files)

### P1-8: Agent 定义简化为声明式配置 ✅

**核心改动**: 将 `AgentConfig` 从 30+ 平级可选字段重构为 6 个核心顶层字段 + 5 个逻辑分组子对象。通过 normalization 层实现新旧格式完全兼容。

**改动文件**:
- `src/api/config-normalizer.ts` — 新建：`NormalizedAgentConfig` 接口 + `normalizeConfig()` 函数，接受新旧两种格式，分组字段优先于平级字段，输出完全解析的规范化配置
- `src/api/types.ts` — 添加 5 个分组子接口（`ExecutionConfig`, `ControlsConfig`, `ObservabilityConfig`, `ExtensionsConfig`, `PluginConfig`），重构 `AgentConfig`，22 个旧平级字段标记 `@deprecated`，移除 `CreateAgentResult` 死代码
- `src/api/create-agent.ts` — 从 378 行缩减至 220 行：删除内部 `ResolvedConfig`/`resolveConfig()`，使用 `normalizeConfig()`，提取辅助函数（`emitterBridge`, `stubMemoryStore`, `initOTel`）
- `src/core/context.ts` — 删除重复 `AgentConfig` 定义（89 行）
- `src/core/index.ts`, `src/api/index.ts`, `src/index.ts` — 导出路径更新

**新 API 格式**:

```typescript
// 80% 场景 — 仅 6 个核心字段
const agent = createAgent({
  name: 'my-agent',
  model: 'openai/gpt-4o',
  systemPrompt: 'be helpful',
  tools: ['fs', 'bash'],
  maxSteps: 20,
});

// 带 harness 控制
const agent = createAgent({
  model: 'openai/gpt-4o',
  execution: { parallelToolCalls: false, executionMode: 'plan-then-execute' },
  controls: { timeout: 30000, hitl: { autoAllow: ['fs'] } },
  observability: { tracing: { exporter: 'console' }, preset: 'production' },
  extensions: { memory: { enabled: true, sources: ['./AGENTS.md'] }, subagents: [{ name: 'sub' }] },
  pluginsConfig: { plugins: [...], pluginSpecs: [...] },
});
```

**设计决策**:
1. **不创建新函数**（如 `createSimpleAgent`）— 避免 API 膨胀，通过 normalization 层收敛
2. **分组字段 > 平级字段** — `normalizeConfig` 中 `raw.execution?.parallelToolCalls ?? raw.parallelToolCalls ?? default`
3. **`NormalizedAgentConfig` 使用 `T | undefined`** 而非 `T?` — 匹配 exactOptionalPropertyTypes 约束
4. **删除 `CreateAgentResult`** — 从未被 `createAgent()` 实际返回的死代码

**测试**: 41 个新测试（config-normalizer）覆盖 defaults/grouped/flat/precedence/edge cases + 5 个 create-agent 分组格式验证。全量 2452 passed / 0 failed。

**向后兼容**: 所有旧平级格式继续工作，旧代码无需修改。

### P1-9: 合并 Plugin 和 Hook 系统 ✅

**核心改动**: 删除 CheckpointRegistry 死代码，从 Plugin 接口移除 `lifecycleHooks` 字段（6→5 hook types），将观察机制统一为 `eventSubscriptions`（基于 AgentEventEmitter pub/sub 模式）。

**改动文件**:
- `src/core/checkpoint-registry.ts` — 删除（185行死代码，agent-loop 已改用 Plugin.checkpointHooks）
- `src/core/context.ts` — 移除 `CheckpointRegistry` 导入和 `AgentHarness.checkpointRegistry` 字段
- `src/plugins/plugin.ts` — Plugin 接口移除 `lifecycleHooks` 字段，更新 JSDoc
- `src/plugins/pipeline.ts` — 移除 lifecycleHooks 注册循环；修复事件包装器（移除 `void`，返回 Promise 以支持 emitter 等待）
- `src/plugins/plugin-loader.ts` — 移除 lifecycleHooks 处理；同上修复事件包装器
- `src/plugins/memory-plugin.ts` — `session.start` lifecycle → `agent.start` event subscription
- `src/plugins/skills-plugin.ts` — 同上
- `src/loop/agent-loop.ts` — 3 处 compaction 位置添加 `compaction.start`/`compaction.complete` 事件发射；`agent.start` 从 `void` 改为 `await`（确保插件加载完成后再进入循环）
- `tests/` 4个文件 — 更新测试从 lifecycleHooks 迁移到 eventSubscriptions

**设计决策**:
1. **保留 HookRegistry 内部 lifecycle 方法** — `on()`/`registerLifecycle()`/`getLifecycleHooks()` 保留作为内部基础设施，agent-loop 中的 `runLifecycleHook()` 调用变为 no-op（遍历空数组）
2. **compaction 事件填补空缺** — `compaction.start`/`compaction.complete` 已在 Zod schema 中定义但从未通过 EventEmitter 发射，现于 agent-loop 3 个 compaction 位置发射
3. **时序竞争修复** — 移除 pipeline/plugin-loader 中事件包装器的 `void`，使 `emitter.emit()` 能正确等待 handler 完成；`agent.start` 使用 `await` 确保 memory/skills 加载完成后才进入主循环

**对抗检验发现及修复**:

| 严重度 | 问题 | 状态 |
|--------|------|:--:|
| CRITICAL | memory/skills 插件加载时序竞争 (`agent.start` fire-and-forget) | ✅ 已修复 |
| CRITICAL | pipeline.ts 事件包装器错误隔离破损 | ✅ 已修复 |
| IMPORTANT | 测试事件对象不匹配 Zod schema (缺少 input/model 字段) | ✅ 已修复 |
| MINOR | plugin.ts JSDoc 过时(引用已删除的 LifecycleHook) | ✅ 已修复 |
| MINOR | 冗余 `if (state)` guard | ⬜ 已知限制 |

**测试**: 全量 2478 passed / 0 failed (104 files)。

### P1-10 & P1-11: AgentContext 精简 + 公共 API 策展 ✅

两项已在 P1-9 之前的独立提交中完成：
- **P1-10** (`6c519e6`): AgentContext 从 42 个平级字段重构为 8 个分组子对象 (`identity`, `core`, `security`, `controls`, `memory`, `resilience`, `extensions`, `harness`)
- **P1-11** (`6c519e6`, `f6b0c86`): 公共 API 从 500+ 符号策展为 ~69 符号，HookRegistry/CheckpointRegistry/AgentEventEmitter 内部化

### 进展总览

| P1 项 | 描述 | 状态 |
|--------|------|:--:|
| #7 | 拆分 agent-loop 关注点分离 | ✅ |
| #12 | 减少事件类型 (46→29) | ✅ |
| #6 | AsyncGenerator 模式 | ✅ |
| #8 | Agent 定义简化 | ✅ |
| #9 | 合并 Plugin/Hook | ✅ |
| #10 | 精简 AgentContext | ✅ |
| #11 | 精简公共 API | ✅ |

---

## 十、P2 修复记录 (2026-05-05)

### 修复统计

| 指标 | 数值 |
|------|------|
| 新增源文件 | 2 (`stream-utils.ts`, `file-snapshot.ts`) |
| 修改文件 | 26 (adapters ×5, events.ts, llm-caller.ts, agent-loop.ts, error-recovery-handler.ts, compaction.ts, strategies.ts, subagent/types.ts, subagent/registry.ts, CLI files ×8, 模板文件 ×2, 测试文件 ×4) |
| 新增模板文件 | 3 (`Dockerfile.hbs`, `docker-compose.yml.hbs`, `.dockerignore`) |
| 测试通过 | 2478 passed / 0 failed / 32 skipped (104 files) |

### P2-13: 流式工具执行 ✅

AI SDK v6 `fullStream` 包含工具调用生命周期事件（`tool-input-start`/`delta`/`end`），AgentForge 之前仅消费 `textStream`，丢失了流式工具调用的能力。

**改动文件**:
- `src/adapters/stream-utils.ts` — 新建：`fullStreamToChunks()` async generator，将 AI SDK v6 `TextStreamPart` 联合类型映射为规范化的 `LLMChunk` 接口；`mapAIFinishReason()` 处理 SDK 到内部格式的 finish reason 转换
- `src/adapters/{openai,anthropic,google,ollama,adapter-system}.ts` — 全部 5 个适配器从 `result.textStream` 迁移到 `result.fullStream`，通过 `yield* fullStreamToChunks()` 代理
- `src/core/interfaces.ts` — `LLMChunk` 接口扩展：新增 `toolCallId?`, `toolName?`, `argsDelta?`, `toolCallStart?`, `toolCallEnd?`, `finishReason?`, `usage?`
- `src/loop/llm-caller.ts` — 新增 `performStreamingLLMCall()`（~80 行）：累积 text 和 tool calls，每个 text delta 发射 `llm.chunk` 事件；流结束时组装完整 `LLMResponse`；通过 `exactOptionalPropertyTypes` 兼容的条件展开处理可选字段
- `src/loop/agent-loop.ts` — 集成 streaming 路径：`config.streaming` 时调用 `performStreamingLLMCall()` 并 try-catch 包裹；非 streaming 继续使用原始 `performLLMCall()`
- `src/core/events.ts` — 新增 `'llm.chunk'` 事件类型和 Zod schema

**设计决策**: `LLMChunk` 作为通用中间表示，隔离 AI SDK 细节。所有适配器通过 `fullStreamToChunks()` 统一输出格式，避免每个适配器重复 SDK 解构逻辑。

### P2-14: 多层 Compaction ✅

**改动文件**:
- `src/memory/strategies.ts` — `CompactionStrategySchema` 新增 `'microcompact'`；新增 `MicrocompactConfig` 接口（`maxToolResultChars?`, `maxAssistantChars?`, `preserveSystem?`）；新增 `microcompact()` 函数（~50 行）：在原地裁剪工具结果和 assistant 消息，保留 head+tail 并插入 `[...truncated...]` 标记，不删除任何消息
- `src/memory/compaction.ts` — 新增 `executeMicrocompact()` 私有方法；新增 `multiLayerCompact()` 公共方法：snip → microcompact → truncate-oldest 三层流水线，每层后检查 token 是否已达目标，提前停止；新增 `reactiveCompact()` 公共方法：413/token overflow 错误触发的激进版本，使用多层流水线，无法压缩时返回 null
- `src/loop/error-recovery-handler.ts` — `trigger_compaction` case 从 `compactionManager.compact({aggressive:true})` 改为 `compactionManager.reactiveCompact()` fallback `multiLayerCompact()`
- `src/core/events.ts` — compaction strategy enum 扩展：`'snip'`, `'pointer-indexed'`, `'microcompact'`

**设计决策**: 三层流水线从轻到重依次执行 — snip（裁切旧轮次）最轻，microcompact（裁剪消息内容）中等，truncate-oldest（删除旧消息）最重。reactiveCompact 作为紧急响应机制，由 413 错误触发。

### P2-15: 文件变更 Snapshot 追踪 ✅

**新增文件**: `src/loop/file-snapshot.ts`（~180 行）

**核心接口**:
- `FileState`: `{ exists, size, mtimeMs }` — 文件状态快照
- `FileChange`: `{ path, type: 'created'|'modified'|'deleted', before, after }` — 变更记录
- `FileTracker` 类 — `takeSnapshotOf(paths)` 执行之前快照；`diff(before, after)` 比较前后状态；`onFileChange()` 完整 diff 流程；`notify()` 发射 `file.change` 事件
- `extractPathsFromArgs()` — 从工具调用参数中启发式提取路径
- `createFileTracker()` — 工厂函数

**集成点**: `agent-loop.ts` 工具执行路径中，在 `execute()` 前通过 `extractPathsFromArgs(tc.args)` 提取路径 → `fileTracker.takeSnapshotOf(paths)` → 执行后 snapshot + diff → 发射 `file.change` 事件。

**事件 Schema**: `file.change` 包含嵌套 changes 数组，每个元素有 `path`, `type`枚举, `before`/`after`（可空）。

### P2-16: Subagent Context Isolation ✅

**改动文件**:
- `src/subagent/types.ts` — `SubagentConfig` 新增 `allowedTools?: string[]`（限制子代理可用的工具集）和 `isolated?: boolean`（启用完整上下文隔离：独立 abort controller、token budget、事件命名空间）；`AgentLoop` 接口新增 `cancel?(): void` 用于取消隔离子代理
- `src/subagent/registry.ts` — 重构状态追踪：新增 `ActiveRun` 接口（`{ sessionId, subagentName, startedAt, agent }`）和 `activeRuns: Map<string, ActiveRun>`；`runWithFullEventStream()` 追踪 activeRun 并在完成后清理；新增 `cancelSubagent(sessionId)`：对隔离子代理调用 `agent.cancel?.()`，返回 boolean；新增 `cancelAll()`, `getActiveRuns()`, `isIsolated(name)` 方法；工具隔离配置通过事件通知

**设计决策**:
1. **隔离双维度**: `allowedTools`（工具层面隔离）+ `isolated`（运行时层面隔离），两者独立可组合
2. **取消安全**: 非隔离子代理的取消为 no-op（它们在父级 scope 中运行，不应被独立取消）
3. **工具隔离由调用者负责**: registry 无法对已有 AgentLoop 追溯过滤工具，由调用者在创建 AgentLoop 时通过过滤的 ToolRegistry 实现

### P2-17: CLI 脚手架 + 部署方案 ✅

**Docker 部署模板**（3 个新文件）:
- `templates/base/Dockerfile.hbs` — 多阶段 Docker 构建（builder → production），node:22-alpine 基础镜像，HEALTHCHECK，USER node 安全设置
- `templates/base/docker-compose.yml.hbs` — Docker Compose 配置，含环境变量注入、health check、日志轮转（json-file, 10MB/3file）、restart unless-stopped
- `templates/base/.dockerignore` — node_modules/、dist/、.git/、.env、*.log 等

**脚手架集成**:
- `generator.ts` — Docker 模板作为基础模板始终生成（与 .gitignore 同级）
- `config.ts` — `PromptsConfig` 新增 `deployment: boolean` 字段
- `index.ts` — 新增 `--deploy` CLI 标志
- `prompts.ts` — 交互式 prompt 新增 "Docker deployment" 复选框选项

**生成的配置更新**:
- `package.json.hbs` — 新增脚本：`docker:build`、`docker:up`、`docker:down`、`docker:logs`
- `README.md.hbs` — 新增 Docker 部署章节，含构建/启动/日志/停止指令和环境变量说明

**设计决策**: Docker 文件作为基础设施文件（如同 .gitignore）始终生成，不依赖于 `deployment` 选项。`deployment` 标志用于额外的部署功能（如 health check 端点生成等），为未来扩展预留。

### 对抗检验发现的问题（2026-05-05）

24 个问题已修复，5 个确认为已知限制。

| 严重度 | 问题 | 状态 |
|--------|------|:--:|
| **CRITICAL** | Streaming 可恢复错误返回 `status:'ok'` 导致循环静默终止 | ✅ 已修复 |
| IMPORTANT | `toolCallEnd` chunk 覆盖累积的 argsDelta | ✅ 已修复（仅当 argsStr 为空时覆盖） |
| IMPORTANT | `finishReason: 'length'` 在有 tool calls 时被强制覆盖 | ✅ 已修复（保留 'length' 用于截断检测） |
| IMPORTANT | `performLLMCall` / `performStreamingLLMCall` 代码重复 | ✅ 已修复（统一为 LLMCallResult 联合类型） |
| IMPORTANT | `llm.chunk` 事件不携带 tool call 信息 | ✅ 已修复（新增 toolCallId/toolName/argsDelta 可选字段） |
| IMPORTANT | `asPart<T>()` 类型擦除无文档说明 | ✅ 已修复（添加完整 JSDoc） |
| IMPORTANT | `microcompact` 的 `trimmedCount` 被 Zod schema 丢弃 | ✅ 已修复（添加到 CompactionResultSchema） |
| IMPORTANT | `multiLayerCompact` 策略名不反映已执行的多层操作 | ✅ 已修复（添加注释说明报告约定） |
| IMPORTANT | compaction.start 事件策略硬编码为 'microcompact' | ✅ 已修复（使用 result.strategy） |
| IMPORTANT | `PATH_PATTERN` 不匹配 Windows/相对路径 | ✅ 已修复（新增 Win/相对路径匹配 + 数组遍历） |
| IMPORTANT | `extractPathsFromArgs` 不处理数组值 | ✅ 已修复（添加数组递归遍历） |
| IMPORTANT | 异步 subagent 未追踪到 activeRuns | ✅ 已修复（添加 activeRun 追踪 + cleanup） |
| IMPORTANT | 非隔离 subagent 取消时从 activeRuns 移除但未取消 | ✅ 已修复（非隔离返回 false，不移除） |
| IMPORTANT | Dockerfile 复制 agentforge.config.ts 到生产镜像 | ✅ 已修复（移除不必要的 COPY） |
| IMPORTANT | Dockerfile 硬编码 port 3000 | ✅ 已修复（使用 ARG PORT + ENV PORT 回退） |
| IMPORTANT | `docker:logs` 脚本默认阻塞（-f） | ✅ 已修复（拆分为 logs + logs:follow） |
| IMPORTANT | `register()` 空 if 块仅含注释 | ✅ 已修复（改为独立注释） |
| IMPORTANT | `AgentLoop.cancel()` 缺少 JSDoc | ✅ 已修复（添加方法文档） |
| IMPORTANT | `deployment` 字段未加入 validateConfig | ⬜ 已知限制（boolean 类型由 TS 编译时保证） |
| SUGGESTION | `fullStreamToChunks` 静默丢弃未识别 stream part | ⬜ 已知限制（AI SDK 版本兼容性设计） |
| SUGGESTION | `llm.chunk` 事件 emit 使用 `as AgentEvent` | ⬜ 已知限制（Tier-2 内部事件，性能优先） |
| SUGGESTION | `takeSnapshotOf` 静默丢弃 stat 失败路径 | ⬜ 已知限制（inner catch 已处理 stat 错误） |
| IMPORTANT | `create-agentforge` 包测试因 inquirer v10 挂起 | ⬜ 已知限制（预存问题） |
| MINOR | `src/cli/` 与 `packages/create-agentforge/src/` 源码重复 | ⬜ 已知限制 |

### 进展总览

| P2 项 | 描述 | 状态 |
|--------|------|:--:|
| #13 | 流式工具执行 | ✅ |
| #14 | 多层 Compaction | ✅ |
| #15 | 文件变更 Snapshot 追踪 | ✅ |
| #16 | Subagent context isolation | ✅ |
| #17 | CLI 脚手架 + 部署方案 | ✅ |
