# 最终实施计划

> 创建日期: 2026-04-29
> 状态: 待实施
> 目标: 补充 DeepAgents 特性 + 模板扩充

---

## 一、总览

### 1.1 实施范围

| 类别 | 模块 | 工作量 | 优先级 | 状态 |
|------|------|--------|--------|------|
| DeepAgents 特性 | 文件系统工具集 | 3.75 天 | P0 | 待实施 |
| DeepAgents 特性 | AGENTS.md 自动发现 | 2 天 | P0 | 待实施 |
| DeepAgents 特性 | TodoList 工具 | 3 天 | P1 | 待实施 |
| DeepAgents 特性 | Compiled/Async 子代理 | 3 天 | P1 | 待实施 |
| Mastra DX 特性 | 模板扩充 | 3 天 | P0 | 待实施 |
| **总计** | - | **14.75 天** | - | - |

### 1.2 不在本次实施范围

| 模块 | 原因 | 已有设计文档 |
|------|------|-------------|
| Dev Server | 与 `studio-design.md` Phase 0 重叠 80% | 合并到 `studio-design.md` |
| Studio UI | 与 `studio-design.md` Phase 2 重叠 90% | 合并到 `studio-design.md` |
| OTel Tracer | 与 `p2-capabilities-design-v2.md` 重叠 95% | 合并到 `p2-capabilities-design-v2.md` |
| Prometheus Metrics | 与 `p2-capabilities-design-v2.md` 重叠 95% | 合并到 `p2-capabilities-design-v2.md` |
| Agent Tracer | 与 `p2-capabilities-design-v2.md` 重叠 95% | 合并到 `p2-capabilities-design-v2.md` |

---

## 二、Phase 1: 文件系统工具集 (3.75 天)

### 2.1 目标

提供与 DeepAgents `FilesystemMiddleware` 等价的工具集，供 Agent 调用。

### 2.2 工具清单

| 工具 | 功能 | 参数 |
|------|------|------|
| `read_file` | 读取文件 | `{ path, offset?, limit? }` |
| `write_file` | 写入文件 | `{ path, content }` |
| `edit_file` | 搜索替换 | `{ path, search, replace }` |
| `ls` | 列出目录 | `{ path }` |
| `glob` | 模式匹配 | `{ pattern, path? }` |
| `grep` | 内容搜索 | `{ pattern, path?, include? }` |

### 2.3 关键设计决策

1. **沙箱安全**: `resolveSafePath()` + `isWithinRoot()` 防止路径穿越
2. **符号链接安全**: Phase 1 使用 `path.resolve`，Phase 2 增强使用 `fs.realpath`
3. **写入控制**: `writable` 配置标志控制写入权限

### 2.4 文件清单

| 文件 | 功能 |
|------|------|
| `src/tools/filesystem.ts` | 文件系统工具定义 |
| `src/tools/index.ts` | 工具导出 |
| `tests/tools/filesystem.spec.ts` | 测试文件 |

### 2.5 实施计划

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 1 | `read_file`, `write_file` 工具 | `src/tools/filesystem.ts` |
| Day 2 | `edit_file`, `ls` 工具 | 更新 `src/tools/filesystem.ts` |
| Day 3 | `glob`, `grep` 工具 | 更新 `src/tools/filesystem.ts` |
| Day 4 | 测试 + 文档 | `tests/tools/filesystem.spec.ts` |

---

## 三、Phase 2: AGENTS.md 自动发现 (2 天)

### 3.1 目标

增强现有 `MemoryPlugin`，支持自动发现并加载项目中的 `AGENTS.md` 文件。

### 3.2 关键设计决策

1. **向上遍历**: 从当前目录向上遍历，收集所有 `AGENTS.md` 文件
2. **反转顺序**: 根目录在前，当前目录在后，确保项目级指令覆盖全局指令
3. **向后兼容**: `autoDiscover` 为 `false` 时使用原来的 `memory.load(sources)` 逻辑

### 3.3 文件清单

| 文件 | 功能 |
|------|------|
| `src/memory/agents-md.ts` | AGENTS.md 自动发现 |
| `src/plugins/memory-plugin.ts` | 增强 MemoryPlugin |
| `tests/memory/agents-md.spec.ts` | 测试文件 |

### 3.4 实施计划

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 5 | `loadAgentsMd` 实现 | `src/memory/agents-md.ts` |
| Day 6 | 增强 MemoryPlugin | 更新 `src/plugins/memory-plugin.ts` |

---

## 四、Phase 3: TodoList 工具 (3 天)

### 4.1 目标

提供与 DeepAgents `TodoListMiddleware` 等价的工具，让 Agent 能够规划和跟踪任务。

### 4.2 关键设计决策

1. **工具+插件分离**: `createTodoListTool()` 提供操作，`TodoListPlugin` 注入状态
2. **状态存储**: TodoList 状态存储在 `AgentState` 中
3. **优先级**: Skills(5) → Memory(10) → TodoList(15) → Summarization(20)

### 4.3 文件清单

| 文件 | 功能 |
|------|------|
| `src/tools/todo-list.ts` | TodoList 工具定义 |
| `src/plugins/todo-list-plugin.ts` | TodoList 插件 |
| `tests/tools/todo-list.spec.ts` | 测试文件 |

### 4.4 实施计划

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 7 | TodoList 工具 | `src/tools/todo-list.ts` |
| Day 8 | TodoList 插件 | `src/plugins/todo-list-plugin.ts` |
| Day 9 | 测试 | `tests/tools/todo-list.spec.ts` |

---

## 五、Phase 4: Compiled/Async 子代理 (3 天)

### 5.1 目标

扩展 `SubagentRegistry`，支持预编译子代理和异步子代理。

### 5.2 关键设计决策

1. **Compiled 模式**: 预定义子代理配置，运行时直接使用
2. **Async 模式**: 子代理在后台执行，主 Agent 不等待结果
3. **结果注入**: `onComplete` 回调将结果注入主 Agent 消息历史
4. **Subscription 管理**: `runAsync` 中 subscription 存储到 `asyncRuns` Map

### 5.3 文件清单

| 文件 | 功能 |
|------|------|
| `src/subagent/types.ts` | 扩展类型定义 |
| `src/subagent/registry.ts` | 扩展注册表 |
| `tests/subagent/compiled.spec.ts` | Compiled 模式测试 |
| `tests/subagent/async.spec.ts` | Async 模式测试 |

### 5.4 实施计划

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 10 | 类型扩展 | 更新 `src/subagent/types.ts` |
| Day 11 | Compiled 模式 | 更新 `src/subagent/registry.ts` |
| Day 12 | Async 模式 | 更新 `src/subagent/registry.ts` |

---

## 六、Phase 5: 模板扩充 (3 天)

### 6.1 目标

从 2 个模板扩充到 6+，覆盖常见用例。

### 6.2 模板清单

| 模板 | 描述 | 复杂度 |
|------|------|--------|
| `chat-agent` | 简单对话 Agent | 低 |
| `tool-agent` | 带自定义工具的 Agent | 低 |
| `rag-agent` | 检索增强生成 | 中 |
| `multi-agent` | 编排器 + 工作者模式 | 中 |
| `mcp-agent` | MCP 连接的 Agent | 中 |
| `production-agent` | 完整 MPU 栈 | 高 |

### 6.3 关键设计决策

1. **模板结构**: `base/` + `features/` + `examples/` 三层结构
2. **模板元数据**: `template.json` 定义复杂度、类别、特性、依赖模块
3. **JSDoc 类型注解**: 每个模板的 `agentforge.config.ts` 添加类型提示

### 6.4 文件清单

| 文件 | 功能 |
|------|------|
| `packages/create-agentforge/templates/examples/chat-agent/` | Chat Agent 模板 |
| `packages/create-agentforge/templates/examples/tool-agent/` | Tool Agent 模板 |
| `packages/create-agentforge/templates/examples/rag-agent/` | RAG Agent 模板 |
| `packages/create-agentforge/templates/examples/multi-agent/` | Multi-Agent 模板 |
| `packages/create-agentforge/templates/examples/mcp-agent/` | MCP Agent 模板 |
| `packages/create-agentforge/templates/examples/production-agent/` | Production Agent 模板 |
| `packages/create-agentforge/templates/template.json` | 模板注册表 |

### 6.5 实施计划

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 13 | chat-agent, tool-agent 模板 | 2 个模板目录 |
| Day 14 | rag-agent, multi-agent 模板 | 2 个模板目录 |
| Day 15 | mcp-agent, production-agent 模板 | 2 个模板目录 |

---

## 七、设计文档合并计划

### 7.1 合并到 studio-design.md

| 来源 | 内容 | 合并位置 |
|------|------|---------|
| 当前文档 §3 Dev Server | Hono 适配器 | `studio-design.md` Phase 0-1 |
| 当前文档 §4 Studio UI | Vue SPA 组件 | `studio-design.md` Phase 2 |
| 当前文档 §4 SSE Client | useSSE composable | `studio-design.md` @agentforge/client |

### 7.2 合并到 p2-capabilities-design-v2.md

| 来源 | 内容 | 合并位置 |
|------|------|---------|
| 当前文档 §5 OTel Tracer | OtelTracerImpl | `p2-capabilities-design-v2.md` Phase 1 |
| 当前文档 §5 PrometheusMetrics | PrometheusMetricsCollector | `p2-capabilities-design-v2.md` Phase 1 |
| 当前文档 §5 Agent Tracer | createAgentTracer | `p2-capabilities-design-v2.md` Phase 1 |

---

## 八、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 文件系统工具符号链接攻击 | 中 | Phase 2 增强使用 `fs.realpath` |
| AGENTS.md 内容过大 | 低 | Token 估算 + 截断 |
| TodoList 状态持久化 | 低 | 存储在 AgentState 中 |
| Async 子代理复杂性 | 中 | 先实现基础版本，后续迭代 |
| 模板维护成本 | 低 | 使用 Handlebars 模板，共享基础模板 |

---

## 九、验收标准

### 9.1 文件系统工具

```bash
# 测试文件系统工具
npx vitest run tests/tools/filesystem.spec.ts

# 验证安全检查
# - 路径穿越被阻止
# - 符号链接攻击被阻止 (Phase 2)
# - 写入权限控制生效
```

### 9.2 AGENTS.md 自动发现

```bash
# 测试 AGENTS.md 加载
npx vitest run tests/memory/agents-md.spec.ts

# 验证功能
# - 自动发现 AGENTS.md 文件
# - 向上遍历目录
# - 反转顺序正确
```

### 9.3 TodoList 工具

```bash
# 测试 TodoList 工具
npx vitest run tests/tools/todo-list.spec.ts

# 验证功能
# - create/update/list/clear 操作
# - 状态持久化
# - 插件注入正确
```

### 9.4 Compiled/Async 子代理

```bash
# 测试子代理
npx vitest run tests/subagent/compiled.spec.ts
npx vitest run tests/subagent/async.spec.ts

# 验证功能
# - Compiled 模式创建和运行
# - Async 模式异步执行
# - 结果注入主 Agent
# - subscription 管理
```

### 9.5 模板扩充

```bash
# 测试模板生成
npx create-agentforge test-agent --template chat-agent
npx create-agentforge test-agent --template tool-agent

# 验证功能
# - 模板正确生成
# - 依赖正确安装
# - TypeScript 编译通过
```

---

## 十、相关文档

| 文档 | 路径 | 用途 |
|------|------|------|
| DeepAgents 特性设计 | `docs/plans/deepagents-features-design.md` | 详细设计文档 |
| Mastra DX 特性设计 | `docs/plans/mastra-dx-features-design.md` | 详细设计文档 |
| Studio 设计 | `docs/specs/studio-design.md` | Studio UI 设计 |
| P2 能力设计 | `docs/plans/p2-capabilities-design-v2.md` | OTel/Metrics 设计 |
| Studio Phase 0 | `docs/plans/2026-04-27-studio-phase0.md` | SSE Bridge 计划 |
