# 安装

AgentForge 可以通过多种方式安装和使用。

## 环境要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0（推荐）

## 安装方式

### 1. 全局安装 CLI

```bash
pnpm add -g agentforge
```

安装后可以使用 `agentforge` 命令：

```bash
agentforge create my-app
agentforge dev
```

### 2. 作为项目依赖安装

```bash
pnpm add agentforge
```

### 3. 使用 CLI 创建新项目

```bash
npm create agentforge@latest my-agent-app
cd my-agent-app
npm install
```

## 验证安装

```bash
# 检查 CLI 版本
agentforge --version

# 查看帮助
agentforge --help
```

## 开发依赖

如果你要参与 AgentForge 的开发，需要克隆仓库并安装开发依赖：

```bash
git clone https://github.com/your-org/agentforge.git
cd agentforge
pnpm install
```

## TypeScript 配置

确保你的 `tsconfig.json` 包含以下配置：

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2020",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## 下一步

安装完成后，查看[快速开始](./getting-started.md)创建你的第一个 Agent。
