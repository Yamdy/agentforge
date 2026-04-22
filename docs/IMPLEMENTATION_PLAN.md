# AgentForge 补齐执行计划

**目标**：将当前实现（80% 对标度）提升至 100% 符合 DESIGN.md

---

## 开发铁律重申

每个任务必须遵守：

- **CLI 优先** - 每个功能都要有 CLI 入口，可直接验证
- **每步必验证** - `pnpm typecheck`、`pnpm lint`、`pnpm test:run` 必须全通过
- **真实示例验证** - 必须执行 `examples/` 下相关真实示例验证功能
- **TDD 优先** - 先写测试，再写实现
- **小步提交** - 每次只做一件事，提交信息清晰
- **提交前 self-review** - 代码符合风格、无调试代码、验证通过
- **Effect-TS 优先** - 严格使用 v4.0 API，无裸 Promise
- **类型安全** - 无 `any` 滥用，100% TypeScript 正确
- **无警告** - 无 ESLint 警告

### Examples 目录可用验证示例

| 示例文件 | 验证功能 | 运行命令 |
| --------- | --------- | --------- |
| `tool-call-demo.ts` | 工具调用 | `cd examples && pnpm tsx tool-call-demo.ts` |
| `mock-tool-call-demo.ts` | Mock 工具调用流程 | `cd examples && pnpm tsx mock-tool-call-demo.ts` |
| `memory-demo.ts` | Memory 系统 | `cd examples && pnpm tsx memory-demo.ts` |
| `memory-features-demo.ts` | Memory 高级特性 | `cd examples && pnpm tsx memory-features-demo.ts` |
| `persistence-demo.ts` | 持久化存储 | `cd examples && pnpm tsx persistence-demo.ts` |
| `persistence-only-demo.ts` | 纯持久化 | `cd examples && pnpm tsx persistence-only-demo.ts` |
| `skill-demo.ts` | Skill 系统 | `cd examples && pnpm tsx skill-demo.ts` |
| `chat-with-middleware.ts` | Middleware 系统 | `cd examples && pnpm tsx chat-with-middleware.ts` |
| `test-llm-connectivity.ts` | LLM 连接测试 | `cd examples && pnpm tsx test-llm-connectivity.ts` |
| `simple-agent/` | 简单 Agent | 参考其 README |
| `test-storage/` | 存储测试 | 参考其 README |

---

## 总体路线图

| 阶段 | 目标 | 预计时间 | 对标度提升 |
| ----- | ------ | --------- | ----------- |
| **Phase 1** | 核心功能补齐 | 2 周 | 80% → 90% |
| **Phase 2** | 扩展机制补齐 | 1 周 | 90% → 95% |
| **Phase 3** | 完善与优化 | 1 周 | 95% → 100% |

---

## Phase 1: 核心功能补齐（高优先级）

### Week 1: Tool 系统 + Storage 接口

#### Task 1.1: 创建独立 Tool 包

**目标**：将 Tool 系统从 core 中独立出来

**文件**：

```md
packages/tool/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── ToolRegistry.ts
│   ├── executor.ts
│   └── categories.ts
├── tests/
├── package.json
└── tsconfig.json
```

**步骤**：

1. 创建 package.json（依赖 @agentforge/core、effect、zod）
2. 迁移 Tool 类型（从 core/types.ts）
3. 实现 ToolRegistry（register、unregister、get、getAll、getByCategory、search）
4. 实现 ToolExecutor（execute、executeSingle）
5. 更新 @agentforge/core（重新导出 @agentforge/tool）
6. 更新 @agentforge/agents（改用 ToolRegistry）

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 通过
- [ ] CLI 可验证工具注册和执行
- [ ] **必须运行** `cd examples && pnpm tsx tool-call-demo.ts
- [ ] **必须运行** `cd examples && pnpm tsx mock-tool-call-demo.ts`

---

#### Task 1.2: 统一 Storage 接口

**目标**：建立统一的 Storage 接口

**文件**：

```md
packages/storage/
├── src/
│   ├── index.ts
│   ├── Storage.ts
│   ├── QueryBuilder.ts
│   ├── file-storage.ts
│   └── adapters/
└── tests/
```

**步骤**：

1. 定义 Storage 接口（connect、disconnect、insert、upsert、update、delete、findById、findOne、findMany、count、transaction）
2. 重构 FileStorage 实现 Storage 接口
3. 创建 Memory → Storage 适配器

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 通过
- [ ] FileStorage 完整实现 Storage 接口
- [ ] **必须运行** `cd examples && pnpm tsx memory-demo.ts
- [ ] **必须运行** `cd examples && pnpm tsx persistence-demo.ts`

---

### Week 2: SQLite 存储 + Provider 注册表

#### Task 2.1: SQLite 存储实现

**目标**：实现 SQLite 存储后端

**文件**：

```md
packages/storage-sqlite/
├── src/
│   ├── index.ts
│   ├── schema.ts
│   ├── SQLiteStorage.ts
│   └── migrations/
├── tests/
├── package.json
└── tsconfig.json
```

**步骤**：

1. 创建 package.json（依赖 @agentforge/storage、effect、better-sqlite3）
2. 定义 Schema（sessions、messages、agents、tools、metrics）
3. 实现 SQLiteStorage
4. 添加 CLI 验证工具

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 通过
- [ ] CLI 可验证会话数据持久化
- [ ] **必须运行** `cd examples && pnpm tsx persistence-demo.ts
- [ ] **必须运行** `cd examples && pnpm tsx persistence-only-demo.ts`

---

#### Task 2.2: Provider 注册表与多种 Provider

**目标**：实现 Provider 注册表

**文件**：

```md
packages/llm/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── registry.ts
│   ├── provider.ts
│   ├── providers/
│   │   ├── openai.ts
│   │   └── index.ts
│   └── constants.ts
└── tests/
```

**步骤**：

1. 更新 LLMProvider 接口（添加 listModels、validateKey）
2. 实现 ProviderRegistry（register、unregister、get、getByModel、listProviders、listModels）
3. 实现 OpenAI Provider（独立于 OpenAICompatible）
4. 添加 CLI 验证工具

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 通过
- [ ] CLI 可验证 Provider 注册和切换
- [ ] **必须运行** `cd examples && pnpm tsx test-llm-connectivity.ts`

---

## Phase 1 验收

**完成标准**：

- [ ] Tool 包独立，有完整的 ToolRegistry/ToolExecutor
- [ ] 统一 Storage 接口，FileStorage 实现该接口
- [ ] SQLite 存储实现，可通过 CLI 验证
- [ ] Provider 注册表，支持 listModels/validateKey
- [ ] 所有验证命令通过
- [ ] **必须运行** `cd examples && pnpm tsx tool-call-demo.ts
- [ ] **必须运行** `cd examples && pnpm tsx memory-demo.ts
- [ ] **必须运行** `cd examples && pnpm tsx persistence-demo.ts
- [ ] **必须运行** `cd examples && pnpm tsx test-llm-connectivity.ts`

**对标度目标**：80% → 90%

---

## Phase 2: 扩展机制补齐（中优先级）

### Week 3: 内置中间件 + Plugin 系统

#### Task 3.1: 内置中间件

**目标**：实现 LoggerMiddleware、MetricsMiddleware、ErrorHandlerMiddleware

**文件**：

```md
packages/middleware/
├── src/
│   ├── index.ts
│   └── builtins/
│       ├── LoggerMiddleware.ts
│       ├── MetricsMiddleware.ts
│       └── ErrorHandlerMiddleware.ts
└── tests/
```

**步骤**：

1. 实现 LoggerMiddleware（监听所有事件，格式化输出）
2. 实现 MetricsMiddleware（统计 LLM/Tool 调用、Token 用量）
3. 实现 ErrorHandlerMiddleware（捕获错误，格式化响应）
4. 添加 CLI 验证工具

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 通过
- [ ] CLI 可验证中间件生效
- [ ] **必须运行** `cd examples && pnpm tsx chat-with-middleware.ts`

---

#### Task 3.2: Plugin 系统

**目标**：实现完整的 Plugin 系统

**文件**：

```md
packages/plugin/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── Plugin.ts
│   ├── PluginManager.ts
│   └── hooks.ts
├── tests/
├── package.json
└── tsconfig.json
```

**步骤**：

1. 定义 Plugin 接口（install、uninstall、initialize、destroy、hooks）
2. 定义 PluginHooks（agent:created、agent:destroyed、tool:registered、session:created）
3. 实现 PluginManager
4. 集成到 Agents 包（BaseAgent 支持 Plugin 加载）
5. 添加 CLI 验证工具

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 通过
- [ ] CLI 可验证 Plugin 安装和 Hook 触发
- [ ] **创建新的 Plugin 示例** 在 examples/ 下验证
- [ ] **必须运行** 新创建的 Plugin 示例

---

#### Task 3.3: 上下文压缩器

**目标**：实现 ContextCompactor

**文件**：

```md
packages/memory/
├── src/
│   ├── index.ts
│   ├── Compactor.ts
│   └── compaction-strategies/
│       ├── KeepLatestStrategy.ts
│       ├── KeepToolResultsStrategy.ts
│       └── SlidingWindowStrategy.ts
└── tests/
```

**步骤**：

1. 定义 ContextCompactor 接口（compress、extract、summarize）
2. 实现压缩策略（KeepLatest、KeepToolResults、SlidingWindow）
3. 集成到 SessionManager（添加 compress() 方法）

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 通过
- [ ] 可验证上下文压缩效果
- [ ] **必须运行** `cd examples && pnpm tsx memory-features-demo.ts`

---

## Phase 2 验收

**完成标准**：

- [ ] 内置中间件完整实现
- [ ] Plugin 系统完整实现
- [ ] ContextCompactor 完整实现
- [ ] 所有验证命令通过
- [ ] **必须运行** `cd examples && pnpm tsx chat-with-middleware.ts
- [ ] **必须运行** `cd examples && pnpm tsx memory-features-demo.ts
- [ ] **必须运行** 新创建的 Plugin 示例

**对标度目标**：90% → 95%

---

## Phase 3: 完善与优化（低优先级）

### Week 4: Agent 工厂 + Server API + 其他

#### Task 4.1: Agent 工厂与注册表

**目标**：实现 AgentFactory、AgentBuilder、AgentRegistry

**文件**：

```md
packages/agents/
├── src/
│   ├── AgentFactory.ts
│   ├── registry.ts
│   └── builders/
│       ├── GeneralAgentBuilder.ts
│       ├── CodingAgentBuilder.ts
│       └── PlanningAgentBuilder.ts
└── tests/
```

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test:run` 通过

---

#### Task 4.2: 完整 Server API

**目标**：实现 Session API、Chat API、Tool API

**文件**：

```md
packages/server/
├── src/
│   ├── routes/
│   │   ├── sessions.ts
│   │   ├── chat.ts
│   │   └── tools.ts
│   └── handlers/
└── tests/
```

**验收**：

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] 所有 API 端点可通过 curl 验证

---

#### Task 4.3: 其他完善

**目标**：补齐剩余功能

- PostgreSQL 存储实现（可选）
- OpenAPI 文档
- 认证与安全

---

## Phase 3 验收

**完成标准**：

- [ ] Agent 工厂/注册表完整实现
- [ ] 完整 Server API（Session、Chat、Tool）
- [ ] 所有验证命令通过

**对标度目标**：95% → 100%

---

## 关键检查清单

每个任务完成后必须检查：

- [ ] 有 CLI 入口可直接验证
- [ ] 使用真实 LLM 验证（配置 baseURL、API Key、model）
- [ ] 从最小可用结构开始，每步都能跑通
- [ ] `pnpm typecheck` 通过（无 TypeScript 错误）
- [ ] `pnpm lint` 通过（无 ESLint 警告）
- [ ] `pnpm test:run` 通过（所有测试通过）
- [ ] **必须运行 examples/ 下相关真实示例验证功能**
- [ ] 先写测试再实现（TDD）
- [ ] 小步提交，每次只做一件事
- [ ] 提交前 self-review
- [ ] 所有副作用用 Effect 封装
- [ ] 严格使用 Effect-TS v4.0 API
- [ ] 无 `any` 类型滥用

### 各模块对应的验证示例

| 模块 | 必须运行的示例 |
| ----- | -------------- |
| Tool 系统 | `tool-call-demo.ts`、`mock-tool-call-demo.ts` |
| Storage 接口 | `memory-demo.ts`、`persistence-demo.ts` |
| SQLite 存储 | `persistence-demo.ts`、`persistence-only-demo.ts` |
| Provider 注册表 | `test-llm-connectivity.ts` |
| 内置中间件 | `chat-with-middleware.ts` |
| Plugin 系统 | 创建新的 Plugin 示例并运行 |
| ContextCompactor | `memory-features-demo.ts` |
| Agent 工厂 | 参考 `simple-agent/` 创建示例 |
| Server API | 参考 `simple-agent/` 创建 API 示例 |
