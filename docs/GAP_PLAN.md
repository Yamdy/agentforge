# AgentForge 补齐计划

## 概述

本文档详细说明了如何将当前 AgentForge 实现与 DESIGN.md 设计文档对齐的分阶段执行计划。

**当前符合度：约 65%**

---

## 阶段一：核心功能补齐（高优先级）

### 目标

补齐最关键的核心功能，使框架达到可用状态。

### 1.1 Tool 系统完善

**任务清单：**

- [ ] 创建 `packages/tool/` 独立包
  - [ ] `src/types.ts` - Tool 类型定义（从 core/types.ts 迁移并完善）
  - [ ] `src/ToolRegistry.ts` - Tool 注册表实现
  - [ ] `src/executor.ts` - ToolExecutor 实现
  - [ ] `src/index.ts` - 导出
  - [ ] `package.json` - 包配置

- [ ] 更新 `@agentforge/core`
  - [ ] 从 types.ts 移除 Tool 相关类型
  - [ ] 重新导出 `@agentforge/tool`

- [ ] 更新 `@agentforge/agents`
  - [ ] 改用 `@agentforge/tool` 的 ToolRegistry
  - [ ] 更新 BaseAgent 中的工具管理逻辑

- [ ] 添加测试
  - [ ] `tests/tool-registry.test.ts`
  - [ ] `tests/tool-executor.test.ts`

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- `pnpm test:run` 通过
- CLI 可验证工具注册和执行

---

### 1.2 完整 Server API 实现

**任务清单：**

- [ ] Session API
  - [ ] `packages/server/src/routes/sessions.ts` - Session 路由
  - [ ] `packages/server/src/handlers/session-handler.ts` - 处理器
  - [ ] Zod Schema 定义

- [ ] Chat API
  - [ ] `packages/server/src/routes/chat.ts` - Chat 路由
  - [ ] `packages/server/src/handlers/chat-handler.ts` - 处理器
  - [ ] SSE 流式支持

- [ ] Tool API
  - [ ] `packages/server/src/routes/tools.ts` - Tool 路由
  - [ ] `packages/server/src/handlers/tool-handler.ts` - 处理器

- [ ] 健康检查和基础中间件
  - [ ] CORS 配置
  - [ ] 日志中间件
  - [ ] `/health` 端点

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- 可通过 curl/Postman 测试所有 API 端点
- 流式响应正常工作

---

### 1.3 SQLite 存储实现

**任务清单：**

- [ ] 创建 `packages/storage-sqlite/` 包
  - [ ] `src/schema.ts` - 数据库 Schema
  - [ ] `src/SQLiteStorage.ts` - SQLite 存储实现
  - [ ] `src/migrations/` - 迁移文件
  - [ ] `src/index.ts` - 导出
  - [ ] `package.json` - 包配置（依赖 better-sqlite3 或 drizzle-orm）

- [ ] 更新 `@agentforge/storage`
  - [ ] 定义统一的 Storage 接口
  - [ ] 支持多种存储后端切换

- [ ] 添加测试
  - [ ] `tests/sqlite-storage.test.ts`

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- `pnpm test:run` 通过
- 会话数据可持久化到 SQLite

---

## 阶段二：扩展机制补齐（中优先级）

### 2.1 Plugin 系统实现

**任务清单：**

- [ ] 创建 `packages/plugin/` 包
  - [ ] `src/types.ts` - Plugin 类型定义
  - [ ] `src/Plugin.ts` - Plugin 接口
  - [ ] `src/PluginManager.ts` - Plugin 管理器
  - [ ] `src/hooks.ts` - Hook 系统
  - [ ] `src/index.ts` - 导出
  - [ ] `package.json` - 包配置

- [ ] 集成到 `@agentforge/agents`
  - [ ] BaseAgent 支持 Plugin 加载
  - [ ] 生命周期 Hook 触发

- [ ] 添加测试
  - [ ] `tests/plugin-manager.test.ts`

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- `pnpm test:run` 通过
- 可通过 Plugin 扩展 Agent 功能

---

### 2.2 内置中间件

**任务清单：**

- [ ] 在 `@agentforge/middleware` 中添加
  - [ ] `src/builtins/LoggerMiddleware.ts` - 日志中间件
  - [ ] `src/builtins/MetricsMiddleware.ts` - 指标中间件
  - [ ] `src/builtins/ErrorHandlerMiddleware.ts` - 错误处理中间件
  - [ ] 更新 `src/index.ts` 导出内置中间件

- [ ] 添加测试
  - [ ] `tests/middleware.test.ts`

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- `pnpm test:run` 通过
- 中间件可正确拦截和处理事件

---

### 2.3 上下文压缩器

**任务清单：**

- [ ] 在 `@agentforge/memory` 中添加
  - [ ] `src/Compactor.ts` - ContextCompactor 接口
  - [ ] `src/compaction-strategies/` - 压缩策略实现
    - [ ] `KeepLatestStrategy.ts`
    - [ ] `KeepToolResultsStrategy.ts`
    - [ ] `SlidingWindowStrategy.ts`
  - [ ] 更新 `src/index.ts` 导出

- [ ] 集成到 SessionManager
  - [ ] 添加 compress() 方法

- [ ] 添加测试
  - [ ] `tests/compactor.test.ts`

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- `pnpm test:run` 通过
- 可有效压缩会话上下文

---

## 阶段三：完善与优化（低优先级）

### 3.1 PostgreSQL 存储实现

**任务清单：**

- [ ] 创建 `packages/storage-postgres/` 包
  - [ ] `src/schema.ts` - 数据库 Schema
  - [ ] `src/PostgresStorage.ts` - PostgreSQL 存储实现
  - [ ] `src/migrations/` - 迁移文件
  - [ ] `src/index.ts` - 导出
  - [ ] `package.json` - 包配置

- [ ] 添加测试
  - [ ] `tests/postgres-storage.test.ts`

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- `pnpm test:run` 通过
- 会话数据可持久化到 PostgreSQL

---

### 3.2 Agent 工厂与注册表

**任务清单：**

- [ ] 在 `@agentforge/agents` 中添加
  - [ ] `src/AgentFactory.ts` - AgentFactory 接口和实现
  - [ ] `src/builders/` - Builder 实现
    - [ ] `GeneralAgentBuilder.ts`
    - [ ] `CodingAgentBuilder.ts`
    - [ ] `PlanningAgentBuilder.ts`
  - [ ] `src/registry.ts` - Agent 注册表
  - [ ] 更新 `src/index.ts` 导出

- [ ] 添加测试
  - [ ] `tests/agent-factory.test.ts`

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- `pnpm test:run` 通过
- 可通过工厂创建不同类型的 Agent

---

### 3.3 OpenAPI 文档

**任务清单：**

- [ ] 在 `@agentforge/server` 中添加
  - [ ] `src/openapi/index.ts` - OpenAPI 文档生成
  - [ ] `src/openapi/schemas.ts` - Schema 定义
  - [ ] `/doc` 端点提供 Swagger UI

- [ ] 为所有路由添加 OpenAPI 装饰器

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- 访问 `/doc` 可看到完整 API 文档

---

### 3.4 认证与安全

**任务清单：**

- [ ] 在 `@agentforge/server` 中添加
  - [ ] `src/auth/index.ts` - 认证模块
  - [ ] `src/auth/middleware.ts` - 认证中间件
  - [ ] 支持 Basic Auth 和 Bearer Token
  - [ ] 可选的 API Key 验证

**验收标准：**

- `pnpm typecheck` 通过
- `pnpm lint` 通过
- API 端点可正确验证认证信息

---

## 执行顺序建议

### 第一周：核心功能

1. Tool 系统完善
2. SQLite 存储实现
3. Session API

### 第二周：Server API

1. Chat API（含 SSE）
2. Tool API
3. 基础中间件

### 第三周：扩展机制

1. Plugin 系统
2. 内置中间件
3. 上下文压缩器

### 第四周：完善优化

1. PostgreSQL 存储
2. Agent 工厂
3. OpenAPI 文档
4. 认证

---

## 开发铁律遵守检查清单

每个任务完成后必须验证：

- [ ] CLI 入口可用，可直接验证效果
- [ ] 使用真实 LLM 验证（配置 baseURL、API Key、model）
- [ ] 从最小可用结构开始，每步都能跑通
- [ ] `pnpm typecheck` 通过（无 TypeScript 错误）
- [ ] `pnpm lint` 通过（无 ESLint 警告）
- [ ] `pnpm test:run` 通过（所有测试通过）
- [ ] 先写测试再实现（TDD）
- [ ] 小步提交，每次只做一件事
- [ ] 提交前 self-review
- [ ] 所有副作用用 Effect 封装
- [ ] 严格使用 Effect-TS v4.0 API
- [ ] 无 `any` 类型滥用

---

## 依赖关系图

```
阶段一（核心）
├── Tool 系统
│   └── 被 Agents、Server 依赖
├── SQLite 存储
│   └── 被 Memory、Server 依赖
└── Server API
    ├── Session API
    ├── Chat API
    └── Tool API

阶段二（扩展）
├── Plugin 系统
│   └── 被 Agents 依赖
├── 内置中间件
│   └── 被 Middleware、Agents、Server 依赖
└── 上下文压缩器
    └── 被 Memory 依赖

阶段三（完善）
├── PostgreSQL 存储
├── Agent 工厂
├── OpenAPI 文档
└── 认证
```

---

## 成功度量

- **阶段一完成**：符合度达到 80%
- **阶段二完成**：符合度达到 90%
- **阶段三完成**：符合度达到 100%

每个阶段完成后都应：

- 所有验证命令通过
- 有可运行的 Demo
- 文档更新同步
