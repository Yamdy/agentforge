# Code Reviewer Example

基于 AgentForge 框架的 AI 代码审查助手示例。

## 功能

- 📊 **项目结构分析** - 文件组织、目录深度、模块分布
- 📈 **代码质量检测** - any 类型、空 catch、长函数、深嵌套
- 🔒 **安全漏洞扫描** - 硬编码密钥、eval()、SQL 注入、SSL 禁用

## 使用方法

### 环境配置

```powershell
# PowerShell 设置环境变量
$env:DOUBAO_API_KEY="your-api-key"
$env:DOUBAO_BASE_URL="your-api-base-url"  # 可选
$env:MODEL="glm-5"                        # 可选，默认 gpt-4o
```

### 运行

```powershell
# 审查模式 - 生成完整报告
pnpm tsx examples/code-reviewer/run.ts ./src

# 聊天模式 - 自由提问（指定项目目录）
pnpm tsx examples/code-reviewer/run.ts chat ./src

# 查看帮助
pnpm tsx examples/code-reviewer/run.ts --help
```

### 示例

```powershell
# 审查 src 目录
pnpm tsx examples/code-reviewer/run.ts ./src

# 审查其他项目
pnpm tsx examples/code-reviewer/run.ts ../my-project

# 聊天模式，自由问答
pnpm tsx examples/code-reviewer/run.ts chat ./src
# 进入后可问：
# - 这个项目的入口文件在哪？
# - 搜索所有使用了 Observable 的文件
# - 解释 Agent 类的工作原理
```

## 目录结构

```
examples/code-reviewer/
├── README.md              # 本文档
├── code-reviewer.config.md # Agent 配置（Markdown 格式）
├── index.ts                # 主入口：createCodeReviewer(), reviewProject()
├── run.ts                  # CLI 入口：review/chat 双模式
├── chat.ts                  # 聊天模式实现
├── workflow.ts              # Agent 驱动的审查流程
└── tools/
    ├── analyze-structure.ts # 项目结构分析
    ├── analyze-quality.ts   # 代码质量检测
    ├── analyze-security.ts  # 安全漏洞扫描
    └── index.ts             # 工具导出
```

## 自定义工具

每个分析工具都是标准的 AgentForge Tool：

```typescript
import type { Tool } from '../../src/types.js';

export const MyTool: Tool = {
  name: 'my_tool',
  description: '工具描述',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '参数描述' },
    },
    required: ['path'],
  },
  execute: async (args) => {
    // 实现逻辑
    return '结果';
  },
};
```

## 框架能力展示

| 能力 | 示例中的体现 |
|------|-------------|
| 自定义 Tool | 3 个专业分析工具 |
| Tool Schema | Zod 验证的参数定义 |
| Agent 构造 | 手动构造（Adapter + History + Registry） |
| Tool 注册 | registry.register() |
| Tool ↔ Adapter 桥接 | adapter.setTools(registry.list()) |
| 流式输出 | RxJS Observable + runStream |
| 内置工具复用 | read, ls, grep, find, glob |
| CLI 交互 | 命令行参数 + readline |
| Config 驱动 | Markdown 配置文件 |
