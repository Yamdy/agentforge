# 脚手架工具 (create-agentforge)

AgentForge 提供官方脚手架工具 `create-agentforge`，帮助你快速创建可配置、生产级的 Agent 项目。

## 安装

```bash
# 使用 npx 直接运行（推荐）
npx create-agentforge my-agent

# 或者全局安装
npm install -g create-agentforge
create-agentforge my-agent
```

## 快速上手

### 方式一：交互模式（默认）

```bash
npx create-agentforge
# 或者指定项目名
npx create-agentforge my-agent
```

交互式问答将引导你选择：
1. **项目名称** — 将作为目录名和 Agent 名称
2. **Agent 名称** — 默认同项目名
3. **最大步数** — 默认 10 步
4. **LLM 提供商** — OpenAI / Anthropic / DeepSeek / Mock
5. **API 密钥** — 可留空稍后设置
6. **功能模块** — 工具系统、检查点、可观测性、HITL 等
7. **API 模式** — 简单模式 (L2) / 高级模式 (L3)
8. **预设配置** — production / debug / test（可选）
9. **Git 初始化** — 是否自动 `git init`

### 方式二：一键默认

```bash
npx create-agentforge my-agent --default
```

使用默认配置快速创建项目：
- LLM: OpenAI (gpt-4o)
- 无额外模块
- API 模式：简单 (L2)
- 自动初始化 Git

### 方式三：命令行全配置

```bash
npx create-agentforge my-agent \
  --llm openai \
  --tools \
  --checkpoint \
  --observability \
  --hitl \
  --api-mode advanced \
  --default
```

## 命令行选项

| 选项 | 说明 | 可选值 |
|------|------|----------|
| `[name]` | 项目名称（位置参数） | 字符串 |
| `--default` | 使用默认值，跳过交互 | — |
| `--llm <provider>` | LLM 提供商 | `openai`, `anthropic`, `deepseek`, `mock` |
| `--model <model>` | 模型名称覆盖 | 如 `gpt-4o`, `claude-sonnet-4` |
| `--tools` | 启用工具系统 | — |
| `--checkpoint` | 启用检查点（持久化） | — |
| `--observability` | 启用可观测性（日志+追踪+指标） | — |
| `--hitl` | 启用人工确认（HITL） | — |
| `--plugins` | 启用插件系统 | — |
| `--compaction` | 启用记忆压缩 | — |
| `--subagent` | 启用子 Agent 委派 | — |
| `--mcp` | 启用 MCP 客户端 | — |
| `--api-mode <mode>` | API 模式 | `simple` (L2), `advanced` (L3) |
| `--preset <preset>` | 预设配置 | `production`, `debug`, `test` |
| `--template <name>` | 从示例模板创建 | `weather-agent`, `full-pipeline` |
| `--dry-run` | 预览要创建的文件（不实际写入） | — |
| `--skip-install` | 跳过 npm install | — |
| `--force` | 覆盖已存在的目录 | — |
| `--no-git` | 跳过 git init | — |

## 生成的项目结构

### 简单项目（默认）

```
my-agent/
├── agentforge.config.ts    # TypeScript 配置文件
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
└── src/
    ├── index.ts            # L2 入口（createAgent）
    ├── types.ts
    └── llm/
        └── adapter.ts      # LLM 适配器（OpenAI）
```

### 全功能项目（`--checkpoint --observability --api-mode advanced`）

```
my-agent/
├── agentforge.config.ts
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
└── src/
    ├── index.ts            # L3 入口（AgentContextBuilder）
    ├── types.ts
    ├── llm/
    │   └── adapter.ts
    ├── tools/
    │   ├── index.ts
    │   └── weather.ts
    ├── checkpoint/
    │   └── storage.ts      # SQLite 持久化
    ├── observability/
    │   ├── logger.ts
    │   ├── tracer.ts
    │   └── metrics.ts
    ├── hitl/
    │   └── controller.ts
    ├── plugins/
    │   └── index.ts
    ├── memory/
    │   └── compaction.ts
    ├── subagent/
    │   └── registry.ts
    ├── mcp/
    │   └── client.ts
    └── operators/
        └── pipeline.ts
```

## 配置文件：`agentforge.config.ts`

生成的项目使用 TypeScript `defineConfig()` 作为唯一配置源：

```typescript
// agentforge.config.ts
import { defineConfig } from 'agentforge';
import { adapter } from './src/llm/adapter.js';
import { tools } from './src/tools/index.js';

export default defineConfig({
  name: 'my-agent',
  model: 'openai/gpt-4o',

  // LLM 配置
  llm: adapter,

  // 工具
  tools,

  // 检查点（true → SQLite；'memory' → 内存）
  checkpoint: true,

  // 可观测性
  tracing: true,
  metrics: true,
});
```

### 配置即行为

编辑 `agentforge.config.ts` 即可改变 Agent 行为，**无需修改源码**：

| 修改 | 效果 |
|------|------|
| `model: 'anthropic/claude-sonnet-4'` | 切换 LLM 提供商 |
| `checkpoint: false` | 关闭检查点持久化 |
| `tools: otherTools` | 替换为新工具注册表 |
| `tracing: false` | 关闭追踪 |

## 示例模板

### weather-agent（天气查询 Agent）

```bash
npx create-agentforge my-weather --template weather-agent
```

包含一个简单的 L2 Agent，使用 OpenAI + 天气工具。

### full-pipeline（全功能演示）

```bash
npx create-agentforge my-agent --template full-pipeline
```

包含全部 10 个模块的高级 L3 Agent。

## 预览模式

```bash
npx create-agentforge my-agent --default --dry-run
```

输出将要创建的文件列表，**不实际写入磁盘**：

```
📄 Dry run — files that would be created:

  src/index.ts — Entry point
  src/llm/adapter.ts — LLM adapter
  agentforge.config.ts — Agent config
  package.json — Package config
  ...

  Total: 8 files
```

## 开发生成的项目

```bash
cd my-agent
npm run dev          # 开发模式（tsx 直接运行）
npm run build        # 构建（tsc → dist/）
npm start            # 运行构建结果（node dist/index.js）
npm test             # 运行测试（vitest）
```

## 设计理念

### 混合架构（Plan C）

`create-agentforge` 使用 **Handlebars 模板 + 代码片段注入**：
- 基础模板提供项目骨架
- 根据用户选择的模块，条件注入对应的代码片段
- `defineConfig()` 作为唯一配置源，支持运行时行为变更

### 两层配置

| 层级 | 文件 | 用途 |
|------|------|------|
| 项目配置 | `agentforge.config.ts` | 所有行为配置（版本控制） |
| 环境变量 | `.env` | 密钥和端点（gitignore） |

无全局配置文件 — 每个项目独立配置，团队可共享 `agentforge.config.ts`。

## 下一步

- [快速开始](/guide/getting-started) — 不依赖 CLI，手动创建 Agent
- [核心概念](/guide/core-concepts) — 理解事件流和状态管理
- [API 参考](/api/) — 完整的 API 文档
