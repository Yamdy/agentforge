# AgentForge 仓库冗余/过期资产审计报告

> **审计日期**: 2026-05-23
> **更新日期**: 2026-05-23
> **审计范围**: 全仓库文档、worktree、文件、远程分支
> **审计状态**: P0 ✅ 已修复，P1 部分完成，P2 待处理

---

## 一、总览

| 类别 | 文件数 | 严重度 | 状态 |
|------|--------|--------|------|
| 🔴 与代码冲突的文档 | 5 | P0 | ✅ 已修复 |
| 🔴 重复/冗余文档 | 10 | P1 | ✅ 已清理 |
| 🔴 过期/已完成的设计文档 | 19 | P1 | 部分处理 |
| 🟡 工作追踪文件（非文档） | 28 | P1 | 待处理 |
| 🟡 重复模板文件 | 5 | P1 | 待处理 |
| 🟡 泄露本地路径的配置 | 1 | P0 | ✅ 已修复 |
| 🟢 远程分支冗余 | 3 | P2 | 待处理 |
| ✅ 无问题 | — | — | — |

---

## 二、🔴 P0 — 与代码冲突的文档（已修复）

### 1. `docs/getting-started.md` — 工具数量错误 + 废弃 API ✅

**问题**：
- 第30行、第88行：声称 `@primo-ai/tools` 有 11 个内置工具，实际有 16 个
- 第162-175行：使用 `agent.use(memoryPlugin({...}))` API，当前 Agent 使用 `plugins: [...]` 数组
- 第334行：同样使用 `agent.use(mcpPlugin({...}))`

**修复**：
- 工具数量 11 → 16，补全 webSearch/webFetch/memory 三个分类 5 个工具
- `agent.use(plugin)` → `plugins: [plugin]` 构造函数配置项（3 处）

### 2. `docs/plugins.md` — 废弃 API 引用 ✅

**问题**：
- 第151行：引用 `pluginManager.initializeAll()`
- 第163-172行：示例使用 `agent.use()` + `pluginManager` 生命周期方法

**修复**：
- Plugin Lifecycle 移除 `pluginManager.initializeAll()` / `pluginManager.shutdown()` 步骤
- Using Plugins 改为 `plugins: [...]` 配置数组模式
- compressionPlugin 示例改为构造函数配置

### 3. `docs/api-reference.md` — 废弃 API 引用 ✅

**问题**：
- 第1674-1781行：6 个插件示例全部使用 `agent.use()` 模式
- 工具表只列出 11 个工具

**修复**：
- `Agent.use` 方法标记为 `@deprecated`
- 6 个插件示例全部改为 `plugins: [plugin({...})]`
- 工具表补全到 16 个

### 4. `docs/deployment.md` — 空白/损坏章节 ✅

**问题**：
- 第291-305行：`## 可观测性` 和 `## 限流` 内容为空

**修复**：
- 可观测性：补全环境变量表、Docker 示例、编程式配置
- 限流：补全 `rateLimit` 配置项、参数说明、429 响应行为

### 5. `.claude/settings.local.json` — 泄露本地路径 ✅

**问题**：
- 包含本地机器路径 `C:/Users/90514/...`、185 条命令权限、MCP 插件配置

**修复**：
- `git rm --cached` 从版本控制移除
- `.gitignore` 新增 `.claude/settings.local.json`

---

## 三、🔴 P1 — 重复/冗余文档

### 6. `design/audit/` — 5 个版本的同一审计报告 ✅

| 文件 | 日期 | 状态 |
|------|------|------|
| `agent-architecture-audit-2026-05.md` | 05-14 | ✅ 已删除 |
| `agent-architecture-audit-2026-05-15.md` | 05-15 | ✅ 已删除 |
| `agent-architecture-audit-2026-05-15-v2.md` | 05-15 | ✅ 已删除 |
| `agent-architecture-audit-2026-05-16.md` | 05-16 | ✅ 已删除 |
| `agent-architecture-audit-2026-05-16-v2.md` | 05-16 | ✅ 保留（最新版） |

**已完成**：删除 4 个旧版本，仅保留 `2026-05-16-v2.md`

### 7. `design/ideal-architecture.md` 与 `design/architecture.md` 重复 ✅

- 两者描述相同的 Pipeline 架构、三形态映射、AOP 方法
- `ideal-architecture.md`（786行）是超集，包含审计差距表和修复路线图
- `architecture.md`（149行）是子集

**已完成**：删除 `architecture.md`，保留 `ideal-architecture.md` 作为唯一架构文档

### 8. `docs/configuration.md` 与 `README.md` 重复

- 配置层级、合并策略、示例配置与 `README.md` 的 Configuration 部分高度重复

**建议**：docs/ 保留完整版，README 只保留简要引用

### 9. `design/adr/` — ADR 编号重复

| 编号 | 文件1 | 文件2 |
|------|-------|-------|
| 0001 | `dlq-unnecessary-for-server-sdk.md` | `harness-as-runtime-skeleton.md` |
| 0002 | `suspend-timeout-covered-by-session-ttl.md` | `processor-pipeline-as-core-execution-model.md` |
| 0003 | `hidden-repair-transparency-sufficient.md` | `unified-extension-point-and-observability-span.md` |
| 0004 | `no-prompt-fragment-cap-or-dedup.md` | `self-built-observability-abstraction-plus-otel-bridge.md` |
| 0005 | `no-time-based-history-pruning.md` | `vercel-ai-sdk-as-llm-provider-layer.md` |
| 0006 | `checkpoint-versioning-sufficient-no-ttl-needed.md` | `llm-invoker-and-unified-streaming.md` |

**建议**：重新编号为 0001-0014 连续序列

### 10. `design/adr/architecture-audit-report.md` — 与 `design/audit/` 重复 ✅

- 2026-05-12 的审计报告，被 `design/audit/` 中的 5 个版本取代

**已完成**：已删除

---

## 四、🔴 P1 — 过期/已完成的设计文档

### 11. `design/superpowers/` — 6 个已完成的设计/计划文件

| 文件 | 类型 | 状态 |
|------|------|------|
| `specs/2026-05-10-architecture-upgrade-design.md` | 设计 | 已实现 |
| `specs/2026-05-11-kitchen-sink-integration-design.md` | 设计 | 已实现 |
| `specs/2026-05-11-tool-eviction-design.md` | 设计 | 已实现 |
| `plans/2026-05-11-agent-loop-deduplication.md` | 计划 | 已完成 |
| `plans/2026-05-11-four-region-pipeline-context.md` | 计划 | 已完成 |
| `plans/2026-05-11-kitchen-sink-integration.md` | 计划 | 已完成 |

### 12. `docs/superpowers/specs/` — 3 个孤立设计文件

- `2026-05-17-studio-design.md`
- `2026-05-17-framework-server-design.md`
- `2026-05-17-agents-directory-discovery-design.md`

未从 `docs/index.md` 或任何索引页面链接，且对应功能似乎已实现

### 13. `design/audit/audit-fix-plan.md` — 已完成的修复计划

- 所有发现已标记为 Complete，被 `ideal-architecture.md` 包含

---

## 五、🟡 P1 — 工作追踪文件（非正式文档）

### 14. `.scratch/harness-framework/` — 18 个已完成的 issue 文件

- PRD.md + 17 个编号 issue（01-17），全部标记 `Status: done`
- 这些是开发过程追踪文件，项目已完成

### 15. `.scratch/audit-2026-05/` — 8 个已解决的审计发现

- F-1 到 F-8，全部在 `ideal-architecture.md` 中标记为已解决
- issue 文件中仍标记 `Status: open`，与实际不符

### 16. `.claude/plans/` — 10 个计划文件

| 文件 | 状态 |
|------|------|
| `processor-api-radical-refactor.md` | ✅ 已完成 |
| `resumable-auditable-agent.plan.md` | 部分完成 |
| `skill-discovery-enhancement.plan.md` | 未知 |
| `mid-term-improvements.plan.md` | pending |
| `orchestration-layer.plan.md` | 未知 |
| `orchestration-task-queue.plan.md` | 未知 |
| `memory-system-self-built.plan.md` | 已审查 |
| `mastra-memory-integration.plan.md` | 未知 |
| `milestone-2-snapshot-service.plan.md` | 未知 |
| `milestone-3-integration.plan.md` | 未知 |

### 17. `.claude/prds/` — 2 个 PRD 文件

- `resumable-auditable-agent.prd.md`
- `skill-discovery-enhancement.prd.md`

---

## 六、🟡 P1 — 重复模板文件

### 18. `packages/create-agentforge/templates/` 与 `src/templates/` 重复

- `templates/` 根目录下有 5 个模板文件，与 `src/templates/` 下的文件完全相同
- 构建系统使用 `src/templates/`，根目录 `templates/` 是遗留副本

---

## 七、🟢 P2 — 远程分支冗余

| 分支 | 与 dev 的差异 | 建议 |
|------|-------------|------|
| `origin/main` | 75 个未合并 commit（旧历史） | 可能是旧主分支，可考虑归档 |
| `origin/new` | 99 个未合并 commit（RxJS 迁移等） | 旧开发线，已合并到 dev 或废弃 |
| `origin/oc` | 99 个未合并 commit（与 new 高度重叠） | 可能是 new 的 fork，可考虑删除 |
| `origin/master` | 已合并到 dev | 可删除 |

---

## 八、其他发现

### 19. `packages/tools/README.md` — 只列出 echo 工具

- 实际有 16 个工具，但 README 只文档化了 echo 一个

### 20. `packages/core/__tests__/fixtures/test-plugin.js`

- 与同目录的 `test-plugin.ts` 重复，可能是编译产物

### 21. `agentforge-logo-v4.jpg` — gitignore 冲突

- `.gitignore` 包含 `*.jpg`，但该文件已被跟踪（gitignore 仅影响未跟踪文件）
- 需要添加 `!agentforge-logo-v4.jpg` 显式允许，或移至外部托管

---

## 九、建议清理优先级

| 优先级 | 操作 | 影响文件数 | 状态 |
|--------|------|-----------|------|
| **P0** | 修复 `docs/getting-started.md`：11→16 工具，`agent.use()` → `plugins: []` | 1 | ✅ |
| **P0** | 修复 `docs/plugins.md`：移除 `agent.use()` / `pluginManager` 示例 | 1 | ✅ |
| **P0** | 修复 `docs/api-reference.md`：移除 `agent.use()` 示例 | 1 | ✅ |
| **P0** | 修复 `docs/deployment.md`：补全空白章节 | 1 | ✅ |
| **P0** | `git rm --cached .claude/settings.local.json`，加入 `.gitignore` | 1 | ✅ |
| **P1** | 删除 `design/audit/` 中 4 个旧审计版本 | 4 | ✅ |
| **P1** | 删除 `design/adr/architecture-audit-report.md` | 1 | ✅ |
| **P1** | 合并 `design/architecture.md` → `design/ideal-architecture.md` | 1 | ✅ |
| **P1** | 重新编号 ADR 0001-0014 | 14 | 待处理 |
| **P1** | 删除/归档 `design/superpowers/` 6 个已完成文件 | 6 | 待处理 |
| **P1** | 删除/归档 `docs/superpowers/specs/` 3 个孤立文件 | 3 | 待处理 |
| **P1** | 删除/归档 `.scratch/` 26 个工作文件 | 26 | 待处理 |
| **P1** | 删除/归档 `.claude/plans/` + `.claude/prds/` 12 个文件 | 12 | 待处理 |
| **P1** | 删除 `packages/create-agentforge/templates/` 重复目录 | 5 | 待处理 |
| **P2** | 清理远程分支 `origin/master`、`origin/oc` | 2 | 待处理 |
| **P2** | 处理 `agentforge-logo-v4.jpg` 的 gitignore 冲突 | 1 | 待处理 |
| **P2** | 补全 `packages/tools/README.md` 工具文档 | 1 | 待处理 |

**总计**：约 80+ 个文件需要处理，其中 P0 级 5 个（✅ 已完成），P1 级已完成 3 项（6 个文件），P1 级剩余约 66 个，P2 级约 4 个。

---

## 十、实施方向变更记录

> **日期**: 2026-05-23
> **变更**: 插件共享工具函数的实现策略调整

### 原方案

之前 Task 0-4 中计划创建 `plugins-core` 包，将共享工具函数集中到该包中。

### 新方案

**不创建 `plugins-core` 包**，改为直接在各自插件包中实现共享工具函数。

**理由**：
- 避免引入新的包依赖层级（`plugins-core` 会成为所有插件的共同依赖）
- 共享函数数量有限，不足以独立成包
- 各插件包可以自行管理其工具函数的版本和导出
- 遵循 AgentForge 现有依赖方向：`sdk` ← `core` ← `plugins`，不增加横向依赖

**影响**：
- `@primo-ai/plugins` 中需要共享的工具函数直接放在 `src/shared/` 目录
- 需要共享逻辑的插件通过 `@primo-ai/plugins` 的导出获取
- 无需修改 `pnpm-workspace.yaml` 或 turbo 配置

---

## 十一、Git Worktree 状态

| 路径 | 分支 | Commit |
|------|------|--------|
| `D:/bug/github/agentforge` | `dev` | `24c9c25` |

仅 1 个 worktree，无冗余。

## 十二、远程分支状态

| 分支 | 状态 |
|------|------|
| `origin/dev` | 当前开发主线（HEAD） |
| `origin/main` | 旧主分支，75 个未合并 commit |
| `origin/master` | 已合并到 dev |
| `origin/new` | 旧开发线，99 个未合并 commit |
| `origin/oc` | 旧开发线，99 个未合并 commit |

## 十三、Stash 状态

无 stash 记录。

---

## 十四、剩余待办清单

### P1 剩余（6 项，约 66 个文件）

| # | 操作 | 文件数 | 说明 |
|---|------|--------|------|
| 1 | 重新编号 ADR 0001-0014 | 14 | 6 组重复编号需连续化 |
| 2 | 删除/归档 `design/superpowers/` | 6 | 已完成的设计/计划文件 |
| 3 | 删除/归档 `docs/superpowers/specs/` | 3 | 孤立设计文件 |
| 4 | 删除/归档 `.scratch/` | 26 | 已完成的工作追踪文件 |
| 5 | 删除/归档 `.claude/plans/` + `.claude/prds/` | 12 | 旧计划/PRD 文件 |
| 6 | 删除 `packages/create-agentforge/templates/` | 5 | 与 `src/templates/` 重复 |

### P2（3 项，约 4 个文件）

| # | 操作 | 说明 |
|---|------|------|
| 1 | 清理远程分支 | `origin/master` 已合并可删，`origin/oc` 与 `origin/new` 重叠可删 |
| 2 | 处理 `agentforge-logo-v4.jpg` gitignore 冲突 | `.gitignore` 有 `*.jpg` 但文件已跟踪 |
| 3 | 补全 `packages/tools/README.md` | 只文档化了 echo，实际有 16 个工具 |

### 实施方向变更

- ~~创建 `plugins-core` 包集中共享工具函数~~ → **直接在各自插件包中实现共享工具函数**
- 详见第十节「实施方向变更记录」
