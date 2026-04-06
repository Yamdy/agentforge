# 三个 AI Agent 框架完整补充细节

本文档补充了架构图之外的重要细节，包括配置要求、示例分类、测试结构、生态系统集成等。

---

## 目录

1. [AgentScope 补充细节](#agentscope-补充细节)
2. [DeepAgents 补充细节](#deepagents-补充细节)
3. [Mastra 补充细节](#mastra-补充细节)
4. [共同遗漏的重要细节](#共同遗漏的重要细节)

---

## AgentScope 补充细节

### 1. 核心配置与依赖

**Python 版本要求**：≥3.10

**丰富的可选依赖组**：

- `a2a`：Agent-to-Agent 协议支持（含 nacos-sdk-python 服务发现）
- `realtime`：实时通信支持（websockets, scipy）
- `rag`：完整的 RAG 支持
  - 文档阅读器：text-reader, pdf-reader, docx-reader, excel-reader, ppt-reader
  - 向量数据库：qdrant, milvus, ali_mysql, mongodb, oceanbase
- `tuner` 和 `tuner-gpu`：提示调优和模型选择（含 dspy, datasets, litellm, trinity-rft）
- `evaluate`：评估模块（依赖 ray）

**MCP 协议支持**：核心依赖包含 `mcp>=1.13`

### 2. 示例代码分类（8 大分类）

- `agent/`：各种 Agent 实现
  - voice_agent, realtime_voice_agent
  - react_agent, meta_planner_agent
  - deep_research_agent, browser_agent
  - a2a_agent, a2ui_agent
- `workflows/`：多代理工作流
  - multiagent_realtime, multiagent_debate
  - multiagent_conversation, multiagent_concurrent
- `functionality/`：功能演示
  - vector_store, tts, structured_output
  - stream_printing_messages, short_term_memory
  - session_with_sqlite, rag, plan, mcp
  - long_term_memory, agent_skill
- `tuner/`：调优示例
  - prompt_tuning, model_tuning, model_selection
- `game/`：游戏示例
  - werewolves 狼人杀
- `integration/`：集成示例
  - qwen_deep_research_model, alibabacloud_api_mcp
- `evaluation/`：评估示例
  - ace_bench
- `deployment/`：部署示例

### 3. 测试结构

50+ 个测试文件，覆盖全面：

- 模型格式化器测试（formatter\_\*\_test.py）
- 记忆系统测试（memory\_\*\_test.py）
- 实时通信测试（realtime\_\*\_test.py）
- RAG 测试（rag\_\*\_test.py）
- 工具和工具包测试（tool*\*test.py, toolkit*\*\_test.py）
- 追踪系统测试（tracing\_\*\_test.py）

### 4. 文档

- 双语教程：`tutorial/zh_CN` 和 `tutorial/en`
- 路线图：`roadmap.md`
- 更新日志：`changelog.md`, `NEWS.md`, `NEWS_zh.md`

### 5. 目录结构细微之处

- `.github/`：GitHub Actions 工作流、PR 模板、Issue 模板
- `.pre-commit-config.yaml`：pre-commit 钩子配置
- `assets/`：资源文件夹
- `.gemini/`：Google Gemini 相关配置

---

## DeepAgents 补充细节

### 1. 核心配置与依赖

**Python 版本要求**：≥3.11,<4.0

**核心依赖**：

- `langchain-core>=1.2.21,<2.0.0`
- `langsmith>=0.3.0`
- `langchain>=1.2.15,<2.0.0`
- `langchain-anthropic>=1.4.0,<2.0.0`
- `langchain-google-genai>=4.2.1,<5.0.0`

**Monorepo 结构**：多个 Python 包

- `libs/deepagents/`：核心库
- `libs/cli/`：命令行工具
- `libs/evals/`：评估库
- `libs/acp/`：ACP 相关
- `libs/partners/`：合作伙伴集成（runloop, quickjs, modal, daytona）

### 2. 示例代码（7 个完整示例）

- `async-subagent-server/`：异步子代理服务器
- `content-builder-agent/`：内容构建代理
- `deep_research/`：深度研究
- `downloading_agents/`：下载代理
- `nvidia_deep_agent/`：NVIDIA 深度代理（含 cuML, cuDF 支持）
- `ralph_mode/`：Ralph 模式
- `text-to-sql-agent/`：文本转 SQL 代理

### 3. 测试结构

- `tests/unit_tests/`：单元测试
- `tests/integration_tests/`：集成测试
- `tests/benchmarks/`：性能基准测试
- `tests/README.md`：测试说明文档

### 4. 文档与特殊文件

- `THREAT_MODEL.md`：威胁模型文档（安全分析）
- `AGENTS.md`：根级别和各示例中的 Agent 配置文档
- `libs/evals/EVAL_CATALOG.md`：评估目录
- `libs/evals/MODEL_GROUPS.md`：模型分组
- `libs/cli/DEV.md`：CLI 开发文档
- `libs/cli/CHANGELOG.md`：CLI 更新日志
- `.github/RELEASING.md`：发布流程文档
- `action.yml`：GitHub Action 配置
- `.mcp.json`：MCP 配置
- `release-please-config.json`：发布配置

### 5. 目录结构细微之处

- `libs/cli/deepagents_cli/built_in_skills/`：内置技能
- `libs/cli/examples/skills/`：技能示例
- `libs/partners/`：合作伙伴集成目录
- `.vscode/`：VS Code 配置

---

## Mastra 补充细节

### 1. 核心配置与依赖

**Monorepo 管理**：pnpm + Turbo

**Node 版本要求**：≥22.13.0（@mastra/core）

**pnpm 版本要求**：≥10.18.0

**核心包**：`@mastra/core` 版本 1.16.0

**依赖管理**：使用 catalog 版本管理

**补丁依赖**：有 `patches/` 目录包含依赖补丁

**AI SDK 多版本支持**：同时支持 AI SDK v4、v5、v6

### 2. Monorepo 完整包结构（30+ 个包）

`packages/` 目录包含：

**核心包**：`core`, `_internal-core`, `_vendored`

**工具包**：`cli`, `create-mastra`, `deployer`, `editor`, `codemod`

**功能包**：

- `agent-builder`, `auth`, `evals`, `loggers`, `mcp`
- `mcp-docs-server`, `memory`, `playground`, `playground-ui`
- `rag`, `schema-compat`, `server`

**内部包**：

- `_changeset-cli`, `_config`, `_external-types`
- `_llm-recorder`, `_test-utils`, `_types-builder`

**其他重要目录**：

- `auth/`：10+ 种认证提供商集成
  - auth0, better-auth, clerk, firebase, okta
  - supabase, workos, studio, cloud
- `client-sdks/`：客户端 SDK（react, client-js, ai-sdk）
- `deployers/`：部署器（vercel, netlify, cloudflare, cloud）
- `workspaces/`：工作区集成（s3, gcs, e2b, blaxel, agentfs, daytona）
- `stores/`, `voice/`, `workflows/`, `templates/`
- `e2e-tests/`, `explorations/`, `communications/`, `pubsub/`
- `mastracode/`, `ee/`（企业版功能）
- `.changeset/`, `.dev/`（含 docker-compose.yaml）

### 3. 示例代码（50+ 个示例）

**基础示例**：

- `basics/scorers/`：7 种评分器
  - toxicity, tone-consistency, textual-difference
  - keyword-coverage, hallucination, answer-relevancy
- `basics/rag/`

**代理示例**：`agent/`, `agent-v6/`

**集成示例**：

- `bird-checker-with-express/`
- `bird-checker-with-nextjs/`
- `bird-checker-with-nextjs-and-eval/`

**工作流示例**：

- `workflow-with-suspend-resume/`
- `workflow-with-separate-steps/`
- `workflow-with-memory/`
- `workflow-with-inline-steps/`
- `workflow-ai-recruiter/`

**记忆示例**：

- `memory-todo-agent/`
- `memory-with-upstash/`
- `memory-with-processors/`
- `memory-with-pg/`
- `memory-with-mongodb/`
- `memory-with-libsql/`
- `memory-with-context/`
- `memory-per-resource-example/`

**其他示例**：

- `crypto-chatbot/`, `dane/`, `fireworks-r1/`
- `heads-up-game/`, `weather-agent/`, `stock-price-tool/`
- `openapi-spec-writer/`, `yc-directory/`, `a2a/`, `voice/`

### 4. 测试结构

**多层次测试**：

- 各包内的单元测试
- `e2e-tests/`：端到端测试
  - workspace-compat, workspace-tools, type-check
  - pkg-outputs, no-bundling, monorepo
  - deployers, create-mastra, commonjs, client-js
  - \_local-registry-setup
- `__recordings__/`：测试录音/录像

### 5. 文档

- `docs/`：文档目录
- `DEVELOPMENT.md`：开发指南
- `CODE_OF_CONDUCT.md`：行为准则
- `CONTRIBUTING.md`：贡献指南
- `AGENTS.md`：Agent 配置
- `CLAUDE.md`：Claude 相关
- `renovate.json`：Renovate 配置
- `turbo.json`：Turbo 配置

### 6. 目录结构细微之处

- `superset/`：Superset 相关
- `.cursor/`：Cursor IDE 配置
- `.claude/`：Claude 配置
- `.husky/`：Husky Git 钩子
- `.opencode/`：OpenCode 配置

---

## 共同遗漏的重要细节

### 1. 许可证信息

| 框架       | 许可证     |
| ---------- | ---------- |
| AgentScope | Apache-2.0 |
| DeepAgents | MIT        |
| Mastra     | Apache-2.0 |

### 2. 开发流程配置

- **所有项目**：都有 pre-commit 配置
- **Mastra**：Husky + lint-staged
- **Mastra**：使用 changesets 进行版本管理

### 3. CI/CD 配置

所有项目都有 `.github/workflows/` 目录：

**AgentScope**：

- unittest, update_news, toc, stale
- sphinx_docs, publish-pypi
- pre-commit, pr-title-check

**DeepAgents**：有相关配置

**Mastra**：有相关配置

### 4. Issue 和 PR 模板

所有项目都有：

- `.github/ISSUE_TEMPLATE/`
- `PULL_REQUEST_TEMPLATE.md`

### 5. 安全考虑

- **DeepAgents**：`THREAT_MODEL.md` 威胁模型文档
- **Mastra**：`auth/` 目录提供 10+ 种认证选项
- **AgentScope**：tracing 系统支持敏感数据过滤

### 6. 生态系统集成

| 集成           | AgentScope | DeepAgents | Mastra |
| -------------- | ---------- | ---------- | ------ |
| A2A 协议       | ✓          | ✓          | ✓      |
| MCP 协议       | ✓          | ✓          | ✓      |
| RAG 支持       | ✓          | ✓          | ✓      |
| 认证提供商     | 基础       | 基础       | 10+    |
| 部署器         | 基础       | 基础       | 4+     |
| 示例数量       | 8 大类     | 7 个       | 50+    |
| 生态系统完整性 | 高         | 中         | 最高   |

---

## 总结

这份补充文档涵盖了架构图之外的大量重要细节，包括：

- 详细的版本要求和依赖配置
- 完整的示例代码分类
- 测试结构和策略
- 开发流程和 CI/CD 配置
- 安全考虑
- 生态系统集成对比

结合之前的架构图，现在我们对这三个 AI Agent 框架有了非常全面和深入的了解。
