# Deep Agents 项目深度分析报告

> 项目地址：https://github.com/langchain-ai/deepagents
> 分析时间：2026-04-28
> 版本：SDK v0.5.3 / CLI v0.0.41

---

## 1. 项目定位与核心理念

**Deep Agents** 是 LangChain 官方推出的 **Agent 运行时框架（Agent Harness）**，定位为"开箱即用的通用 AI Agent 套件"。它的核心理念是：

- **"Batteries-included"**：不需要手动拼装 prompt、工具和上下文管理，安装即可获得一个可工作的 Agent
- **受 Claude Code 启发**：项目明确表示灵感来自 Claude Code，目标是将 Claude Code 的通用化能力提取出来并进一步泛化
- **LangGraph 原生**：`create_deep_agent()` 返回的是一个编译好的 LangGraph 图，天然支持流式输出、持久化、检查点等 LangGraph 生态能力
- **"Trust the LLM" 安全模型**：不在 prompt 层面限制模型，而是在工具/沙箱层面强制执行边界
- **100% 开源**：MIT 许可证，完全可扩展

---

## 2. 架构设计

### 2.1 整体仓库结构

```
deepagents/
├── libs/
│   ├── deepagents/      # 核心 SDK（Python 包）
│   ├── cli/             # 终端 CLI 应用（deepagents-cli）
│   ├── acp/             # Agent Client Protocol 集成
│   ├── evals/           # 评估套件 + Harbor 集成
│   ├── repl/            # REPL 环境（langchain-repl）
│   └── partners/        # 第三方集成
│       ├── daytona/     # Daytona 沙箱
│       ├── modal/       # Modal 沙箱
│       ├── quickjs/     # JavaScript REPL 中间件
│       └── runloop/     # Runloop 沙箱
├── examples/            # 15 个示例项目
├── action.yml           # GitHub Actions 集成
└── .github/             # CI/CD 配置
```

### 2.2 核心 SDK 模块架构

```
deepagents/
├── __init__.py          # 公共 API 导出
├── graph.py             # 核心：create_deep_agent() 图组装
├── _models.py           # 模型解析与初始化
├── _version.py          # 版本管理
├── profiles/            # 提供商特定配置
│   ├── _harness_profiles.py  # 配置注册表与合并逻辑
│   ├── _openai.py            # OpenAI 特殊配置
│   └── _openrouter.py        # OpenRouter 特殊配置
├── middleware/           # 中间件层（核心扩展点）
│   ├── filesystem.py    # 文件系统工具（read/write/edit/ls/glob/grep/execute）
│   ├── subagents.py     # 同步子 Agent（task 工具）
│   ├── async_subagents.py  # 异步/远程子 Agent
│   ├── memory.py        # AGENTS.md 记忆加载
│   ├── skills.py        # 技能系统（SKILL.md 加载）
│   ├── summarization.py # 自动对话摘要与压缩
│   ├── permissions.py   # 文件系统权限控制
│   └── patch_tool_calls.py # 工具调用修补
└── backends/            # 存储后端抽象层
    ├── protocol.py      # BackendProtocol 接口定义
    ├── state.py         # StateBackend（内存/状态）
    ├── filesystem.py    # FilesystemBackend（本地文件系统）
    ├── local_shell.py   # LocalShellBackend（本地 shell 执行）
    ├── sandbox.py       # BaseSandbox（远程沙箱基类）
    ├── langsmith.py     # LangSmith 沙箱集成
    ├── composite.py     # CompositeBackend（组合后端）
    └── store.py         # StoreBackend（持久化存储）
```

### 2.3 数据流

```
用户输入
  ↓
create_deep_agent() 组装 LangGraph 图
  ↓
中间件栈（按顺序执行）：
  1. TodoListMiddleware（任务规划）
  2. SkillsMiddleware（技能加载）
  3. FilesystemMiddleware（文件工具注入）
  4. SubAgentMiddleware（子 Agent 注入）
  5. SummarizationMiddleware（上下文压缩）
  6. PatchToolCallsMiddleware
  7. AsyncSubAgentMiddleware（异步子 Agent）
  8. [用户自定义中间件]
  9. [提供商特定中间件]
  10. AnthropicPromptCachingMiddleware
  11. MemoryMiddleware（记忆加载）
  12. HumanInTheLoopMiddleware（人工审批）
  13. _PermissionMiddleware（权限控制，始终最后）
  ↓
LLM 调用（支持工具调用）
  ↓
工具执行（通过 Backend 协议）
  ↓
结果返回 → 流式输出
```

---

## 3. 功能特性列表

### 3.1 内置工具

| 工具 | 功能 | 说明 |
|------|------|------|
| `write_todos` | 任务规划与进度追踪 | TodoListMiddleware 提供 |
| `read_file` | 读取文件 | 支持行号、偏移量、限制行数 |
| `write_file` | 写入文件 | 新建文件，已存在则报错 |
| `edit_file` | 精确文本替换 | 支持 replace_all 模式 |
| `ls` | 列出目录内容 | 返回文件元数据（大小、修改时间等） |
| `glob` | 模式匹配查找文件 | 支持标准 glob 语法 |
| `grep` | 文本搜索 | 精确字符串匹配，支持 glob 过滤 |
| `execute` | 执行 shell 命令 | 需要 SandboxBackendProtocol 支持 |
| `task` | 委托子 Agent | 支持同步、编译、异步三种子 Agent |
| `compact_conversation` | 手动触发对话压缩 | SummarizationToolMiddleware 提供 |

### 3.2 中间件系统

- **TodoListMiddleware**：内置任务规划，模型可创建、更新、完成待办事项
- **FilesystemMiddleware**：文件系统操作工具注入，支持多种后端
- **SubAgentMiddleware**：同步子 Agent 管理，自动注入 `task` 工具
- **AsyncSubAgentMiddleware**：异步/远程子 Agent，通过 Agent Protocol 连接
- **MemoryMiddleware**：从 AGENTS.md 文件加载项目上下文/记忆
- **SkillsMiddleware**：技能系统，支持渐进式加载和来源分层
- **SummarizationMiddleware**：自动对话摘要，当 token 超阈值时触发
- **SummarizationToolMiddleware**：提供 `compact_conversation` 工具供模型主动触发
- **HumanInTheLoopMiddleware**：在指定工具调用前暂停等待人工审批
- **_PermissionMiddleware**：文件系统访问控制（基于 glob 模式的 allow/deny 规则）
- **AnthropicPromptCachingMiddleware**：Anthropic 模型的 prompt 缓存优化
- **PatchToolCallsMiddleware**：工具调用修补
- **_ToolExclusionMiddleware**：按提供商排除特定工具

### 3.3 记忆/上下文管理

- **AGENTS.md 规范**：遵循 [agents.md](https://agents.md/) 规范，支持从多个路径加载记忆文件
- **多来源分层**：支持 `~/.deepagents/AGENTS.md`（用户级）+ `./.deepagents/AGENTS.md`（项目级）
- **自动注入系统提示**：记忆内容自动合并到 system prompt
- **Anthropic 缓存控制**：对 Anthropic 模型自动添加 `cache_control` 断点
- **CLI 持久化记忆**：CLI 支持跨会话持久化记忆（基于 actions/cache）

### 3.4 技能系统

- **SKILL.md 格式**：每个技能是包含 `SKILL.md` 的目录，YAML frontmatter + Markdown 指令
- **来源分层**：支持多来源加载（base → user → project → team），后者覆盖前者
- **渐进式加载**：按需注入系统提示，不占用无关上下文
- **元数据支持**：name、description、license、compatibility、allowed_tools
- **POSIX 路径**：所有路径使用 POSIX 规范

### 3.5 子 Agent 协作

#### 同步子 Agent（SubAgent / CompiledSubAgent）
- 声明式规格：name + description + system_prompt
- 可覆盖 model、tools、middleware、interrupt_on、skills
- 自动继承父 Agent 的工具和中断配置
- 内置通用子 Agent（general-purpose）自动添加

#### 异步子 Agent（AsyncSubAgent）
- 连接远程 Agent Protocol 服务器
- 通过 LangGraph SDK 调用，支持 LangGraph Platform 和自托管服务器
- 后台运行，主 Agent 可监控进度、发送更新、取消任务
- 暴露 launch、check、update、cancel、list 等工具

#### CLI 子 Agent
- CLI 层面的子 Agent 管理
- 支持独立上下文窗口

### 3.6 对话管理

- **自动摘要**：token 超过阈值（默认 85%）时自动压缩历史
- **可配置触发条件**：支持 `("fraction", 0.85)` 或 `("tokens", 100000)` 格式
- **历史保留**：可配置保留最近 N 条消息（默认按比例保留 10%）
- **离线存储**：被压缩的消息保存为 Markdown 文件 `/conversation_history/{thread_id}.md`
- **手动触发**：通过 `compact_conversation` 工具主动压缩

---

## 4. 支持的 LLM 提供商

### 4.1 默认模型
- **Anthropic Claude Sonnet 4**（`claude-sonnet-4-6`）— 默认模型，需要 `ANTHROPIC_API_KEY`

### 4.2 内置支持（SDK 直接依赖）
- **Anthropic**（`langchain-anthropic`）— 完整支持，含 prompt caching
- **Google GenAI**（`langchain-google-genai`）— Gemini 系列

### 4.3 CLI 额外支持（通过 optional dependencies）
| 提供商 | 包名 | 说明 |
|--------|------|------|
| OpenAI | `langchain-openai` | GPT 系列，支持 Responses API |
| Anthropic | `langchain-anthropic` | Claude 系列 |
| Google GenAI | `langchain-google-genai` | Gemini 系列 |
| OpenRouter | `langchain-openrouter` | 多模型路由，含应用归属 |
| NVIDIA | `langchain-nvidia-ai-endpoints` | Nemotron 等 |
| Ollama | `langchain-ollama` | 本地模型 |
| Groq | `langchain-groq` | 高速推理 |
| Mistral AI | `langchain-mistralai` | Mistral 系列 |
| Cohere | `langchain-cohere` | Command 系列 |
| Fireworks | `langchain-fireworks` | Fireworks AI |
| DeepSeek | `langchain-deepseek` | DeepSeek 系列 |
| HuggingFace | `langchain-huggingface` | Hub 模型 |
| IBM | `langchain-ibm` | watsonx |
| LiteLLM | `langchain-litellm` | 统一接口 |
| Baseten | `langchain-baseten` | 托管推理 |
| AWS Bedrock | `langchain-aws` | Bedrock 服务 |
| Vertex AI | `langchain-google-vertexai` | GCP Vertex |
| xAI | `langchain-xai` | Grok 系列 |
| Perplexity | `langchain-perplexity` | Perplexity AI |

### 4.4 提供商特定配置（Harness Profiles）

通过 `_HarnessProfile` 系统，不同提供商可以注册特定行为：
- **OpenAI**：默认启用 Responses API（`use_responses_api=True`）
- **OpenRouter**：版本检查 + 应用归属 headers
- **Anthropic**：prompt caching 中间件（自动应用于所有栈）

---

## 5. 工具/函数调用能力

### 5.1 工具类型支持
- **BaseTool**：LangChain 标准工具对象
- **Callable**：普通 Python 函数（通过 `@tool` 装饰器或直接传递）
- **dict**：JSON Schema 格式的工具定义

### 5.2 工具增强
- **工具描述覆盖**：通过 profile 的 `tool_description_overrides` 按提供商重写描述
- **工具排除**：通过 `_ToolExclusionMiddleware` 按提供商过滤工具
- **MCP 支持**：通过 `langchain-mcp-adapters` 集成 MCP 工具
- **动态工具过滤**：中间件可在每次 LLM 调用前动态增删工具

### 5.3 沙箱执行
- **本地执行**：`LocalShellBackend`（无隔离，开发用）
- **远程沙箱**：LangSmith Sandbox、Daytona、Modal、Runloop、AgentCore
- **超时控制**：支持 per-command 超时设置

---

## 6. 插件/扩展机制

### 6.1 中间件（Middleware）
最核心的扩展点。继承 `AgentMiddleware` 并重写：
- `wrap_model_call()`：拦截每次 LLM 请求，可修改工具列表、注入系统提示、转换消息
- 维护跨轮次状态
- 可在工具执行前后添加逻辑

### 6.2 后端（Backend）
通过 `BackendProtocol` 抽象，可插拔存储和执行：
- `StateBackend`：内存状态（默认）
- `FilesystemBackend`：本地文件系统
- `LocalShellBackend`：本地文件系统 + shell 执行
- `StoreBackend`：基于 LangGraph Store 的持久化
- `CompositeBackend`：组合多个后端
- `LangSmithSandbox`：LangSmith 托管沙箱
- 自定义后端：实现 `BackendProtocol` 即可

### 6.3 技能（Skills）
- SKILL.md 格式的声明式技能
- 支持辅助脚本和文件
- 多来源分层覆盖

### 6.4 Harness Profiles
- 提供商级和模型级的配置覆盖
- 支持自定义系统提示、工具描述、中间件、初始化参数

### 6.5 MCP 集成
- 通过 `langchain-mcp-adapters` 支持 Model Context Protocol
- CLI 内置 MCP 工具管理和信任机制

---

## 7. 部署方式

### 7.1 SDK 使用
```bash
pip install deepagents
# 或
uv add deepagents
```

### 7.2 CLI 安装
```bash
curl -LsSf https://raw.githubusercontent.com/langchain-ai/deepagents/main/libs/cli/scripts/install.sh | bash
# 或
uv tool install 'deepagents-cli[nvidia,ollama]'
```

### 7.3 GitHub Actions
通过 `action.yml` 集成到 GitHub CI/CD：
- 支持 prompt 输入、模型选择
- 自动检测 API Key（Anthropic、OpenAI、Google）
- 支持技能仓库克隆
- 支持跨运行持久化记忆（基于 actions/cache）
- 可配置 shell 允许列表和超时

### 7.4 远程部署
- **LangGraph Platform**：托管部署
- **自托管服务器**：Agent Protocol 兼容
- **`deepagents deploy` 命令**：CLI 内置部署功能

### 7.5 沙箱环境
- **LangSmith Sandbox**：托管沙箱
- **Daytona**：云沙箱
- **Modal**：Serverless 沙箱
- **Runloop**：托管沙箱
- **AgentCore**：代码解释器沙箱

---

## 8. 技术栈与依赖

### 8.1 核心依赖
| 包 | 用途 |
|-----|------|
| `langchain-core` (≥1.2.27) | LangChain 核心抽象 |
| `langchain` (≥1.2.15) | Agent 创建框架 |
| `langchain-anthropic` (≥1.4.0) | Anthropic 模型支持 |
| `langchain-google-genai` (≥4.2.1) | Google Gemini 支持 |
| `langsmith` (≥0.7.35) | 可观测性与追踪 |
| `wcmatch` | 高级 glob 匹配（权限系统用） |

### 8.2 CLI 额外依赖
| 包 | 用途 |
|-----|------|
| `textual` (≥8.0.0) | TUI 框架 |
| `rich` (≥14.0.0) | 终端格式化 |
| `tavily-python` | Web 搜索 |
| `langchain-mcp-adapters` | MCP 集成 |
| `langgraph-sdk` | 远程 Agent 连接 |
| `langgraph-cli[inmem]` | 本地服务器 |
| `langgraph-checkpoint-sqlite` | SQLite 检查点 |
| `pyperclip` | 剪贴板操作 |
| `pillow` | 图片处理 |
| `markdownify` | HTML 转 Markdown |

### 8.3 开发工具
- **Ruff**：代码格式化和 linting
- **ty**：类型检查
- **pytest**：测试框架（含 asyncio、benchmark、coverage）
- **Hatchling / Setuptools**：构建系统
- **uv**：包管理
- **pre-commit**：Git hooks

### 8.4 运行要求
- Python ≥ 3.11, < 4.0
- 支持 Python 3.11、3.12、3.13、3.14

---

## 9. 项目成熟度评估

### 9.1 版本状态
| 组件 | 版本 | 状态 |
|------|------|------|
| SDK (`deepagents`) | 0.5.3 | **Beta**（Development Status :: 4） |
| CLI (`deepagents-cli`) | 0.0.41 | **Beta** |
| ACP (`deepagents-acp`) | 0.0.6 | **Alpha**（Development Status :: 3） |
| Evals (`deepagents-evals`) | 0.0.1 | **Alpha** |
| REPL (`langchain-repl`) | 0.0.1 | 未标注 |

### 9.2 优势
- **LangChain 生态背书**：由 LangChain AI 官方维护，有强大的社区和商业支持
- **架构设计优秀**：中间件模式高度可扩展，后端协议抽象清晰
- **文档完善**：有完整的文档站点、API 参考、示例项目（15 个）
- **测试覆盖**：大量单元测试，覆盖中间件、后端、异步等场景
- **CI/CD 完善**：release-please 自动版本管理、pre-commit hooks
- **活跃开发**：从 CHANGELOG 和版本号看，迭代频繁

### 9.3 待改进
- **SDK 仍在 Beta**：API 可能变化（如 `files_update` 已标记废弃，v0.7 移除）
- **CLI 版本号较低**（0.0.41）：功能可能还不稳定
- **ACP 和 Evals 处于 Alpha**：这些模块还在早期
- **安全模型激进**："Trust the LLM" 模式在生产环境需要谨慎
- **本地执行无隔离**：`LocalShellBackend` 明确警告不适合生产环境

### 9.4 总体评价

Deep Agents 是一个 **设计精良、功能丰富、处于快速迭代中的 Agent 框架**。它成功地将 Claude Code 式的通用 Agent 能力提取为可复用的开源框架，并通过 LangGraph 生态获得了强大的运行时支持。中间件架构和后端协议的抽象设计使得扩展性非常好。

对于需要快速构建具有文件操作、shell 执行、子 Agent 协作能力的 AI Agent 的开发者来说，这是一个非常有价值的选择。但由于仍处于 Beta 阶段，在生产环境中使用需要做好 API 变化的准备。

---

## 10. 示例项目概览

| 示例 | 说明 |
|------|------|
| `deep_research` | 多步网络研究 Agent，使用 Tavily 搜索、并行子 Agent、策略反思 |
| `content-builder-agent` | 内容写作 Agent，演示记忆、技能和子 Agent |
| `text-to-sql-agent` | 自然语言转 SQL，使用技能工作流和 Chinook 数据库 |
| `deploy-coding-agent` | 部署示例：自主编码 Agent + LangSmith 沙箱 |
| `deploy-content-writer` | 部署示例：内容写作 Agent + 每用户记忆 + Supabase 认证 |
| `deploy-mcp-docs-agent` | 部署示例：文档研究 Agent + MCP 工具 |
| `deploy-gtm-agent` | 部署示例：GTM 策略 Agent，协调同步和异步子 Agent |
| `async-subagent-server` | 自托管 Agent Protocol 服务器示例 |
| `nvidia_deep_agent` | 多模型 Agent，NVIDIA Nemotron 研究 + RAPIDS GPU 加速 |
| `ralph_mode` | 自主循环模式，每次迭代使用新上下文 |
| `rlm_agent` | 递归 REPL + PTC 子 Agent 链的并行扇出 |
| `repl_swarm` | 技能模块示例：TypeScript swarm 技能在 QuickJS REPL 中调度子 Agent |
| `downloading_agents` | 演示 Agent 即文件夹的概念 |
| `better-harness` | 基于评估的外部循环优化 |
