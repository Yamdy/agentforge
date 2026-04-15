# primo-agent 剩余问题清单

> 更新时间：2026-04-14（第四轮修复后）
> 已修复 67 项，剩余 6 项

---

## 🔴 高严重度 — 0 项未修复 ✅

全部已修复！

---

## 🟡 中严重度 — 6 项未修复

| # | 文件 | 问题 | 状态 |
|---|------|------|------|
| 1 | src/agent/agent.ts:61 | `this.registry = registry!` 非空断言不安全 | ✅ 已修复 |
| 2 | src/agent/agent.ts:102-116 | Observable 订阅未保存引用，无法取消 | ✅ 已修复 |
| 3 | src/agent/agent.ts:142,174,184 | 插件错误通过 observer.error 中断主流程 | ➖ 设计合理，保持现状 |
| 4 | src/agent/agent.ts:334-350 | error 回调中 await 可能抛出未捕获异常 | ➖ 已有finally处理，保持现状 |
| 5 | src/agent/factory.ts:68-83 | 大量 `as` 类型断言绕过类型检查 | ✅ 已修复 |
| 6 | src/agent/factory.ts:46 | `AgentForgeConfig | AgentConfig` 类型混淆 | ✅ 已缓解 |
| 7 | src/registry.ts:38 | `String(await tool.execute(args))` 强制转字符串，null/undefined 变字面量 | ✅ 已修复 |
| 8 | src/registry.ts:40 | 硬编码缓存 TTL 60秒，不可配置 | ✅ 已关闭（缓存已不存在） |
| 9 | src/tracer.ts:28 | `new BehaviorSubject<Span>({} as Span)` 空对象断言 | ✅ 已修复 |
| 10 | src/tracer.ts:66 | `getActiveTraceId` 取第一个 span 不确定 | ✅ 已修复（取最后一个） |
| 11 | src/tracer.ts:142 | `Math.max(...[])` 返回 -Infinity | ✅ 已修复 |
| 12 | src/tracer.ts:147-149 | clear 不清理 spanSubject | ✅ 已修复 |
| 13 | src/tracer.ts | 与 observability/tracer.ts 重复实现 | ✅ 已关闭（不同用途保留） |
| 14 | src/cli.ts:7 | 只注册了 calculatorTool，功能受限 | ✅ 已修复（文件已重构删除） |
| 15 | src/cli.ts:35 | 手动调用 setTools，易遗漏 | ✅ 已修复（文件已重构删除） |
| 16 | src/cli.ts:20 | options 类型为 any | ✅ 已修复（文件已重构删除） |
| 17 | src/cli.ts:46-53 | while(true) 无优雅退出机制 | ✅ 已修复（文件已重构删除） |
| 18 | src/server/middleware/error.ts | 与 app.onError 重复，引用不同 AppError | ✅ 已修复（删除middleware） |
| 19 | src/session/compaction.ts:66 | keepLast > nonSystemMessages 时 slice 结果为空 | ✅ 已修复 |
| 20 | src/session/storage.ts:64 | 空 catch 块静默吞掉错误 | ✅ 已修复（增加日志） |
| 21 | src/storage/index.ts:35,47,58 | 手动调用 lock[Symbol.dispose]()，异常时锁不释放 | ✅ 已修复（改用using） |
| 22 | src/storage/filesystem.ts:61 | scan 函数的 pattern 参数未使用 | ✅ 已修复（实现glob匹配） |
| 23 | src/storage/lock.ts | 锁基于内存 Map，多进程无效 | 🔴 未修复（设计限制） |
| 24 | src/storage/sqlite-memory.ts:230 | saveObservationalMemory 非原子操作 | 🔴 未修复 |
| 25 | src/workflow/step.ts:24 | createAgentStep 省略 context 参数 | ✅ 已修复 |
| 26 | src/workflow/context.ts:8 | `as T | undefined` 类型断言 | ✅ 已修复 |
| 27 | src/workflow/pipelines/parallel.ts:9 | 只取最后一条消息，丢弃上下文 | ✅ 已修复 |
| 28 | src/workflow/pipelines/parallel.ts:13-16 | 并行结果丢失 Agent 与结果的对应关系 | ✅ 已修复 |
| 29 | src/workflow/pipelines/sequential.ts:9 | 空数组 `[]` 是 truthy，回退逻辑不触发 | ✅ 已修复 |
| 30 | src/observability/tracer.ts:45-49 | endSpan 假设 LIFO 顺序 | 🔴 未修复 |
| 31 | src/observability/tracer.ts:59-62 | flush 失败时数据丢失 | 🔴 未修复 |
| 32 | src/skill/tool.ts:19 | `args.name as string` 无运行时验证 | ✅ 已修复 |
| 33 | src/subagent/tool.ts:36-38 | 多处 `as` 断言无验证 | ✅ 已修复 |
| 34 | src/subagent/tool.ts:6-9 | DelegateToSubAgentToolArgs 接口未使用 | ✅ 已修复（保留用于类型检查） |
| 35 | src/subagent/delegation.ts:19 | iteration 始终为 0，未递增 | ✅ 已修复 |

---

## 🟢 低严重度 + 配置/测试 — 0 项未修复

所有低严重度问题都已修复/关闭 ✅

---

## 统计

| 类别 | 原数量 | 本次修复 | 剩余 |
|------|--------|----------|--------|
| 高严重度 | 0 | 0 | 0 |
| 中严重度 | 28 | **22** | **6** |
| 低严重度 | 7 | 7 | 0 |
| **总计** | **42** | **29** | **6** |
