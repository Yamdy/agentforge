# AgentForge 文档

这是 AgentForge 的官方文档，使用 VitePress 构建。

## 快速开始

### 安装依赖

```bash
cd docs
pnpm install
```

### 开发模式

```bash
pnpm dev
```

文档将在 http://localhost:5173 启动。

### 构建文档

```bash
pnpm build
```

构建后的文件在 `docs/.vitepress/dist` 目录。

### 预览构建

```bash
pnpm preview
```

## 文档结构

```
docs/
├── .vitepress/
│   └── config.ts          # VitePress 配置
├── guide/                 # 指南文档
│   ├── getting-started.md
│   ├── installation.md
│   ├── project-structure.md
│   ├── configuration.md
│   ├── agent.md
│   ├── tools.md
│   ├── middleware.md
│   ├── permissions.md
│   ├── streaming.md
│   ├── custom-tools.md
│   ├── custom-adapters.md
│   ├── plugins.md
│   ├── testing.md
│   ├── deployment.md
│   └── best-practices.md
├── api/                   # API 文档
│   ├── core.md
│   ├── config.md
│   ├── tools.md
│   └── storage.md
├── examples/              # 示例文档
│   ├── basic.md
│   ├── streaming.md
│   └── tools.md
├── index.md               # 首页
└── package.json
```

## 添加新文档

### 添加指南文档

1. 在 `docs/guide/` 目录创建新的 Markdown 文件
2. 在 `docs/.vitepress/config.ts` 的 `sidebar` 中添加链接

### 添加 API 文档

1. 在 `docs/api/` 目录创建新的 Markdown 文件
2. 在 `docs/.vitepress/config.ts` 的 `sidebar` 中添加链接

### 添加示例文档

1. 在 `docs/examples/` 目录创建新的 Markdown 文件
2. 在 `docs/.vitepress/config.ts` 的 `sidebar` 中添加链接

## 文档规范

### Markdown 格式

- 使用标准 Markdown 语法
- 代码块指定语言：\`\`\`typescript
- 使用相对路径引用其他文档

### 代码示例

所有代码示例应该是：

- 可运行的
- 有清晰的注释
- 包含必要的导入语句

### 文档结构

每个文档应该包含：

1. 简短的介绍
2. 基本用法
3. 完整示例
4. 相关文档链接

## 部署

### GitHub Pages

1. 构建文档：`pnpm build`
2. 将 `docs/.vitepress/dist` 目录推送到 `gh-pages` 分支

### Vercel

1. 连接 GitHub 仓库
2. 设置构建命令为 `cd docs && pnpm build`
3. 设置输出目录为 `docs/.vitepress/dist`

## 贡献

欢迎贡献文档！请遵循以下步骤：

1. Fork 仓库
2. 创建特性分支
3. 添加或修改文档
4. 提交 Pull Request

## 相关链接

- [AgentForge GitHub](https://github.com/your-org/agentforge)
- [VitePress 文档](https://vitepress.dev/)
