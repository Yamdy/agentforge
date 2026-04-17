# AgentForge

A modern, enterprise-grade Agent development framework for TypeScript. Build production-ready AI agents with minimal boilerplate.

## 核心特性

### 1. 📋 **Type-Safe Configuration System**

- Zod-based schema validation
- Multi-file format support (Markdown with frontmatter, JSON)
- Automatic config discovery
- Config merging and environment support

### 2. 🏭 **Agent Factory Pattern**

- One-shot agent creation from configuration
- Automatic dependency injection
- Built-in tool auto-registration
- Easy customization with pre-configured components

### 3. 📡 **Reactive Streaming with RxJS**

- Real-time event streaming
- Rich operators (filter, buffer, retry)
- Pause/resume/cancel control
- Sophisticated error handling

### 4. 🔌 **Modular Architecture**

- **LLM Adapters**: Unified interface for multiple providers
- **Tool Registry**: Dynamic tool discovery and execution
- **Middleware Pipeline**: Extensible middleware architecture
- **Plugin System**: Flexible feature extension
- **Memory Management**: Conversation history persistence

### 5. 🎮 **Intelligent Control Flow**

- **Task State Machine**: Complete lifecycle management (pending → running → paused → completed → cancelled → error)
- **Human-in-the-loop**: Configurable approval before tool execution
- **Graceful Interruption**: Cancellation and pause support
- **Retry Logic**: Built-in error retry handling

### 6. 🔐 **Security & Permissions**

- Role-based access control
- Resource-based permission checks
- Default admin/user roles

### 7. 🔧 **Built-in Tools**

- `read`: Read files and directories
- `write`: Write files
- `ls`: List directory contents
- `bash`: Execute shell commands

## 快速开始

### 使用 CLI 创建新项目

```bash
# Create a new project with interactive scaffolding
npm create agentforge@latest my-agent-app
cd my-agent-app
npm install
npm run dev
```

### 安装到现有项目

```bash
pnpm add agentforge
```

### Create Configuration

Create `agentforge.config.md` in your project:

```markdown
---
name: my-assistant
agent:
  name: My Assistant
  model: gpt-4o
  maxSteps: 15
---

You are a helpful AI assistant.
```

### One-Line Agent Creation

```typescript
import { loadConfig } from 'agentforge/config';
import { createAgent } from 'agentforge/agent';

// Load and validate configuration automatically
const config = await loadConfig();

// Create agent with all dependencies wired up
const agent = createAgent(config);

// Run the agent
const result = await agent.run('Hello, how are you?');
console.log(result);
```

### Streaming Response

```typescript
import { loadConfigSync, createAgent } from 'agentforge';

const config = loadConfigSync();
const agent = createAgent(config);

agent.runStream('Tell me a story').subscribe((event) => {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'tool_call_start':
      console.log(`\n[Calling tool: ${event.name}]`);
      break;
  }
});
```

### Manual Creation (Advanced)

```typescript
import { Agent } from 'agentforge';
import { AIAdapter } from 'agentforge/adapters/ai';
import { InMemoryHistory } from 'agentforge/memory';
import { ToolRegistry } from 'agentforge/registry';
import { allBuiltinTools } from 'agentforge/tools';

const adapter = new AIAdapter({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
});

const history = new InMemoryHistory();
const registry = new ToolRegistry();
registry.register(allBuiltinTools);

const agent = new Agent(adapter, history, registry, {
  name: 'My Agent',
  maxSteps: 10,
});
```

### 使用中间件

```typescript
import { createTodoMiddleware, createHitlMiddleware } from 'agentforge/middleware';

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
import { getPermissionSystem } from 'agentforge/permissions';

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
│                     AgentForge                         │
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
pnpm install
```

### 运行测试

```bash
pnpm test          # Watch mode
pnpm test:run      # Single run
pnpm test:coverage # Coverage report
```

### 代码检查

```bash
pnpm lint
pnpm lint:fix
```

### 构建

```bash
pnpm build
```

## 文档

- [Architecture Overview](./docs/architecture/overview.md) - Overall architecture
- [Configuration Guide](./docs/guides/configuration.md) - Complete configuration documentation
- [Examples](./examples/) - Working examples

### CLI Commands

AgentForge comes with a full-featured CLI:

| Command             | Description                                     |
| ------------------- | ----------------------------------------------- |
| `agentforge create` | Create new project with interactive scaffolding |
| `agentforge init`   | Initialize AgentForge in existing project       |
| `agentforge dev`    | Start development server                        |
| `agentforge build`  | Build for production                            |
| `agentforge start`  | Start production server                         |
| `agentforge run`    | Run an agent directly                           |
| `agentforge lint`   | Lint your configuration                         |
| `agentforge studio` | Start development studio                        |

### Examples

AgentForge has many categorized working examples:

```
examples/
├── agents/             # Different agent types examples
│   └── inferhub-plugin.ts
├── basic/              # Basic getting started examples
│   └── agent-factory.ts
├── config/             # Configuration system examples
│   ├── config-basic.ts
│   └── custom-config-path.ts
├── mcp/               # Model Context Protocol examples
│   └── mcp-demo.ts
├── workflows/          # Workflow composition examples
│   └── workflow-demo.ts
├── demo.ts             # Full featured demo
└── web-ui.html        # Web UI example
```

View all examples [here](./examples/).

## 示例：配置驱动开发

### 1. Define your configuration in Markdown

```markdown
---
name: code-assistant
version: 1.0.0
agent:
  name: Code Assistant
  model: gpt-4o
  maxSteps: 20
  temperature: 0.3
  tools:
    - read
    - write
    - ls
    - bash
model:
  apiKey: ${OPENAI_API_KEY}
server:
  port: 3000
logging:
  level: debug
---

You are an expert code assistant. Help users develop and refactor their code.
Always follow best practices and explain your changes clearly.
```

### 2. Load and run

```typescript
import { loadConfig } from 'agentforge/config';
import { createAgent } from 'agentforge/agent';
import { startServer } from 'agentforge/server';

async function main() {
  const config = await loadConfig();
  const agent = createAgent(config);

  // Start HTTP API server
  if (config.server) {
    startServer(agent, config.server);
    console.log(`Server running on port ${config.server.port}`);
  }

  const result = await agent.run('Help me refactor this project');
  console.log(result);
}

main();
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
import { Tool } from 'agentforge/types';

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

## 对比其他框架

| 特性                         | agentforge       | agentscope | deepagents | mastra     |
| ---------------------------- | ---------------- | ---------- | ---------- | ---------- |
| **Language**                 | TypeScript       | Python     | Python     | TypeScript |
| **Multiple Agents**          | ✅               | ✅         | ✅         | ✅         |
| **Reactive Streaming**       | ✅ (RxJS native) | ⚙️         | ⚙️         | ⚡         |
| **Configuration Driven**     | ✅               | ⚙️         | ✅         | ✅         |
| **Middleware Pipeline**      | ✅               | ⚙️ (hooks) | ❌         | ✅         |
| **PII & Injection Security** | ✅               | ❌         | ❌         | ⚙️         |
| **Size**                     | Lightweight      | Full       | Full       | Full       |
| **MCP Support**              | ✅               | ✅         | ✅         | ✅         |

**agentforge** is a lightweight, clean alternative for TypeScript developers who want a simple but powerful framework for building AI agents without the heavyweight.

## 许可证

MIT License
