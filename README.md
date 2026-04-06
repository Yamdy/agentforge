# Primo Agent

一个轻量级、高性能的智能代理框架，基于TypeScript和RxJS构建。

## 核心特性

### 1. 流式处理与响应式设计

使用RxJS实现响应式流处理，支持：

- 实时事件流
- 丰富的操作符（过滤、缓冲、重试等）
- 多播和错误处理
- 暂停/恢复/取消控制

### 2. 模块化架构

- **LLM适配器**：统一接口支持多种LLM提供商
- **工具注册中心**：工具发现和执行机制
- **中间件管道**：可扩展的中间件架构
- **插件系统**：灵活的功能扩展方式

### 3. 智能控制流

- **任务状态机**：管理执行流程（pending→running→paused→completed→cancelled→error）
- **HITL机制**：Human-in-the-loop支持，可配置工具执行前的人工审批
- **中断处理**：优雅的取消和暂停机制
- **重试逻辑**：内置错误重试处理

### 4. 安全与权限

- **权限系统**：基于角色和资源的访问控制
- **默认角色**：admin（所有权限）和user（受限权限）
- **权限检查**：工具执行前的权限验证

### 5. 内置工具

集成常用操作工具：

- `read`：读取文件或目录
- `write`：写入文件
- `ls`：列出目录内容
- `bash`：执行Shell命令

## 快速开始

### 安装

```bash
npm install primo-agent
```

### 基本使用

```typescript
import { Agent } from 'primo-agent';
import { AIAdapter } from 'primo-agent/adapters/ai';
import { InMemoryHistory } from 'primo-agent/history';
import { ToolRegistry } from 'primo-agent/registry';
import { ReadTool, WriteTool, LsTool, BashTool } from 'primo-agent/tools/builtin';

// 创建LLM适配器
const adapter = new AIAdapter({
  apiKey: 'your-api-key',
  model: 'gpt-3.5-turbo',
  baseURL: 'https://api.openai.com/v1',
});

// 创建历史管理器
const history = new InMemoryHistory();

// 创建工具注册中心
const registry = new ToolRegistry();
registry.register([ReadTool, WriteTool, LsTool, BashTool]);

// 创建代理
const agent = new Agent(adapter, history, registry, {
  maxSteps: 10,
});

// 运行任务
agent.run('列出当前目录的内容').then((response) => {
  console.log('响应:', response);
});

// 或者使用流式API
agent.runStream('列出当前目录的内容').subscribe((event) => {
  switch (event.type) {
    case 'text':
      console.log('文本:', event.content);
      break;
    case 'tool_call_start':
      console.log('工具调用:', event.name);
      break;
    case 'tool_call_end':
      console.log('工具结果:', event.result);
      break;
  }
});
```

### 使用中间件

```typescript
import { createTodoMiddleware, createHitlMiddleware } from 'primo-agent/middleware';

// 创建待办事项中间件
const todoMiddleware = createTodoMiddleware();

// 创建HITL中间件，需要人工批准'delete'和'write'工具
const hitlMiddleware = createHitlMiddleware({
  tools: ['delete', 'write'],
  prompt: 'Do you want to approve this operation?',
});

// 使用中间件创建代理
const agent = new Agent(adapter, history, registry, {
  middleware: [todoMiddleware, hitlMiddleware],
});
```

### 权限管理

```typescript
import { getPermissionSystem } from 'primo-agent/permissions';

const permissionSystem = getPermissionSystem();

// 创建新角色
permissionSystem.createRole('developer', [
  { type: 'read', resource: '/*', allowed: true },
  { type: 'write', resource: '/src/*', allowed: true },
  { type: 'execute', resource: '/tools/*', allowed: true },
  { type: 'delete', resource: '/tmp/*', allowed: true },
]);

// 创建用户
permissionSystem.addUser({
  id: 'user1',
  name: 'John Doe',
  email: 'john@example.com',
  roles: ['user', 'developer'],
});

// 检查权限
const hasPermission = await permissionSystem.checkPermission('user1', {
  type: 'write',
  resource: '/src/app.ts',
  allowed: true,
});

console.log('是否有权限:', hasPermission); // true
```

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                     Primo Agent                         │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  LLM Adapter│  │  History    │  │ Tool Registry│    │
│  └──┬──────────┘  └──┬──────────┘  └──┬──────────┘    │
│     │               │              │                   │
│  ┌──▼───────────────▼───────────────▼──┐              │
│  │     Agent Core (State Machine)      │              │
│  └──┬──────────────────────────────────┘              │
│     │                                                 │
│  ┌──▼──────────────────────────────────┐              │
│  │       Middleware Pipeline           │              │
│  │  ┌─────────────┐ ┌─────────────┐   │              │
│  │  │  Todo Mw    │ │ HITL Mw     │   │              │
│  │  └─────────────┘ └─────────────┘   │              │
│  └──┬──────────────────────────────────┘              │
│     │                                                 │
│  ┌──▼──────────────────────────────────┐              │
│  │           RxJS Event Stream         │              │
│  └──┬──────────────────────────────────┘              │
│     │                                                 │
│  ┌──▼──────────────────────────────────┐              │
│  │    Tool Execution & Response        │              │
│  └─────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

## 开发与调试

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
npm run test
npm run test:watch  # 监听模式
```

### 代码检查

```bash
npm run lint
npm run lint:fix
```

### 构建

```bash
npm run build
```

## 示例

### 简单的文件操作

```typescript
import { Agent } from 'primo-agent';
import { AIAdapter } from 'primo-agent/adapters/ai';
import { InMemoryHistory } from 'primo-agent/history';
import { ToolRegistry } from 'primo-agent/registry';
import { ReadTool, WriteTool, LsTool } from 'primo-agent/tools/builtin';

const adapter = new AIAdapter({
  apiKey: 'your-key',
  model: 'gpt-3.5-turbo',
  baseURL: 'https://api.openai.com/v1',
});

const history = new InMemoryHistory();
const registry = new ToolRegistry();
registry.register([ReadTool, WriteTool, LsTool]);

const agent = new Agent(adapter, history, registry);

agent.run('列出当前目录的内容，然后创建一个名为"test.txt"的文件，内容为"Hello World"').subscribe({
  next: (event) => {
    if (event.type === 'text') {
      console.log(event.content);
    } else if (event.type === 'tool_call_start') {
      console.log(`开始执行工具: ${event.name}`);
    } else if (event.type === 'tool_call_end') {
      console.log(`工具结果: ${event.result}`);
    }
  },
  complete: () => console.log('任务完成'),
  error: (err) => console.error('错误:', err),
});
```

### 使用HITL进行敏感操作

```typescript
import { createHitlMiddleware } from 'primo-agent/middleware';

const hitlMiddleware = createHitlMiddleware({
  tools: ['delete', 'write'],
  prompt: '请批准以下操作:',
});

const agent = new Agent(adapter, history, registry, {
  middleware: [hitlMiddleware],
});

agent.run('删除当前目录下所有的临时文件').subscribe({
  next: (event) => {
    // 会在执行delete工具前暂停，等待用户输入批准
  },
});
```

## 贡献指南

### 开发流程

1. 克隆仓库
2. 安装依赖
3. 运行测试
4. 开发功能
5. 提交PR

### 代码风格

- 使用TypeScript
- 避免使用any类型
- 使用RxJS响应式编程
- 保持代码简洁和模块化

### 添加新工具

```typescript
import { Tool } from 'primo-agent/types';

export const MyTool: Tool = {
  name: 'my-tool',
  description: '我的自定义工具',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '参数1' },
      param2: { type: 'number', description: '参数2' },
    },
    required: ['param1'],
  },
  async execute(args) {
    return `执行结果: ${args.param1} - ${args.param2}`;
  },
};

// 在工具注册中心注册
registry.register([MyTool]);
```

## 许可证

MIT License
