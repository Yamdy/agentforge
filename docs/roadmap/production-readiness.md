# AgentForge 生产就绪优先级清单

> 生成日期：2025-04-24
> 
> 本文档基于与 OpenCode、Agentscope、DeepAgents、Mastra 的架构对比分析，梳理 AgentForge 补齐能力的优先级需求。

---

## 评估基准

### 已有能力（无需重复造轮子）

| 模块 | 状态 | 说明 |
|------|------|------|
| Agent 类 + 状态机 | ✅ | `src/agent/agent.ts` - 完整的任务状态机 |
| ToolRegistry + 15 内置工具 | ✅ | `src/tools/` - bash/read/write/edit/glob/grep/task 等 |
| MemoryManager 接口设计 | ✅ | `src/memory/manager.ts` - MessageHistory + WorkingMemory + ObservationalMemory |
| Permission 系统 | ✅ | `src/permission/` - allow/deny/ask 三级权限 |
| Middleware 管道 | ✅ | `src/middleware/` - onion-style 中间件 |
| MCP 客户端 | ✅ | `src/mcp/` - stdio transport |
| Workflow 模块 | ✅ | `src/workflow/` - 基础工作流编排 |
| RxJS 流式处理 | ✅ | `runStream()` 返回 Observable - 独特优势 |

### 真正阻塞生产的问题

1. **重启丢数据** - 仅有 InMemoryStorage
2. **上下文溢出** - 长对话超过模型限制
3. **大输出崩溃** - 工具返回撑爆上下文

---

## P0 - 必须补齐（阻塞生产）

### 1. 存储层：SQLite 持久化

**做什么**：
- 实现 `SQLiteStorage` 类，满足现有 `MemoryStorage` 接口
- Thread、Message、WorkingMemory、AgentState 持久化到 SQLite
- 支持 session 跨进程共享

**为什么必须**：当前仅有 `InMemoryStorage`，进程重启数据全丢，生产不可用。

**产出文件**：`src/memory/storages/sqlite.ts`

**参考实现**：
- OpenCode: `packages/opencode/src/storage/db.ts` - Drizzle ORM + SQLite
- DeepAgents: `StateBackend` / `StoreBackend` 分离

**验收标准**：
- [ ] 实现 `MemoryStorage` 接口所有方法
- [ ] 支持基本的 CRUD 操作
- [ ] 数据库文件可配置路径
- [ ] 单元测试覆盖

**工作量**：1-2 天

---

### 2. 记忆管理：自动压缩

**做什么**：
- 当消息历史超过阈值（如 50k tokens），触发压缩
- 生成摘要替代旧消息
- 保留最近 N 条完整消息

**为什么必须**：长对话会超过模型上下文限制，导致 LLM 调用失败。

**产出文件**：`src/memory/compaction.ts`

**参考实现**：
- OpenCode: `packages/opencode/src/session/compaction.ts` - auto-compaction + summary
- Mastra: `Memory` processor-based 压缩

**验收标准**：
- [ ] Token 计数准确
- [ ] 超阈值自动触发
- [ ] 摘要质量可接受
- [ ] 压缩后上下文在限制内

**工作量**：1-2 天

---

### 3. 工具执行：大输出自动截断

**做什么**：
- 工具返回超过阈值时自动截断
- 截断内容写入临时文件
- 返回文件路径替代原内容

**为什么必须**：大文件读取、grep 结果等会撑爆上下文或超时。

**产出文件**：扩展现有 `src/truncate/truncate.ts`

**参考实现**：
- OpenCode: `packages/opencode/src/tool/truncate.ts` - Truncate.output() 自动包装
- AgentForge 已有 truncate 模块，需集成到工具执行层

**验收标准**：
- [ ] 工具返回自动检测大小
- [ ] 超阈值内容写入文件
- [ ] 返回路径 + 截断标记
- [ ] 用户可读取完整内容

**工作量**：0.5-1 天

---

## P1 - 应该补齐（影响稳定性）

### 4. Agent 生命周期：错误恢复增强

**做什么**：
- 工具执行失败后重试机制（可配置重试次数）
- LLM 调用超时处理
- 错误状态 checkpoint（失败可恢复）

**为什么重要**：网络抖动、LLM 服务波动是常态，需要容错。

**产出文件**：`src/agent/retry.ts`

**参考实现**：
- OpenCode: `packages/opencode/src/session/retry.ts`
- DeepAgents: `retry_middleware`

**验收标准**：
- [ ] 可配置重试次数和间隔
- [ ] 超时自动中断
- [ ] 错误状态可恢复

**工作量**：1 天

---

### 5. Provider：多模型故障转移

**做什么**：
- 支持 provider:model 字符串解析（如 `anthropic/claude-sonnet-4`）
- 支持模型故障转移数组（主模型失败自动切换备用）
- 基本的模型元数据（成本、上下文限制）

**为什么重要**：单点故障风险，生产需要降级能力。

**产出文件**：`src/provider/resolver.ts`

**参考实现**：
- DeepAgents: `resolve_model("openai:gpt-4o")`
- Mastra: `fallback` 数组支持

**验收标准**：
- [ ] 解析 provider:model 字符串
- [ ] 故障自动切换备用模型
- [ ] 元数据（成本/限制）可查询

**工作量**：1-2 天

---

### 6. Session：跨会话恢复

**做什么**：
- 支持通过 sessionId 恢复会话
- 恢复消息历史、工作记忆、Agent 状态
- Session fork/clone 能力

**为什么重要**：用户关闭终端后再打开需要继续。

**产出文件**：`src/session/recovery.ts`

**参考实现**：
- OpenCode: `packages/opencode/src/session/index.ts` - Session.fork()
- AgentForge 已有 session 模块基础

**验收标准**：
- [ ] 通过 ID 恢复完整状态
- [ ] Fork 创建独立副本
- [ ] 状态一致性保证

**工作量**：1 天

---

## P2 - 锦上添花（增强体验）

### 7. 子代理：任务委托优化

**做什么**：
- Task 工具传递精简上下文（非全量）
- 子代理完成后结果聚合
- 子代理错误不上送父代理

**为什么有价值**：复杂任务分解，避免单代理上下文爆炸。

**参考实现**：
- DeepAgents: `SubAgentMiddleware` + `PrivateStateAttr`
- OpenCode: `TaskTool` with task_id resume

**工作量**：1 天

---

### 8. Skills：渐进式披露

**做什么**：
- 技能文件仅加载 name + description
- Agent 决定读取时再加载完整内容
- 按需加载而非一次性全量注入

**为什么有价值**：减少 system prompt 膨胀。

**参考实现**：
- DeepAgents: SKILL.md 仅加载元数据

**工作量**：0.5 天

---

### 9. Permission：持久化规则

**做什么**：
- 用户 "always allow" 选择持久化到 SQLite
- 下次会话自动应用已授权规则
- 规则按 project/sl_capability 隔离

**为什么有价值**：用户不用反复确认相同权限。

**参考实现**：
- OpenCode: `packages/opencode/src/permission/index.ts` - PermissionTable

**工作量**：0.5-1 天

---

### 10. Workflow：条件分支增强

**做什么**：
- 支持 `.branch(condition, { true, false })`
- 支持 `.loop(condition, step)`
- 错误分支处理

**为什么有价值**：非顺序复杂流程编排。

**参考实现**：
- Mastra: workflow `.branch()` / `.loop()`

**工作量**：1-2 天

---

### 11. Plugin：Hook 细化

**做什么**：
- 补充 `beforeToolExecute` / `afterToolExecute`
- 补充 `onError` 全局错误钩子
- Hook 可修改/拦截工具参数和结果

**为什么有价值**：调试、日志、安全审计。

**参考实现**：
- Agentscope: 6 类 Hook (pre/post reply/observe/print)
- DeepAgents: `wrap_model_call` 拦截

**工作量**：0.5 天

---

## P3 - 可延后（非核心）

| 模块 | 内容 | 工作量 | 何时需要 |
|------|------|--------|----------|
| CLI TUI | 终端交互界面 | 3-5 天 | 需要独立产品时 |
| HTTP Server | REST API + SSE | 2-3 天 | 需要远程访问时 |
| Provider SDK 扩展 | 从 1 个到 5+ Provider | 2-3 天/Provider | 需要多模型支持时 |
| Effect-TS 迁移 | 架构重构 | 5-10 天 | 需要企业级 DI 时 |
| Semantic Memory | 向量检索 | 3-5 天 | 需要 RAG 时 |

---

## Sprint 规划

### Sprint 1（P0）— 目标：可用

```
Week 1:
├── 任务 1: SQLite 持久化存储（1-2天）
├── 任务 2: 记忆自动压缩（1-2天）
└── 任务 3: 大输出自动截断（0.5-1天）

交付物：
- 数据不丢失
- 长对话不崩溃
- 大输出不溢出
```

### Sprint 2（P1）— 目标：稳定

```
Week 2:
├── 任务 4: 错误恢复增强（1天）
├── 任务 5: 多模型故障转移（1-2天）
└── 任务 6: Session 跨会话恢复（1天）

交付物：
- 自动重试容错
- 模型切换降级
- 会话可恢复
```

### Sprint 3（P2）— 目标：体验

```
Week 3+: 按需选择
├── 任务 7: 子代理优化（1天）
├── 任务 8: Skills 渐进披露（0.5天）
├── 任务 9: Permission 持久化（0.5-1天）
├── 任务 10: Workflow 增强（1-2天）
└── 任务 11: Hook 细化（0.5天）
```

---

## 工作量汇总

| 优先级 | 必要性 | 模块数 | 总工作量 |
|--------|--------|--------|----------|
| **P0** | 不补无法生产 | 3 | 3-5 天 |
| **P1** | 影响稳定性 | 3 | 3-4 天 |
| **P2** | 体验提升 | 5 | 3-5 天 |
| **P3** | 可延后 | 5 | 10+ 天 |

**里程碑**：
- Sprint 1 完成 → 可用于生产（数据安全）
- Sprint 2 完成 → 生产稳定（容错降级）
- Sprint 3 完成 → 体验优秀（效率提升）

---

## 附录：参考项目架构对比

| 能力维度 | OpenCode | AgentForge（当前） | 差距 |
|---------|----------|-------------------|------|
| Agent 抽象 | Schema + Permission Ruleset | 类 + 状态机 | 可优化但不阻塞 |
| 工具定义 | Zod + Context + Truncate | 双接口 + 15 工具 | 需补截断 |
| Provider 支持 | 27+ Bundled SDK | 单一 Adapter | P1 增强 |
| 权限系统 | Ruleset + Deferred + 持久化 | Pattern-based | P2 增强 |
| 会话持久化 | SQLite + Event Sourcing | InMemory | **P0 阻塞** |
| 记忆压缩 | auto-compaction | 无 | **P0 阻塞** |

---

## 变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2025-04-24 | 初始版本 | Sisyphus |

