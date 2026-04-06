# SKILL 功能设计文档

**日期**: 2026-04-06
**版本**: 1.0.0
**作者**: Primo Agent Team

## 概述

为 Primo Agent 框架添加 SKILL 功能支持，参考 opencode、AgentScope 和 Mastra 三个项目的设计。

## 参考项目

- **opencode (D:\code\opencode)**: SKILL 核心实现、工具集成
- **AgentScope (D:\code\agentscope)**: Toolkit 中的 Skill 支持
- **Mastra (D:\code\mastra)**: 完整的 SKILL 实现，包括搜索、版本管理

## 什么是 SKILL

SKILL 是一种由 Anthropic 提出的标准，用于为 AI 智能体提供可复用的领域特定知识和工作流。

**与工具/函数的区别**：

| 特性         | SKILL                      | 工具/函数    |
| ------------ | -------------------------- | ------------ |
| **本质**     | 指令、知识、工作流         | 可执行代码   |
| **调用方式** | 通过 `load_skill` 工具加载 | 直接调用     |
| **执行**     | 不执行，提供指导           | 执行具体操作 |
| **上下文**   | 按需加载，注入对话         | 持续可用     |

## 架构设计

### 目录结构

```
src/skill/
├── index.ts              # 主入口
├── discovery.ts          # SKILL 发现和加载
├── types.ts              # 类型定义
└── tool.ts               # Skill 工具实现
```

### SKILL 发现位置

从以下位置扫描 SKILL：

1. `./.primo-agent/skills/`
2. `./.agents/skills/`
3. `./.claude/skills/`
4. `./.opencode/skills/`

### SKILL 文件结构

```
<skill-name>/
└── SKILL.md
```

## SKILL.md 格式

### YAML Frontmatter

```markdown
---
name: git-release
description: Create consistent releases and changelogs
license: MIT
compatibility: primo-agent
metadata:
  audience: maintainers
  workflow: github
---
```

### 必需字段

- `name`: SKILL 名称
- `description`: 简短描述

### 可选字段

- `license`: 许可证
- `compatibility`: 兼容性
- `metadata`: 自定义元数据

### 内容部分

Markdown 格式的详细说明，包括：

- What I do - SKILL 的功能
- How to use - 使用方法
- Examples - 示例

## 核心类型定义

```typescript
import { z } from 'zod';

export const SkillInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
  frontmatter: z.record(z.any()).optional(),
});
export type SkillInfo = z.infer<typeof SkillInfoSchema>;

export const SkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
```

## 核心 API

### 发现和加载

```typescript
// 发现所有 SKILL
await Skill.discover();

// 列出所有可用 SKILL
const skills = Skill.list();

// 获取单个 SKILL
const skill = Skill.get('git-release');

// 刷新 SKILL 列表
await Skill.refresh();
```

### Skill 工具

自动注册的 `load_skill` 工具：

```typescript
{
  name: 'load_skill',
  description: 'Load a SKILL by name to get specialized instructions',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the SKILL to load',
      },
    },
    required: ['name'],
  },
  execute: async (args) => {
    const skill = Skill.get(args.name);
    if (!skill) {
      return `SKILL not found: ${args.name}`;
    }
    return skill.content;
  },
}
```

## 与 Agent 集成

### 自动集成

1. Agent 初始化时自动注册 `load_skill` 工具
2. Agent 调用 `load_skill` 时，SKILL 内容注入对话
3. SKILL 内容作为系统消息提供

### 使用示例

```typescript
const agent = new Agent({
  llm,
  tools: [
    /* ... */
  ],
});

// Agent 可以自动使用 load_skill
const response = await agent.run('Help me create a release. Use the git-release skill.');
```

## 实现计划

### Phase 1: 核心基础设施

- [ ] 创建类型定义 (types.ts)
- [ ] 创建 SKILL 发现和加载 (discovery.ts)
- [ ] 创建主入口 (index.ts)

### Phase 2: 工具集成

- [ ] 创建 Skill 工具 (tool.ts)
- [ ] 集成到 Agent 系统

### Phase 3: 测试和文档

- [ ] 单元测试
- [ ] 示例 SKILL
- [ ] 文档

## 风险和注意事项

1. **性能**: SKILL 发现可能需要扫描多个目录
2. **安全性**: 只加载可信位置的 SKILL
3. **兼容性**: 遵循 Anthropic SKILL 标准
