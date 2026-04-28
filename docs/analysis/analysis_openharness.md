# OpenHarness 项目分析报告

> **仓库地址**: https://github.com/HKUDS/OpenHarness.git  
> **当前版本**: v0.1.7  
> **许可证**: MIT  
> **分析日期**: 2026-04-28

---

## 一、项目定位与核心理念

### 定位

OpenHarness 是一个**开源轻量级 AI Agent 基础设施框架**，核心定位是：

> "The model is the agent. The code is the harness."

它不是又一个聊天机器人，而是一套完整的 **Agent Harness（代理运行框架）**——围绕 LLM 提供工具使用、技能加载、记忆管理和多 Agent 协调能力的基础设施层。

### 核心理念

1. **Harness = Tools + Knowledge + Observation + Action + Permissions**  
   模型提供智能，Harness 提供"手、眼睛、记忆和安全边界"。
2. **轻量可检视**  
   代码量适中，研究者和开发者可以完整理解生产级 AI Agent 的运行机制。
3. **生态兼容**  
   兼容 Anthropic 的 `skills` 和 `claude-code` 插件格式，降低迁移成本。
4. **社区驱动**  
   鼓励社区贡献 Tools、Skills、Plugins、Providers 等。

### 两个核心产品

| 产品 | 说明 |
|------|------|
| **OpenHarness (`oh`)** | 核心 Agent Harness 框架，提供完整的 Agent Loop、工具链、权限、插件等基础设施 |
| **ohmo** | 基于 OpenHarness 构建的个人 AI Agent 应用，可通过 Feishu/Slack/Telegram/Discord 交互，能自主 fork 分支、写代码、跑测试、开 PR |

---

## 二、架构设计

### 2.1 模块总览（14 个子系统）

```
openharness/
├── engine/          # 🧠 Agent Loop — 查询 → 流式 → 工具调用 → 循环
├── api/             # 🔌 LLM API 客户端（Anthropic/OpenAI/Codex/Copilot）
├── tools/           # 🔧 43+ 工具（文件、Shell、搜索、Web、MCP）
├── skills/          # 📚 知识系统 — 按需加载 .md 技能文件
├── plugins/         # 🔌 扩展系统 — 命令、钩子、Agent、MCP 服务器
├── permissions/     # 🛡️ 安全 — 多级权限模式、路径规则、命令黑名单
├── hooks/           # ⚡ 生命周期 — PreToolUse/PostToolUse 事件钩子
├── commands/        # 💬 54 命令 — /help, /commit, /plan, /resume 等
├── mcp/             # 🌐 MCP 客户端 — Model Context Protocol 集成
├── memory/          # 🧠 记忆 — 跨会话持久化知识（MEMORY.md）
├── tasks/           # 📋 后台任务管理
├── coordinator/     # 🤝 多 Agent 协调 — 子 Agent 生成、团队管理
├── prompts/         # 📝 上下文组装 — 系统提示、CLAUDE.md、技能注入
├── config/          # ⚙️ 多层配置、迁移
├── ui/              # 🖥️ React TUI 前端 + 后端协议
├── swarm/           # 🐝 分布式 Agent 协调（工作树、邮箱、锁文件）
├── bridge/          # 🌉 会话桥接管理
├── channels/        # 📡 消息通道（Feishu/Slack/Discord/Telegram 等）
├── auth/            # 🔐 认证管理（API Key/OAuth/外部绑定）
├── sandbox/         # 🏖️ Docker 沙箱执行环境
├── services/        # ⚙️ 服务层（Cron 调度、会话存储、Token 估算等）
├── themes/          # 🎨 主题系统
├── voice/           # 🎤 语音模式（STT/关键词检测）
├── vim/             # ⌨️ Vim 模式切换
└── keybindings/     # ⌨️ 键绑定系统
```

### 2.2 核心数据流

```
用户输入 → CLI/React TUI → RuntimeBundle → QueryEngine
    → Anthropic/OpenAI API（流式）
    → tool_use 响应 → ToolRegistry
    → PermissionChecker + HookExecutor
    → 工具执行（文件/Shell/Web/MCP/任务）
    → 结果返回 QueryEngine → 循环继续
```

### 2.3 Agent Loop 核心逻辑

```python
while True:
    response = await api.stream(messages, tools)
    if response.stop_reason != "tool_use":
        break  # 模型完成
    for tool_call in response.tool_uses:
        # 权限检查 → Hook → 执行 → Hook → 结果
        result = await harness.execute_tool(tool_call)
    messages.append(tool_results)
    # 循环继续 — 模型看到结果后决定下一步
```

---

## 三、功能特性列表

### 3.1 工具系统（43+ 工具）

| 类别 | 工具 | 说明 |
|------|------|------|
| **文件 I/O** | `bash`, `file_read`, `file_write`, `file_edit`, `glob`, `grep` | 核心文件操作，带权限检查 |
| **搜索** | `web_fetch`, `web_search`, `tool_search`, `lsp` | Web 和代码搜索 |
| **Notebook** | `notebook_edit` | Jupyter Notebook 单元格编辑 |
| **Agent** | `agent`, `send_message`, `team_create`, `team_delete` | 子 Agent 生成与协调 |
| **任务** | `task_create`, `task_get`, `task_list`, `task_update`, `task_stop`, `task_output` | 后台任务全生命周期管理 |
| **MCP** | `mcp_tool`, `list_mcp_resources`, `read_mcp_resource`, `mcp_auth` | Model Context Protocol 集成 |
| **模式切换** | `enter_plan_mode`, `exit_plan_mode`, `enter_worktree`, `exit_worktree` | 工作流模式切换 |
| **定时** | `cron_create`, `cron_list`, `cron_delete`, `cron_toggle`, `remote_trigger` | 定时任务和远程触发 |
| **元工具** | `skill`, `config`, `brief`, `sleep`, `ask_user_question`, `todo_write` | 知识加载、配置、交互 |

**每个工具的通用特性**：
- Pydantic 输入验证（结构化、类型安全）
- 自描述 JSON Schema（模型自动理解工具）
- 权限集成（每次执行前检查）
- Hook 支持（PreToolUse/PostToolUse 生命周期事件）

### 3.2 技能系统（Skills）

- **按需加载**：仅在模型需要时加载 `.md` 格式的技能文件
- **内置技能**：commit、review、debug、plan、test、simplify 等
- **生态兼容**：直接兼容 [anthropics/skills](https://github.com/anthropics/skills)，复制 `.md` 文件到 `~/.openharness/skills/` 即可
- **技能搜索**：内置 `tool_search` 工具可搜索可用技能

### 3.3 插件系统（Plugins）

兼容 [claude-code plugins](https://github.com/anthropics/claude-code/tree/main/plugins)，已测试 12 个官方插件：

| 插件 | 类型 | 功能 |
|------|------|------|
| `commit-commands` | Commands | Git commit、push、PR 工作流 |
| `security-guidance` | Hooks | 文件编辑安全警告 |
| `hookify` | Commands + Agents | 创建自定义行为钩子 |
| `feature-dev` | Commands | 功能开发工作流 |
| `code-review` | Agents | 多 Agent PR 审查 |
| `pr-review-toolkit` | Agents | 专业 PR 审查 Agent |

**插件结构**：`commands/*.md`（命令）、`hooks/hooks.json`（钩子）、`agents/*.md`（Agent）

### 3.4 权限系统（Permissions）

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| **Default** | 写入/执行前询问 | 日常开发 |
| **Auto** | 允许所有操作 | 沙箱环境 |
| **Plan Mode** | 阻止所有写入 | 大型重构，先审查 |

**细粒度控制**：
- 路径级规则（如 `/etc/*` 禁止访问）
- 命令黑名单（如 `rm -rf /`、`DROP TABLE *`）
- PreToolUse / PostToolUse 钩子拦截
- 交互式审批对话框

### 3.5 记忆系统（Memory）

- **CLAUDE.md 发现与注入**：自动发现并注入项目级上下文
- **上下文压缩（Auto-Compact）**：自动压缩保留任务状态和通道日志，支持多天会话
- **MEMORY.md 持久记忆**：跨会话持久化知识
- **会话恢复与历史**：`/resume` 恢复历史会话

### 3.6 多 Agent 协调（Swarm）

- **子 Agent 生成与委派**：`agent` 工具生成子 Agent
- **团队注册与任务管理**：`team_create`/`team_delete` 管理团队
- **后台任务生命周期**：创建、查询、更新、停止、获取输出
- **工作树隔离**：`enter_worktree`/`exit_worktree` 隔离工作目录
- **邮箱通信**：`mailbox.py` 实现 Agent 间消息传递
- **锁文件管理**：`lockfile.py` 防止并发冲突
- **权限同步**：`permission_sync.py` 跨 Agent 同步权限状态

### 3.7 消息通道（Channels）

支持的消息平台：
- **飞书（Feishu）**
- **Slack**
- **Discord**
- **Telegram**
- **钉钉（DingTalk）**
- **WhatsApp**
- **Matrix**
- **QQ**
- **Email**
- **MoChat**

### 3.8 CLI 特性

```bash
oh [OPTIONS] COMMAND [ARGS]

会话:     -c/--continue, -r/--resume, -n/--name
模型:     -m/--model, --effort, --max-turns
输出:     -p/--print, --output-format text|json|stream-json
权限:     --permission-mode, --dangerously-skip-permissions
上下文:   -s/--system-prompt, --append-system-prompt, --settings
高级:     -d/--debug, --mcp-config, --bare, --dry-run

子命令:   oh setup | oh provider | oh auth | oh mcp | oh plugin
```

**非交互模式**：支持管道和脚本集成
```bash
oh -p "Explain this codebase"                           # 文本输出
oh -p "List all functions" --output-format json         # JSON 输出
oh -p "Fix the bug" --output-format stream-json         # 流式 JSON
```

**Dry-Run 安全预览**：
```bash
oh --dry-run                    # 预览运行时设置、认证状态、技能、工具
oh --dry-run -p "Review code"   # 预览提示词组装，不执行模型或工具
```

### 3.9 React TUI 终端界面

- **命令选择器**：输入 `/` → 方向键选择 → 回车
- **权限对话框**：交互式 y/n，显示工具详情
- **模式切换**：`/permissions` → 列表选择
- **会话恢复**：`/resume` → 选择历史会话
- **动画加载器**：工具执行实时反馈
- **键盘快捷键**：底部显示，上下文感知
- **Shift+Enter 换行**：保持 Enter 为提交
- **完整 Markdown 渲染**：助手消息支持完整 Markdown

### 3.10 语音模式（Voice）

- 流式语音转文字（STT）
- 关键词检测
- 语音模式切换

### 3.11 沙箱执行（Sandbox）

- Docker 容器后端
- 路径验证器
- Docker 镜像管理
- 会话隔离

### 3.12 其他特性

- **主题系统**：内置主题、自定义主题加载
- **Vim 模式**：Vim 键绑定切换
- **键绑定系统**：可自定义键绑定
- **个性化**：用户偏好提取与规则应用
- **Token 估算与成本追踪**：`CostTracker` 跟踪 API 调用成本
- **输出样式**：可配置输出格式
- **Autopilot**：自动化服务（含独立 Dashboard）

---

## 四、支持的 LLM 提供商

### 4.1 内置工作流（5 种）

| 工作流 | 说明 | 典型后端 |
|--------|------|----------|
| **Anthropic-Compatible API** | Anthropic 风格请求格式 | Claude 官方、Kimi、GLM、MiniMax |
| **Claude Subscription** | Claude CLI 订阅桥接 | 本地 `~/.claude/.credentials.json` |
| **OpenAI-Compatible API** | OpenAI 风格请求格式 | OpenAI、OpenRouter、DashScope、DeepSeek、SiliconFlow、Groq、Ollama、GitHub Models |
| **Codex Subscription** | Codex CLI 订阅桥接 | 本地 `~/.codex/auth.json` |
| **GitHub Copilot** | Copilot OAuth 工作流 | GitHub Copilot 设备流登录 |

### 4.2 Anthropic 兼容 API 后端

| 后端 | Base URL | 示例模型 |
|------|----------|----------|
| Claude 官方 | `https://api.anthropic.com` | `claude-sonnet-4-6`, `claude-opus-4-6` |
| Moonshot / Kimi | `https://api.moonshot.cn/anthropic` | `kimi-k2.5` |
| 智谱 / GLM | 自定义 Anthropic 兼容端点 | `glm-4.5` |
| MiniMax | 自定义 Anthropic 兼容端点 | `minimax-m1` |

### 4.3 OpenAI 兼容 API 后端

| 后端 | Base URL | 示例模型 |
|------|----------|----------|
| OpenAI | `https://api.openai.com/v1` | `gpt-5.4`, `gpt-4.1` |
| OpenRouter | `https://openrouter.ai/api/v1` | 按提供商 |
| 阿里 DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3.5-flash`, `qwen3-max`, `deepseek-r1` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat`, `deepseek-reasoner` |
| GitHub Models | `https://models.inference.ai.azure.com` | `gpt-4o`, `Meta-Llama-3.1-405B-Instruct` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash`, `gemini-2.5-pro` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama（本地） | `http://localhost:11434/v1` | 任意本地模型 |

### 4.4 认证方式

| 方式 | 说明 |
|------|------|
| API Key | 标准 API 密钥认证 |
| OAuth Device Flow | GitHub Copilot 设备流登录 |
| External OAuth | Codex/Claude 订阅外部 OAuth |
| Profile-scoped | 每个 Profile 独立绑定凭据 |

---

## 五、评测/测试能力

### 5.1 测试套件

| 套件 | 测试数 | 状态 |
|------|--------|------|
| Unit + Integration | 114 | ✅ 全部通过 |
| CLI Flags E2E | 6 | ✅ 真实模型调用 |
| Harness Features E2E | 9 | ✅ 重试、技能、并行、权限 |
| React TUI E2E | 3 | ✅ 欢迎、对话、状态 |
| TUI Interactions E2E | 4 | ✅ 命令、权限、快捷键 |
| Real Skills + Plugins | 12 | ✅ anthropics/skills + claude-code/plugins |

### 5.2 测试覆盖范围

测试目录结构覆盖了几乎所有子系统：
- `test_api/`：OpenAI/Codex/Copilot 客户端、认证
- `test_engine/`：查询引擎、消息处理
- `test_tools/`：核心工具、MCP 工具、任务工具、bash 工具
- `test_permissions/`：权限检查器
- `test_hooks/`：钩子执行器
- `test_skills/`：技能加载器
- `test_plugins/`：插件加载器、生命周期
- `test_mcp/`：MCP 集成（HTTP/stdio 流程、错误处理）
- `test_swarm/`：团队生命周期、邮箱、工作树、注册表、子进程后端
- `test_coordinator/`：Agent 定义、注册表、协调模式
- `test_memory/`：记忆目录
- `test_config/`：路径、设置、输出样式
- `test_ui/`：React 后端、模式、运行时、Textual 应用
- `test_sandbox/`：Docker 后端、路径验证、适配器
- `test_services/`：Cron 调度、压缩、Autopilot、会话存储
- `test_bridge/`：会话流、核心桥接
- `test_ohmo/`：Gateway、CLI、会话存储、提示词、工作区
- `test_auth/`：外部认证
- `test_personalization/`：提取器
- `test_channels/`：通道基类

### 5.3 CI/CD

- GitHub Actions CI 工作流
- Autopilot Pages/Scan/Run 工作流
- 测试运行命令：`uv run pytest -q`

---

## 六、工具/函数调用能力

### 6.1 工具基类设计

```python
class BaseTool(ABC):
    name: str
    description: str
    input_model: type[BaseModel]  # Pydantic 模型

    async def execute(self, arguments: BaseModel, context: ToolExecutionContext) -> ToolResult
    def is_read_only(self, arguments: BaseModel) -> bool
    def to_api_schema(self) -> dict[str, Any]  # JSON Schema 输出
```

### 6.2 工具注册与发现

- `ToolRegistry`：集中注册、按名查找、批量导出 API Schema
- `tool_search`：运行时搜索可用工具
- 自动 JSON Schema 生成：模型无需手动配置即可理解工具

### 6.3 MCP（Model Context Protocol）集成

- **传输协议**：stdio + HTTP（自动重连）
- **工具兼容**：JSON Schema 类型自动推断，无需手动映射
- **资源管理**：`list_mcp_resources`、`read_mcp_resource`
- **认证**：`mcp_auth` 工具处理 MCP 服务器认证
- **容错**：断开的服务器优雅处理

---

## 七、基准测试（Benchmark）能力

项目本身**不包含内置基准测试套件**，但提供了以下支持基准测试的能力：

1. **E2E 测试脚本**：
   - `scripts/test_harness_features.py`：Harness 特性 E2E
   - `scripts/test_real_skills_plugins.py`：真实插件 E2E
   - `scripts/test_cli_flags.py`：CLI 标志 E2E
   - `scripts/e2e_smoke.py`：冒烟测试
   - `scripts/test_docker_sandbox_e2e.py`：Docker 沙箱 E2E

2. **Autopilot 系统**：
   - 自动化测试执行和验证
   - 独立 Dashboard 展示结果

3. **Claude Skills 中的评估技能**：
   - `.claude/skills/harness-eval/SKILL.md`：Harness 评估技能
   - `.claude/skills/harness-eval/references/feature-matrix.md`：特性矩阵
   - `.claude/skills/harness-eval/references/test-patterns.md`：测试模式

---

## 八、插件/扩展机制

### 8.1 扩展层次

| 层次 | 机制 | 格式 |
|------|------|------|
| **工具（Tools）** | Python 类继承 `BaseTool` | Pydantic 输入模型 + JSON Schema |
| **技能（Skills）** | Markdown 文件 | `.md` 文件，带 YAML frontmatter |
| **插件（Plugins）** | 目录结构 | `plugin.json` + `commands/*.md` + `hooks/hooks.json` + `agents/*.md` |
| **MCP 服务器** | 配置文件 | MCP 配置 + stdio/HTTP 传输 |
| **通道（Channels）** | Python 适配器 | 继承通道基类 |

### 8.2 自定义工具示例

```python
from pydantic import BaseModel, Field
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

class MyToolInput(BaseModel):
    query: str = Field(description="Search query")

class MyTool(BaseTool):
    name = "my_tool"
    description = "Does something useful"
    input_model = MyToolInput

    async def execute(self, arguments: MyToolInput, context: ToolExecutionContext) -> ToolResult:
        return ToolResult(output=f"Result for: {arguments.query}")
```

### 8.3 自定义技能示例

```markdown
---
name: my-skill
description: Expert guidance for my specific domain
---

# My Skill

## When to use
Use when the user asks about [your domain].

## Workflow
1. Step one
2. Step two
```

---

## 九、部署方式

### 9.1 本地安装

```bash
# Linux / macOS / WSL 一键安装
curl -fsSL https://raw.githubusercontent.com/HKUDS/OpenHarness/main/scripts/install.sh | bash

# Windows PowerShell 一键安装
iex (Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/HKUDS/OpenHarness/main/scripts/install.ps1')

# 或通过 pip
pip install openharness-ai
```

### 9.2 开发环境

```bash
git clone https://github.com/HKUDS/OpenHarness.git
cd OpenHarness
uv sync --extra dev
uv run pytest -q
```

### 9.3 ohmo 个人 Agent 部署

```bash
ohmo init             # 初始化 ~/.ohmo 工作区
ohmo config           # 配置通道和提供商
ohmo gateway start    # 启动 Gateway
```

### 9.4 非交互/CI 部署

```bash
oh -p "Review code" --output-format json        # JSON 管道
oh -p "Fix bug" --output-format stream-json     # 流式 JSON
```

### 9.5 Docker 沙箱

项目包含 Docker 沙箱后端（`sandbox/docker_backend.py`），支持在容器中安全执行工具。

---

## 十、技术栈与依赖

### 10.1 核心依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `anthropic` | ≥0.40.0 | Anthropic API 客户端 |
| `openai` | ≥1.0.0 | OpenAI API 客户端 |
| `rich` | ≥13.0.0 | 终端富文本渲染 |
| `prompt-toolkit` | ≥3.0.0 | 交互式命令行 |
| `textual` | ≥0.80.0 | TUI 框架 |
| `typer` | ≥0.12.0 | CLI 框架 |
| `pydantic` | ≥2.0.0 | 数据验证和 Schema |
| `httpx` | ≥0.27.0 | HTTP 客户端 |
| `websockets` | ≥12.0 | WebSocket 支持 |
| `mcp` | ≥1.0.0 | Model Context Protocol |
| `pyperclip` | ≥1.9.0 | 剪贴板操作 |
| `pyyaml` | ≥6.0 | YAML 解析 |
| `questionary` | ≥2.0.1 | 交互式问答 |
| `watchfiles` | ≥0.20.0 | 文件监控 |
| `croniter` | ≥2.0.0 | Cron 表达式解析 |
| `slack-sdk` | ≥3.0.0 | Slack 集成 |
| `python-telegram-bot` | ≥21.0.0 | Telegram 集成 |
| `discord.py` | ≥2.0.0 | Discord 集成 |
| `lark-oapi` | ≥1.5.0 | 飞书集成 |

### 10.2 开发依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `pexpect` | ≥4.9.0 | 进程交互测试 |
| `pytest` | ≥8.0.0 | 测试框架 |
| `pytest-asyncio` | ≥0.23.0 | 异步测试 |
| `pytest-cov` | ≥5.0.0 | 覆盖率 |
| `ruff` | ≥0.5.0 | Linting |
| `mypy` | ≥1.10.0 | 类型检查 |

### 10.3 前端技术栈

- **React + Ink**：终端 UI 框架
- **TypeScript**：类型安全
- **Vite**：构建工具（Autopilot Dashboard）

### 10.4 构建系统

- **Hatchling**：Python 打包
- **Python ≥3.10**：最低版本要求

---

## 十一、项目成熟度评估

### 11.1 版本状态

| 维度 | 评估 |
|------|------|
| **当前版本** | v0.1.7（早期阶段） |
| **首次发布** | 2026-04-01（v0.1.0） |
| **迭代速度** | 约 1 周 1 个小版本，迭代较快 |
| **API 稳定性** | 尚未到 1.0，API 可能变动 |

### 11.2 代码质量

| 维度 | 评估 |
|------|------|
| **测试覆盖** | 114 单元/集成测试 + 34 E2E 测试，覆盖全面 |
| **类型安全** | Pydantic 验证 + mypy strict 模式 |
| **代码风格** | Ruff linting，行宽 100 |
| **文档** | README 详尽（中英文）、CONTRIBUTING、CHANGELOG、SHOWCASE |
| **CI** | GitHub Actions 自动化 |

### 11.3 功能完整度

| 模块 | 完成度 | 备注 |
|------|--------|------|
| Agent Loop | ✅ 完整 | 流式、重试、并行工具执行 |
| 工具系统 | ✅ 完整 | 43+ 工具，覆盖全面 |
| 技能系统 | ✅ 完整 | 兼容 anthropics/skills |
| 插件系统 | ✅ 完整 | 兼容 claude-code/plugins |
| 权限系统 | ✅ 完整 | 多级模式 + 路径/命令规则 |
| 记忆系统 | ✅ 完整 | 持久化 + 自动压缩 |
| 多 Agent | ⚠️ 基本可用 | 基础协调已实现，ClawTeam 集成在路线图中 |
| MCP | ✅ 完整 | stdio + HTTP，自动重连 |
| 通道集成 | ✅ 完整 | 10+ 平台 |
| 语音模式 | ⚠️ 基础 | STT 框架存在，但各提供商标注"not wired" |
| 沙箱 | ⚠️ 基本可用 | Docker 后端已实现 |
| 主题/键绑定 | ✅ 完整 | 可自定义 |

### 11.4 风险与局限

1. **版本尚早**：v0.1.7，API 和内部结构可能变动
2. **依赖较多**：20+ 直接依赖，可能存在版本冲突风险
3. **语音模式不完整**：各提供商均标注 voice mode 未接线
4. **多 Agent 协调初步**：ClawTeam 集成仍在路线图
5. **无内置基准测试**：缺少标准化的 Agent 能力评估基准

### 11.5 综合评分

| 维度 | 评分（/10） | 说明 |
|------|------------|------|
| 架构设计 | 8 | 模块化清晰，14 个子系统分工明确 |
| 功能完整度 | 8 | 核心功能齐全，部分高级特性待完善 |
| 代码质量 | 8 | 类型安全、测试覆盖好、Linting 严格 |
| 文档质量 | 9 | README 极其详尽，中英文双语 |
| 生态兼容 | 9 | 兼容 anthropics/skills 和 claude-code/plugins |
| 社区活跃度 | 7 | 早期项目，需观察长期贡献趋势 |
| **综合** | **8.0** | **高质量的早期开源项目，架构设计优秀，值得持续关注** |

---

## 十二、总结

OpenHarness 是一个**架构设计优秀、功能覆盖全面的 AI Agent 基础设施框架**。它的核心价值在于：

1. **透明可检视**：让研究者和开发者完整理解生产级 AI Agent 的运行机制
2. **生态兼容**：无缝兼容 Anthropic 的 skills 和 plugins 生态
3. **多 Provider 支持**：从 Claude 到 Ollama，覆盖主流 LLM 提供商
4. **完整的工具链**：43+ 工具 + 54 命令，覆盖文件、Shell、搜索、Web、MCP、任务管理等
5. **多 Agent 协调**：内置团队、任务、工作树、邮箱等协调原语
6. **ohmo 个人 Agent**：开箱即用的个人 AI 助手，支持 10+ 消息平台

作为一个 v0.1.7 的早期项目，它已经展现了相当高的完成度和工程质量。对于想要理解、实验或构建 AI Agent 系统的研究者和开发者来说，这是一个值得关注的项目。
