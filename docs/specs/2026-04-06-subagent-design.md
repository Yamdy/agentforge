# 子代理系统设计文档

**日期**: 2026-04-06
**版本**: 1.0.0
**作者**: Primo Agent Team

## 概述

为 Primo Agent 框架添加子代理系统和任务委派机制，参考 opencode、AgentScope 和 Mastra 三个项目的设计。

## 参考项目

- **opencode (D:\code\opencode)**: 主从模式、权限隔离、`@general` 语法
- **AgentScope (D:\code\agentscope)**: MsgHub、管道编排、观察者模式
- **Mastra (D:\code\mastra)**: 智能路由、委派生命周期、消息过滤

## 架构设计

### 目录结构

```
src/subagent/
├── index.ts              # 主入口
├── types.ts              # 类型定义
├── registry.ts           # 子代理注册中心
├── delegation.ts         # 任务委派机制
└── tool.ts               # 子代理工具
```

### 核心概念

#### 子代理模式

- **primary**: 主代理，拥有完整权限
- **subagent**: 子代理，专用功能，权限受限

#### 委派生命周期

1. **onDelegationStart**: 委派开始前，可修改或拒绝
2. **执行**: 子代理执行任务
3. **onDelegationComplete**: 委派完成后

## 核心类型定义

```typescript
import { z } from 'zod';
import type { Agent } from '../agent/index.js';
import type { Tool, Message } from '../types.js';

export const SubAgentModeSchema = z.enum(['primary', 'subagent']);
export type SubAgentMode = z.infer<typeof SubAgentModeSchema>;

export const SubAgentConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  mode: SubAgentModeSchema,
  tools: z.array(z.any()).optional(),
});
export type SubAgentConfig = z.infer<typeof SubAgentConfigSchema>;

export interface DelegationStartContext {
  subAgentName: string;
  prompt: string;
  parentMessages: Message[];
  iteration: number;
}

export interface DelegationStartResult {
  proceed?: boolean;
  rejectionReason?: string;
  modifiedPrompt?: string;
}

export interface DelegationCompleteContext {
  subAgentName: string;
  result: string;
  success: boolean;
  error?: Error;
  duration: number;
}

export interface MessageFilterContext {
  messages: Message[];
  subAgentName: string;
  prompt: string;
}

export interface DelegationConfig {
  onDelegationStart?: (
    ctx: DelegationStartContext
  ) => DelegationStartResult | Promise<DelegationStartResult>;
  onDelegationComplete?: (ctx: DelegationCompleteContext) => void | Promise<void>;
  messageFilter?: (ctx: MessageFilterContext) => Message[] | Promise<Message[]>;
}

export const schemas = {
  SubAgentMode: SubAgentModeSchema,
  SubAgentConfig: SubAgentConfigSchema,
} as const;
```

## 核心 API

### 子代理注册

```typescript
// 注册子代理
SubAgent.register({
  name: 'explorer',
  description: 'Explore the codebase quickly',
  mode: 'subagent',
  agent: explorerAgent,
  tools: [readTool, lsTool],
});

// 列出所有子代理
const agents = SubAgent.list();

// 获取单个子代理
const agent = SubAgent.get('explorer');
```

### 任务委派

```typescript
// 委派任务给子代理
const result = await SubAgent.delegate(
  'explorer',
  'Explore the codebase and find the main entry point',
  {
    onDelegationStart: (ctx) => {
      console.log(`Delegating to ${ctx.subAgentName}`);
      return { proceed: true };
    },
    onDelegationComplete: (ctx) => {
      console.log(`Delegation complete: ${ctx.success}`);
    },
    messageFilter: (ctx) => {
      // 只传递最近 5 条消息
      return ctx.messages.slice(-5);
    },
  }
);
```

### 子代理工具

自动注册的 `delegate_to_subagent` 工具：

```typescript
{
  name: 'delegate_to_subagent',
  description: 'Delegate a task to a specialized sub-agent',
  parameters: {
    type: 'object',
    properties: {
      subagent: {
        type: 'string',
        description: 'Name of the sub-agent to delegate to',
      },
      task: {
        type: 'string',
        description: 'Task description for the sub-agent',
      },
    },
    required: ['subagent', 'task'],
  },
  execute: async (args) => {
    return SubAgent.delegate(args.subagent, args.task);
  },
}
```

## 内置子代理

| 名称         | 模式     | 描述           |
| ------------ | -------- | -------------- |
| `explorer`   | subagent | 快速探索代码库 |
| `planner`    | subagent | 制定计划和方案 |
| `researcher` | subagent | 研究和收集信息 |

## 实现计划

### Phase 1: 核心基础设施

- [ ] 创建类型定义 (types.ts)
- [ ] 创建子代理注册中心 (registry.ts)
- [ ] 创建主入口 (index.ts)

### Phase 2: 任务委派

- [ ] 创建委派机制 (delegation.ts)
- [ ] 实现委派生命周期钩子
- [ ] 实现消息过滤

### Phase 3: 工具集成

- [ ] 创建子代理工具 (tool.ts)
- [ ] 集成到 Agent 系统

### Phase 4: 测试和文档

- [ ] 单元测试
- [ ] 示例
- [ ] 文档

## 风险和注意事项

1. **会话隔离**: 子代理应该有独立的会话上下文
2. **权限控制**: 子代理应该有最小权限原则
3. **错误处理**: 完善的委派失败处理
4. **性能**: 避免过度委派导致的性能问题
