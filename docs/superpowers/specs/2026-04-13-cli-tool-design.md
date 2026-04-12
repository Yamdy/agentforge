# CLI 工具设计文档

**日期**: 2026-04-13  
**作者**: AgentForge Team  
**版本**: 0.1.0  
**类型**: Design Spec

## 概述

本文档描述 AgentForge CLI 工具的设计，参考了 Mastra CLI 的架构设计，提供完整的项目脚手架、开发工具和运行时支持。

## 目标

- 提供简单易用的命令行界面
- 支持项目初始化和脚手架生成
- 提供开发服务器（热重载）
- 支持生产构建和部署
- 集成交互式提示，提升用户体验

## 参考项目

- **Mastra CLI**: 主要参考对象，命令结构和交互模式
- **OpenCode CLI**: 开发工具集成参考

## 架构设计

### 目录结构

```
src/cli/
├── index.ts                    # CLI 主入口
├── commands/
│   ├── create/
│   │   ├── index.ts           # create 命令入口
│   │   └── create.ts          # create 命令实现
│   ├── init/
│   │   ├── index.ts           # init 命令入口
│   │   ├── init.ts            # init 命令实现
│   │   └── utils.ts           # init 辅助函数
│   ├── dev/
│   │   ├── index.ts           # dev 命令入口
│   │   ├── dev.ts             # dev 命令实现
│   │   └── bundler.ts         # 开发构建器
│   ├── build/
│   │   ├── index.ts           # build 命令入口
│   │   ├── build.ts           # build 命令实现
│   │   └── bundler.ts         # 生产构建器
│   ├── start/
│   │   ├── index.ts           # start 命令入口
│   │   └── start.ts           # start 命令实现
│   ├── run/
│   │   ├── index.ts           # run 命令入口
│   │   └── run.ts             # run 命令实现
│   ├── lint/
│   │   ├── index.ts           # lint 命令入口
│   │   ├── lint.ts            # lint 命令实现
│   │   └── rules/             # 检查规则
│   └── studio/
│       ├── index.ts           # studio 命令入口
│       └── studio.ts          # studio 命令实现
├── services/
│   ├── file.ts                # 文件操作服务
│   ├── deps.ts                # 依赖安装服务
│   └── env.ts                 # 环境变量服务
├── utils/
│   ├── logger.ts              # 日志工具
│   ├── template.ts            # 模板生成工具
│   ├── package-manager.ts     # 包管理器检测
│   └── constants.ts           # 常量定义
└── templates/
    ├── project/               # 项目模板
    │   ├── basic/
    │   ├── workflow/
    │   └── full/
    └── files/                 # 单个文件模板
        ├── agent.ts.template
        ├── workflow.ts.template
        └── config.ts.template
```

### 核心原则

1. **命令分离** - 每个命令独立目录，便于维护
2. **服务复用** - 文件、依赖、环境等服务跨命令共享
3. **模板驱动** - 使用模板生成项目文件
4. **友好交互** - 使用 @clack/prompts 提供流畅体验

## 命令设计

### 1. `agentforge create [project-name]`

创建新项目。

**选项**:

- `--default` - 使用默认配置快速创建
- `-d, --dir <directory>` - 目标目录
- `-t, --template <template>` - 项目模板 (basic/workflow/full)
- `--no-example` - 不包含示例代码
- `--no-git` - 不初始化 git

**交互流程**:

1. 询问项目名称（如果未提供）
2. 选择模板类型
3. 选择 LLM 提供商
4. 询问是否包含示例
5. 初始化项目、安装依赖

### 2. `agentforge init`

在现有项目中初始化 agentforge。

**选项**:

- `-d, --dir <directory>` - agentforge 文件目录（默认 src/agentforge）
- `--default` - 使用默认配置
- `--example` - 包含示例代码

**功能**:

- 创建目录结构
- 生成配置文件
- 创建示例 agent/workflow

### 3. `agentforge dev`

启动开发服务器（热重载）。

**选项**:

- `-d, --dir <dir>` - agentforge 目录
- `-p, --port <port>` - 端口（默认 4111）
- `-e, --env <file>` - 环境变量文件
- `--inspect` - 启用调试模式

**功能**:

- 监听文件变化
- 自动重新加载
- 启动 HTTP API 服务器

### 4. `agentforge build`

构建生产版本。

**选项**:

- `-d, --dir <dir>` - 源目录
- `-o, --output <dir>` - 输出目录（默认 .agentforge/output）
- `--minify` - 压缩代码

### 5. `agentforge start`

启动生产服务器。

**选项**:

- `-d, --dir <dir>` - 构建输出目录
- `-p, --port <port>` - 端口
- `-e, --env <file>` - 环境变量文件

### 6. `agentforge run`

运行单个 agent 或 workflow。

**选项**:

- `-a, --agent <name>` - 运行指定 agent
- `-w, --workflow <name>` - 运行指定 workflow
- `-p, --prompt <text>` - 输入提示
- `-i, --interactive` - 交互式模式

### 7. `agentforge lint`

检查项目配置。

**选项**:

- `-d, --dir <dir>` - 项目目录
- `--fix` - 自动修复问题

### 8. `agentforge studio`

启动可视化工作室（预留，后续实现）。

## 技术栈

### 核心依赖

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "@clack/prompts": "^0.7.0",
    "picocolors": "^1.0.0",
    "execa": "^8.0.0",
    "chokidar": "^3.6.0"
  }
}
```

### 主要文件职责

| 文件                                | 职责                   |
| ----------------------------------- | ---------------------- |
| `src/cli/index.ts`                  | 主入口，注册所有命令   |
| `src/cli/utils/logger.ts`           | 统一日志输出（带颜色） |
| `src/cli/utils/template.ts`         | 模板渲染引擎           |
| `src/cli/services/file.ts`          | 文件读写、目录创建     |
| `src/cli/services/deps.ts`          | 检测并安装 npm 依赖    |
| `src/cli/commands/create/create.ts` | 创建新项目逻辑         |
| `src/cli/commands/init/init.ts`     | 初始化现有项目逻辑     |
| `src/cli/commands/dev/dev.ts`       | 开发服务器逻辑         |

## 与现有代码集成

- 复用 `src/server/index.ts` 的 `createApp` 和 `startServer`
- 复用 `src/config/loader.ts` 加载配置
- 复用 `src/agent/factory.ts` 创建 agent

## 模板文件

项目模板将生成：

- `src/agentforge/index.ts` - 主入口
- `src/agentforge/agents/` - agent 目录
- `src/agentforge/workflows/` - workflow 目录
- `src/agentforge/tools/` - 工具目录
- `.env.example` - 环境变量示例
- `agentforge.config.ts` - 配置文件

## 实现计划

### 阶段一：基础框架

- CLI 入口和基础结构
- 日志和工具函数
- create 和 init 命令

### 阶段二：开发工具

- dev 命令（热重载）
- build 和 start 命令

### 阶段三：运行与完善

- run 命令
- lint 命令
- 文档和测试
