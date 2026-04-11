# primo-agent 高优先级问题修复设计

## 概述

基于项目全面检查，本次修复覆盖 20 项高优先级问题，分为 6 个修复域。

---

## 修复域 1：核心逻辑缺陷

### 1.1 history.ts 消息格式和顺序修复

**问题**：工具结果被标记为 `role: 'user'`（应为 `role: 'tool'`），消息顺序混乱（普通消息和工具结果分开返回），工具结果以文本格式注入丢失结构化信息。

**方案**：重写 `getMessages()` 方法：
- 维护统一的消息列表，按添加顺序返回
- 工具结果使用 `role: 'tool'`，包含 `toolCallId` 和 `toolName`
- 工具结果紧跟在对应的 assistant 消息之后
- 对 `Message` 类型扩展支持 `tool` 角色的额外字段

### 1.2 agent.ts done 事件重复触发修复

**问题**：`complete` 回调与 `done` 事件可能重复触发。

**方案**：使用 `resolved` 标志位确保 `done` 事件只发送一次，在 `complete` 回调中检查标志位后再发送。

### 1.3 agent.ts 文本片段合并到历史

**问题**：每个 `text` 事件都作为独立 assistant 消息添加到历史。

**方案**：在流式处理中累积文本内容，仅在 `done` 事件时将完整文本作为一条 assistant 消息添加到历史。

### 1.4 agent.ts 工具执行失败 span 记录位置修复

**问题**：`endSpan` 使用父 span 的 spanId 而非 toolSpan 的 spanId。

**方案**：将 `toolSpan.spanId` 传入 `endSpan` 调用。

### 1.5 plugin/manager.ts trigger/unregister 修复

**问题**：
- `trigger()` 不等待 hook 完成就返回 output
- `unregister()` 未取消 hook 订阅

**方案**：
- `trigger()` 改为 `async`，使用 `firstValueFrom` 等待 hook 处理完成后返回修改后的 output
- `unregister()` 中保存每个插件的 Subscription，注销时调用 `subscription.unsubscribe()`

### 1.6 delegation.ts catch 块回调异常覆盖原始错误

**方案**：在 catch 块中用 try-catch 包裹 `onDelegationComplete` 回调，回调异常仅记录日志，不覆盖原始错误。

### 1.7 memory/manager.ts save() 重复消息

**方案**：`save()` 方法先清空存储中的旧消息，再逐条添加，避免重复。

### 1.8 context.ts 全局状态并发不安全

**方案**：使用 `AsyncLocalStorage` 替代模块级全局变量，支持并发 Agent 运行。

---

## 修复域 2：架构冲突

### 2.1 AppError 重复定义合并

**方案**：以 `src/errors/` 为主，为 `AppError` 添加 `toJSON()` 方法。`src/server/error.ts` 改为从 `src/errors/` 重新导出，保持向后兼容。统一 `ValidationError` 使其支持 `errors` 数组。

### 2.2 Tracer 重复实现

**方案**：`src/tracer.ts` 改为从 `src/observability/tracer.ts` 重新导出，消除重复。全局 `tracer` 单例由 observability 模块提供。

---

## 修复域 3：安全问题

### 3.1 calculate.ts eval() 替换

**方案**：使用 `mathjs` 库的 `evaluate()` 函数替换 `eval()`，提供安全的数学表达式求值。

### 3.2 permissions/index.ts 正则注入和 ReDoS

**方案**：
- 对资源模式中的正则特殊字符进行转义（`escapeRegExp`）
- 仅将 `*` 替换为 `.*`
- 添加正则长度限制防止 ReDoS

### 3.3 auth.ts 时序攻击

**方案**：使用 `crypto.timingSafeEqual` 进行 API Key 比较。

### 3.4 server/index.ts 错误消息未转义

**方案**：使用 `JSON.stringify({ error: errorMsg })` 替代手动拼接 JSON 字符串。

### 3.5 bash.ts 无输出大小限制

**方案**：添加 `MAX_OUTPUT_LENGTH` 常量（默认 1MB），超过限制时截断并添加提示。

### 3.6 hitl.middleware.ts 自动批准

**方案**：将 `simulateUserApproval` 标记为开发模式专用，添加环境变量 `HITL_AUTO_APPROVE` 控制。生产模式下抛出错误提示需要实现真实的审批机制。

---

## 修复域 4：资源泄漏

### 4.1 storage/sqlite-memory.ts close() 异常处理

**方案**：使用 try-finally 确保 `this.db.close()` 始终执行，异常时将 `this.db` 置为 null。

### 4.2 cache/index.ts 过期条目清理

**方案**：添加 `cleanup()` 方法，在 `set` 和 `get` 时按概率触发清理（类似 GC），避免内存泄漏。

### 4.3 rate-limit.ts 限流 Map 内存泄漏

**方案**：添加定时清理逻辑，在每次请求时顺便清理过期条目。

---

## 修复域 5：跨平台兼容性

### 5.1 mcp/config.ts process.env.HOME

**方案**：使用 `os.homedir()` 替代 `process.env.HOME`。

### 5.2 skill/discovery.ts 换行符正则

**方案**：将 `\n` 替换为 `\r?\n`，支持 Windows 换行符。

---

## 修复域 6：构建与编译

### 6.1 src/examples/ 编译错误（10个）

**方案**：逐一修复示例文件中的类型错误，同步 API 变更。

### 6.2 tsup.config.ts 添加 external

**方案**：将 `package.json` 中的 dependencies 标记为 external，避免打包进产物。

### 6.3 any 类型消除

**方案**：将所有 `any` 替换为具体类型或 `unknown` + 类型守卫。涉及文件：
- config/loader.ts → `Record<string, unknown>`
- sdk/client.ts → 定义具体响应类型
- server/index.ts → 使用 Hono 的 Context 类型
- plugin/manager.ts → 定义 HookFunction 类型
- mcp/client.ts → 使用 MCP SDK 的 Transport 类型
- mcp/transport/*.ts → 定义 AuthProvider 接口
- skill/types.ts → `z.record(z.unknown())`
- config/schema.ts → `z.record(z.string(), z.unknown())`
- tools/builtin/*.ts → 定义 Args 类型接口

---

## 修复域 7：Workflow parallel 真正并行实现

参考 Mastra 的 `Promise.all` + 结果聚合模式：

### 设计

**DefaultExecutor 扩展**：
- 添加 `parallelSteps` 字段，存储并行步骤组
- `execute()` 中遇到并行组时使用 `Promise.all` 并行执行
- 结果以 `Record<stepId, output>` 聚合
- 错误策略：等所有步骤完成，任一失败则整体标记失败（参考 Mastra）

**WorkflowBuilder.parallel() 修改**：
- 将步骤注册为并行组而非顺序步骤
- `lastStepId` 设为并行组中最后一个步骤的 ID

**类型更新**：
- `ParallelOptions` 添加 `concurrency` 可选参数
- `StepFlowEntry` 联合类型支持 `{ type: 'parallel'; steps: StepNode[] }`
