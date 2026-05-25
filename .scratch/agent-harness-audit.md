# Agent Harness Construction — 全维度审查报告

**日期**: 2026-05-25  
**范围**: AgentForge monorepo, 全部 packages  
**框架**: Agent Harness Construction 技能（7个维度）

---

## 摘要

AgentForge 是一个架构良好的 Agent 框架，在流水线设计、错误分类和可观测性方面基础扎实。但本次审查在 7 个维度上发现 **12 个问题** —— 3 个严重、5 个显著、4 个轻微（3 个严重已修复）。影响最大的问题是：~~工具命名规范不一致~~、~~缺少循环内上下文压缩~~、~~ProcessorResult 缺少观察标准字段~~。

| 维度 | 评级 | 严重 | 显著 | 轻微 |
|------|------|------|------|------|
| 1. 动作空间设计 | A- | 0 | 1 | 1 |
| 2. 粒度规则 | A- | 0 | 1 | 0 |
| 3. 观察设计 | B+ | 0 | 1 | 0 |
| 4. 错误恢复 | A | 0 | 0 | 1 |
| 5. 上下文预算 | B- | 1 | 1 | 1 |
| 6. 架构模式 | A | 0 | 0 | 1 |
| 7. 反模式 | B | 0 | 1 | 0 |

---

## 维度一：动作空间设计 — 评级 B

### ✅ 优势

1. **Schema 优先的输入**：全部 15 个工具使用 Zod schema。`ToolRegistry.executeTool()` 在执行前通过 `safeParse()` 验证 —— 在早期以结构化错误信息拒绝无效输入。
2. **确定性输出形状**：11/15 个工具返回完全确定性的类型化对象（如 calculator 返回 `{ result: number; expression: string }`）。泛型参数 `Tool<TInput, TOutput>` 提供编译时安全。
3. **审批门控**：三个高风险工具（`file_edit`、`file_write`、`shell`）设置了 `requireApproval: true`。
4. **MCP 命名空间**：MCP 工具使用 `serverName__` 前缀，防止跨服务器冲突。
5. **输出截断**：`truncateOutput()` 强制执行 `maxOutputLength` 限制，对非字符串输出使用结构化的 `{ truncated: true, preview: ... }`。

### ✅ 已修复：工具命名不一致（F-1）— 2026-05-25

**原问题**：16 个工具名称中存在三种不同命名规范（lowercase / camelCase / snake_case）。

**修复方案**：将 3 个 camelCase 工具的 `name` 字段统一为 snake_case，导出变量名保留 camelCase 遵循 JavaScript 惯例。两层命名服务于不同受众：

| 层面 | 规范 | 受众 | 示例 |
|------|------|------|------|
| `name` 字段 | snake_case | LLM（AI 面向） | `file_read`, `web_search` |
| 导出变量名 | camelCase | 开发者（人类面向） | `fileReadTool`, `webSearchTool` |

**具体变更**：

| 旧 `name` | 新 `name` | 导出名（不变） |
|-----------|-----------|---------------|
| `fileRead` | `file_read` | `fileReadTool` |
| `fileWrite` | `file_write` | `fileWriteTool` |
| `fileEdit` | `file_edit` | `fileEditTool` |

**TDD 验证**：新增 `tool-naming-convention.test.ts`，4 个测试用例覆盖 snake_case 正则校验、精确名称列表、camelCase 排除、分类校验。全量 2261 测试用例零回归。

### 🟡 显著：json 工具 `parse`/`stringify` 语义重复（F-2）

`json` 工具的 `parse` 和 `stringify` 操作功能完全相同 —— 都是解析输入并美化输出。这为 LLM 创建了令人困惑的动作空间。

**建议**：移除 `stringify` 操作，或使其真正执行非 JSON 输入的序列化（如 JS 对象字面量 → JSON）。

### 🔵 轻微：`shell` 工具输入模式过于宽泛（F-3）

`shell` 只接受一个无类型的 `command: z.string()`。虽然 `requireApproval: true` 缓解了风险，但 schema 未为 LLM 提供关于有效命令的结构化提示。

**建议**：考虑添加可选的 `workingDirectory` 和 `timeout` 字段，为 LLM 提供更结构化的控制。

---

## 维度二：粒度规则 — 评级 A-

### ✅ 优势

1. **高风险操作使用微工具**：`file_edit`（通过 `oldString`/`newString` 精确匹配）和 `file_write`（带 `requireApproval`）对破坏性操作粒度适当。
2. **常用循环使用中等工具**：`file_read`、`glob`、`grep` 提供范围明确的读/搜索能力。
3. **审批要求与风险成比例**：仅写入/执行工具需要审批；只读工具无限制。
4. **适配器门控**：`permission()`、`quota()`、`cost()` 门控为 LLM 调用提供微观级别控制 —— 对预算/成本管理的粒度适当。

### 🟡 显著：`http` 工具作为准宏工具（F-4）

`http` 工具在一个工具中处理所有 HTTP 方法（GET/POST/PUT/PATCH/DELETE）。虽然 `method` 枚举约束了操作，但单一工具同时覆盖安全读取（GET）和破坏性写入（DELETE）。LLM 必须正确指定方法 —— 方法选择错误可能造成破坏。

**建议**：拆分为 `httpRead`（仅 GET，无需审批）和 `httpWrite`（POST/PUT/PATCH/DELETE，`requireApproval: true`），或根据方法有条件添加 `requireApproval: true`。

---

## 维度三：观察设计 — 评级 C+

### ✅ 优势

1. **丰富的 StreamEvent 分类**：17+ 事件类型，覆盖文本增量、阶段生命周期、工具执行、内容块、会话生命周期和权限流程。
2. **结构化错误字段**：`ToolResult` 包含 `error`、`truncated`、`mutated`、`validationError` —— 均为观察相关字段。
3. **HarnessDecisionRecorder**：集中记录 `allow/block/warn/queue` 决策，包含处理器名、阶段、原因和时间戳。
4. **Span 属性**：跨所有 span 使用标准化键（`tokens.input/output`、`cost.estimated`、`model.name`、`tool.name`）。

### ✅ 已修复：ProcessorResult 缺少观察字段（F-5）— 2026-05-25

**原问题**：处理器返回 `Promise<PipelineContext | void>` —— 返回类型中 **没有 `status`、`summary`、`next_actions` 或 `artifacts`**。

**修复方案**：

1. **新增 `ProcessorResult` 接口**（SDK）：包含 `status`（success/warning/error）、`summary`（字符串描述）、`nextActions?`（建议下一步）、`artifacts?`（命名引用如文件路径/ID）四个字段。
2. **更新 `Processor.execute()` 返回类型**：`Promise<ProcessorResult | PipelineContext | void>` —— 向后兼容，void 和 PipelineContext 仍然合法。
3. **内置处理器全部返回 `ProcessorResult`**：processInput、prepareStep、invokeLLM、processStepOutput、executeTools、evaluateIteration、compressContext 均返回结构化结果。
4. **适配器返回 `ProcessorResult`**：modifiers（message/systemPrompt/tools/providerOptions）和 gates（permission/quota/cost）均返回结构化结果。
5. **PipelineRunner 集成**：`executeStage()` 检测 ProcessorResult 并发射两种事件：
   - `processor_result` StreamEvent（流式 API 可观察）
   - `processor:result` EventBus 事件（插件可订阅）
6. **Agent 注入 EventBus**：`setEventBus()` 方法连接 PipelineRunner 与 PluginManager 的事件总线。

**变更文件**：

| 文件 | 变更 |
|------|------|
| `packages/sdk/src/index.ts` | 新增 `ProcessorResult` 接口；更新 `Processor.execute()` 返回类型；新增 `processor_result` StreamEvent |
| `packages/core/src/pipeline.ts` | `executeStage()` 解包 ProcessorResult；发射 StreamEvent + EventBus 事件；`isProcessorResult()` 类型守卫；`setEventBus()` 方法 |
| `packages/core/src/processors/process-input.ts` | 返回 ProcessorResult |
| `packages/core/src/processors/prepare-step.ts` | 返回 ProcessorResult |
| `packages/core/src/processors/invoke-llm.ts` | 返回 ProcessorResult |
| `packages/core/src/processors/process-step-output.ts` | 返回 ProcessorResult |
| `packages/core/src/processors/execute-tools.ts` | 返回 ProcessorResult（含 artifacts） |
| `packages/core/src/processors/evaluate-iteration.ts` | 返回 ProcessorResult（含 nextActions） |
| `packages/core/src/processors/compress-context.ts` | 返回 ProcessorResult |
| `packages/core/src/adapters/modifiers.ts` | 四个 modifier 返回 ProcessorResult |
| `packages/core/src/adapters/gates.ts` | 三个 gate 返回 ProcessorResult |
| `packages/core/src/agent.ts` | 注入 EventBus 到 PipelineRunner |

**TDD 验证**：20 个新测试用例覆盖接口结构、所有 status 值、void 兼容性、PipelineRunner 事件发射、EventBus 集成、7 个内置处理器、4 个 modifier、3 个 gate。全量 1479 核心测试零回归。

处理器返回 `Promise<PipelineContext | void>` —— 返回类型中 **没有 `status`、`summary`、`next_actions` 或 `artifacts`**。Harness 技能要求每个工具/处理器响应包含这四个字段。执行结果通过间接方式传达：
- `loopDirective`（continue/stop/retry）—— 隐式状态
- `HarnessDecision` 包 —— 分散在 `session.custom` 中
- `RunResult` 类型判别 —— 仅在流水线级别

这使得编排 Agent（或调试人员）在不具备深层上下文知识的情况下，很难理解每个处理器做了什么。

**建议**：引入 `ProcessorResult` 接口：
```typescript
interface ProcessorResult {
  status: 'success' | 'warning' | 'error';
  summary: string;
  nextActions?: string[];
  artifacts?: Record<string, string>; // 文件路径、ID
  context?: PipelineContext; // 如有变更
}
```

### 🟡 显著：工具结果缺少 `next_actions`（F-6）

`ToolResult` 只有 `{ output, error?, mutated?, truncated?, validationError? }`，没有 `next_actions` 或 `summary`。LLM 必须仅从原始 `output` 推断下一步操作。例如 `grep` 返回 `{ matches, count }` 但不会建议 "使用 file_read 查看匹配项" 或 "细化模式以减少结果"。

**建议**：在 `ToolResult` 中添加可选的 `suggestedActions?: string[]`。`grep` 和 `glob` 类工具受益最大。

---

## 维度四：错误恢复 — 评级 A

### ✅ 优势

1. **类型化错误层级**：`AgentForgeError` → `RecoverableError` / `FatalError`，包含 `code`、`recoverable`、`retryCount`、`maxRetries`。清晰的分类支持差异化处理。
2. **5 层重试系统**：
   - LLMInvoker：指数退避（3 次重试，1 秒基数）
   - 客户端 SDK：对 429/502/503/504 线性退避
   - 兼容规则：反应式修复 + 重试（最多 3 次）
   - 处理器重试：持久化 `RetryStateStore`（每阶段 3 次）
   - FallbackRunner：有序模型降级，带延迟追踪
3. **熔断器**：closed → open → half_open 三态，可配置阈值/重置时间。与 LLMInvoker 重试集成。
4. **显式停止条件**：`abort(reason, retryFrom?)`、`suspend()`、`error()`、`loopDirective: 'stop'`、AbortSignal、token 上限、成本上限。
5. **丰富的错误消息**：包含根因提示（`"Cost cap exceeded: $0.0523 > $0.0500"`）、工具名（`"Tool \"name\" not found"`）、验证详情。

### 🔵 轻微：ToolExecutionError 缺少重试指导（F-7）

`ToolExecutionError` 是 `RecoverableError`（`recoverable: true`），但错误消息不包含 **安全重试指引**（如 "使用不同参数重试" vs "延迟后重试"）。框架知道错误可恢复，但未传达 *如何* 恢复。

**建议**：在 `RecoverableError` 基类添加 `retryHint?: string`。各工具可填充上下文相关的指导。

---

## 维度五：上下文预算 — 评级 B-

### ✅ 优势

1. **Token 计数**：`TiktokenCounter` 支持模型特定编码（o200k_base、cl100k_base）。包含每条消息的开销计算。
2. **技能渐进式披露**：仅内联名称 + 描述；完整内容通过 `read_skill` 工具调用加载。教科书级的引用替代内联模式。
3. **多级预算强制**：ContextBuilder（128K）、evaluateIteration（100K 总计）、TokenBudgetProcessor 插件（gateLLM 阶段）。
4. **结构化压缩**：插件支持 truncate → summarize → prune 流水线，含基于 LLM 的摘要。

### ✅ 已修复：无循环内上下文压缩（F-8）— 2026-05-25

**原问题**：`ContextBuilder.trimHistory()` 仅在 `buildContext` 阶段（循环前）运行一次。随着 Agent 循环推进和消息累积，不会重新压缩。长时间运行的 Agent 可能在执行中途超出上下文限制。

**修复方案**：

1. **新增 `compressContext` 流水线阶段**：插入默认循环阶段列表，位于 `executeTools` 之后、`evaluateIteration` 之前。每次迭代自动检查并压缩上下文。
2. **`ContextBuilder.compressIfNeeded()` 公共方法**：包装原 `trimHistory()` 私有方法，使处理器可调用。
3. **`createCompressContextProcessor()` 处理器**：执行压缩检查，当历史超出预算时应用配置的压缩策略，并发射 `context:compressed` 事件。
4. **`tokenBudgetOverrun` 标志连接**：`TokenBudgetProcessor` 的 `compress` 策略设置 `tokenBudgetOverrun` 标志后，`compressContext` 处理器读取并强制触发压缩（即使正常预算检查通过），处理后清除标志。
5. **`PipelineStage` / `BuiltinProcessorName` 类型扩展**：`compressContext` 加入 SDK 类型定义。

**变更文件**：
| 文件 | 变更 |
|------|------|
| `packages/core/src/context-builder.ts` | 新增 `compressIfNeeded()` 公共方法 |
| `packages/core/src/processors/compress-context.ts` | 新建：`createCompressContextProcessor()` |
| `packages/core/src/processors/index.ts` | 导出新处理器 |
| `packages/core/src/loop-orchestrator.ts` | 默认循环阶段添加 `compressContext` |
| `packages/core/src/agent.ts` | 注册处理器，注入 contextBuilder + eventBus |
| `packages/sdk/src/index.ts` | `PipelineStage` / `BuiltinProcessorName` 添加 `compressContext` |

**TDD 验证**：12 个测试用例覆盖 compressIfNeeded、处理器创建、压缩触发、事件发射、tokenBudgetOverrun 标志响应。全量测试零回归。

### 🟡 显著：双 Token 上限无协调（F-9）

存在两个独立上限：
- `ContextBuilder`：128,000 `maxTokens`（每次调用的上下文预算）
- `evaluateIteration`：100,000 `maxTotalTokens`（累计循环预算）

两者目的不同但可能冲突。如果 ContextBuilder 允许每次 128K，而循环上限累计 100K，则第一次 LLM 调用就可能耗尽整个循环预算。两者之间没有协调机制。

**建议**：从上下文预算推导循环预算，或强制执行每迭代的 token 限制（如 `maxIterationTokens = maxTotalTokens / maxIterations`）。

### 🔵 轻微：处理器即时加载（F-10）

所有处理器在 Agent 构造时就解析和注册。对于有多个插件的 Agent，即使某些阶段永远不会被执行，也会将所有处理器代码加载到内存中。

**建议**：考虑对插件处理器延迟解析 —— 在首次阶段执行时解析。

---

## 维度六：架构模式 — 评级 A

### ✅ 优势

1. **清晰的混合架构**：结构化确定性流水线（非经典 ReAct）配合迭代工具使用循环。每次迭代有固定阶段 —— 编排器根据 LLM 是否调用工具来确定性决定 continue/stop。
2. **函数调用 + 迭代循环**：LLM 产生工具调用 → 编排器执行 → 结果回传。无 "thought/observation/action" 提示 —— 更清晰、更可靠。
3. **三层动作空间**：Processor（修改上下文）、Hook（拦截/拒绝/变更）、Event（仅观察）。关注点分离清晰。
4. **流水线即数据**：`LoopOrchestrator` 阶段数组 + `PipelineStageConfig` 支持数据化流程配置。
5. **状态机守卫**：`pending → running → completed|paused|cancelled|error`，强制有效转换。

### 🔵 轻微：无 ReAct 规划层（F-11）

架构纯粹是反应式的 —— LLM 基于完整消息历史逐步决定下一步。没有明确的规划阶段让 Agent 在行动前推理整体方案。对于复杂多步任务，可能导致游移不定的行为。

**建议**：考虑在 `buildContext` 或 `prepareStep` 添加可选的 `planStep`，在首次迭代前生成结构化计划（目标分解）。可作为插件处理器实现。

---

## 维度七：反模式 — 评级 B

### ✅ 未发现的反模式（良好）

1. **无不透明全能工具**：每个工具有明确的作用域。最接近的是 `shell`，但其受 `requireApproval` 门控。
2. **无纯错误输出**：即使出错，`ToolResult` 也包含 `name`、`toolCallId` 和 `output`，以及 `error`。
3. **工具间无隐式耦合**：工具不依赖彼此的输出格式。
4. **EventBus 错误隔离**：处理器故障被单独捕获 —— 一个故障监听器不会破坏流水线。

### 🟡 显著：PipelineContext 可变共享状态（F-12）

`PipelineContext` 通过引用传递给所有处理器。任何处理器都可以修改任何区域（`agent`、`iteration`、`session`）。虽然这在流水线模式中是故意的，但存在风险：

- **顺序依赖行为**：读取 `session.custom` 的处理器可能因先执行的处理器不同而得到不同结果。
- **意外修改**：插件处理器可能意外覆盖另一个处理器设置的数据。
- **调试困难**：没有深层 span 检查，修改难以追踪。

`SimpleProcessorContext` 包装器提供读取访问，但不能阻止通过底层 `state` 引用进行修改。

**建议**：
1. 为 PipelineContext 添加修改追踪 —— 记录哪个处理器修改了哪个字段。
2. 考虑为 `session.custom` 添加命名空间隔离（强制使用点分隔前缀如 `plugin.memory.*`）。
3. 添加 `freeze()` / `deepFreeze()` 工具，供只读处理器使用。

---

## 发现汇总表

| 编号 | 维度 | 严重性 | 发现 | 改造工作量 | 状态 |
|------|------|--------|------|------------|------|
| F-1 | 动作空间 | ~~🔴 严重~~ | ~~工具命名：3种规范混用~~ | ~~中~~ | ✅ 已修复 2026-05-25 |
| F-2 | 动作空间 | 🟡 显著 | json 工具 parse/stringify 语义重复 | 低 |
| F-3 | 动作空间 | 🔵 轻微 | shell 工具无类型输入 schema | 低 |
| F-4 | 粒度规则 | 🟡 显著 | http 工具混合安全+破坏性方法 | 中 |
| F-5 | 观察设计 | ~~🔴 严重~~ | ~~ProcessorResult 缺少 status/summary/next_actions/artifacts~~ | ~~高~~ | ✅ 已修复 2026-05-25 |
| F-6 | 观察设计 | 🟡 显著 | ToolResult 缺少 next_actions 字段 | 中 |
| F-7 | 错误恢复 | 🔵 轻微 | RecoverableError 缺少重试指引 | 低 |
| F-8 | 上下文预算 | ~~🔴 严重~~ | ~~无循环内压缩 —— 仅有循环前压缩~~ | ~~高~~ | ✅ 已修复 2026-05-25 |
| F-9 | 上下文预算 | 🟡 显著 | 双 token 上限（128K vs 100K）无协调 | 中 |
| F-10 | 上下文预算 | 🔵 轻微 | 处理器即时加载浪费内存 | 低 |
| F-11 | 架构模式 | 🔵 轻微 | 无可选 ReAct 规划层 | 中 |
| F-12 | 反模式 | 🟡 显著 | PipelineContext 可变共享状态无追踪 | 中 |

---

## 优先建议

### 立即执行（高影响，合理工作量）

1. ~~**F-1**：统一工具命名为 `snake_case`~~ ✅ 已修复 2026-05-25（`name` 字段统一 snake_case，导出名保留 camelCase）
2. ~~**F-8**：在 `executeTools` 阶段后添加内置循环内压缩检查~~ ✅ 已修复 2026-05-25（新增 `compressContext` 阶段，`compressIfNeeded()` 公共方法，`tokenBudgetOverrun` 标志连接）
3. ~~**F-5**：引入 `ProcessorResult` 接口，包含 `status`/`summary`/`nextActions`/`artifacts`~~ ✅ 已修复 2026-05-25（新增 `ProcessorResult` 接口，8 个内置处理器 + 7 个适配器返回结构化结果，PipelineRunner 发射 processor_result 流事件 + processor:result EventBus 事件）

### 短期执行（中等影响）

4. **F-9**：协调 ContextBuilder 预算与 evaluateIteration 上限
5. **F-4**：拆分 `http` 为读/写或添加条件 `requireApproval`
6. **F-6**：在 `ToolResult` 添加 `suggestedActions` 为 LLM 提供指引
7. **F-12**：为 `PipelineContext` 添加修改追踪和命名空间隔离

### 长期规划（锦上添花）

8. **F-2**：修复或移除 `json` 的 stringify 操作
9. **F-11**：添加可选规划阶段作为插件处理器
10. **F-7**：为 `RecoverableError` 添加 `retryHint`
11. **F-3**：丰富 `shell` 工具 schema，添加可选结构化字段
12. **F-10**：插件处理器延迟加载，在首次阶段执行时解析
