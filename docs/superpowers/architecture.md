# AgentForge 框架架构文档

## 概述

AgentForge 是一个通用的 Agent 开发框架，支持工具调用、多轮对话、C/S 架构。用户通过组合核心组件（Tool、LLMAdapter、HistoryManager）来构建自己的 Agent。

## 系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Clients                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │   Web    │  │ Desktop  │  │   CLI    │  │   API    │             │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘             │
└───────┼─────────────┼─────────────┼─────────────┼────────────────────┘
        │            │             │            │
        └────────────┴─────────────┴────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Agent Server (Hono)                                │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                   REST API / SSE                                  │  │
│  │  POST /api/agent/run    GET /api/agent/status                 │  │
│  │  POST /api/agent/run/stream    GET /health    GET /openapi.json│  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                           │                                            │
│  ┌─────────────────────────▼───────────────────────────────────────┐  │
│  │                     Agent Engine                                 │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│  │  │  Agent  │  │  Hooks   │  │  Logger  │  │  Tracer  │   │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Client-Server 交互

```
Client (SDK)                        Server (Agent)
     │                                     │
     │──── POST /api/agent/run ──────────►│
     │                                     │
     │◄─────── { result: "..." } ────────│
     │                                     │
     │  或 Stream 模式:                    │
     │──── POST /api/agent/run/stream ──►│
     │                                     │
     │◄──── data: {"type":"text",...} ────│
     │◄──── data: {"type":"tool_call_...} │
     │◄──── data: {"type":"done"} ────────│
```

## 核心组件

### 1. Agent (src/agent.ts)

Agent 是框架的核心，协调 LLM、History 和 Registry。

```typescript
new Agent(adapter, history, registry, { maxSteps: Infinity });
```

核心逻辑：

- `run()`: 简化接口，返回完整字符串
- `runStream()`: 流式接口，yield `StreamEvent`
- `getState()`: 获取当前任务状态
- `cancel()`: 取消正在执行的任务

### 2. LLMAdapter (src/adapters/ai.ts)

基于 `@ai-sdk/openai-compatible` 的统一适配器，支持所有 OpenAI 兼容 API。

```typescript
const adapter = new AIAdapter({
  model: 'gpt-4-turbo',
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1',
  useTools: true,
});
adapter.setTools(registry.list());
```

### 3. HistoryManager (src/history.ts)

内存消息历史管理，支持工具结果反馈。

```typescript
const history = new InMemoryHistory();
history.add('user', 'Calculate 2+2');
history.addToolResult('call_123', 'calculator', '4');
history.getMessages(); // 包含用户消息 + 工具结果
```

### 4. ToolRegistry (src/registry.ts)

工具注册与管理，带 Zod 验证。

```typescript
const registry = new ToolRegistry();
registry.register(calculatorTool);
registry.get('calculator');
await registry.execute('calculator', { expr: '2+2' });
```

### 5. Types (src/types.ts)

Zod schemas + 类型定义 + 验证函数。

| Schema              | 用途                                                 |
| ------------------- | ---------------------------------------------------- |
| `MessageSchema`     | 消息 `{ role, content }`                             |
| `ToolSchema`        | 工具 `{ name, description, parameters, execute }`    |
| `LLMResponseSchema` | LLM 响应 `{ content, toolCalls, finishReason }`      |
| `StreamEventSchema` | 流事件 discriminated union                           |
| `TaskStatusSchema`  | 任务状态 `pending/running/completed/cancelled/error` |

### 6. TaskStateMachine (src/agent.ts 内置)

任务状态机，管理 Agent 生命周期。

```typescript
agent.getState(); // { status: 'running', step: 1, maxSteps: 10 }
agent.cancel(); // 取消任务
```

**状态转换：**

```
┌─────────┐     ┌──────────┐     ┌───────────┐
│ pending │ ──► │ running │ ──► │ completed │
└─────────┘     └──────────┘     └───────────┘
                      │
            ┌───────┴───────┐
            ▼               ▼
        error          cancelled
```

### TaskState

| 字段     | 类型       | 说明                                      |
| -------- | ---------- | ----------------------------------------- |
| status   | TaskStatus | pending/running/completed/cancelled/error |
| step     | number     | 当前迭代次数                              |
| maxSteps | number     | 最大迭代次数                              |
| error?   | string     | 错误信息（仅 error 状态）                 |

### 7. Logger (src/logger/index.ts)

全局日志服务，基于 RxJS Subject 实现可观测日志流。

```typescript
import { createLogger, logger } from 'agentforge';

// 全局单例，所有模块共享
const log = createLogger('moduleName');
log.info('Message', { meta: 'data' });

// 订阅日志流
logger.observable().subscribe((entry) => console.log(entry.message));
```

**特性：**

- 全局单例，日志统一管理
- RxJS 可观测，支持过滤、转换
- 多级别：debug/info/warn/error
- 服务化标签：`child('subModule')`

### 8. Tracer (src/tracer.ts)

链路追踪服务，基于 Span 实现分布式追踪能力。

```typescript
import { tracer, getTracer } from 'agentforge';

const span = tracer.startSpan('operation.name');
tracer.log(span.spanId, 'Processing...');
tracer.setTag(span.spanId, 'key', 'value');
tracer.endSpan(span.spanId, 'completed');

// 订阅追踪流
tracer.observable().subscribe((span) => console.log(span.operationName, span.duration));
```

**特性：**

- Span 生命周期管理
- 父子Span 关联
- RxJS 可观测
- 与 Logger 集成

### 9. Server (src/server/index.ts)

HTTP 服务器，基于 Hono 框架。

```typescript
import { createApp, startServer } from 'agentforge';

const app = createApp({
  apiKey: 'optional-api-key',
  agent: myAgent,
});

// 或直接启动
await startServer({
  port: 3000,
  apiKey: 'xxx',
  agent: myAgent,
});
```

**API 端点：**

| 方法 | 路径                                  | 说明                   |
| ---- | ------------------------------------- | ---------------------- |
| GET  | `/health`                             | 健康检查               |
| GET  | `/openapi.json`                       | OpenAPI 规范           |
| POST | `/api/agent/run`                      | 同步执行               |
| POST | `/api/agent/run/stream`               | 流式执行 (SSE)         |
| GET  | `/api/agent/status`                   | Agent 状态             |
| POST | `/api/sessions`                       | 创建 Session           |
| GET  | `/api/sessions`                       | 列出 Sessions          |
| GET  | `/api/sessions/:id`                   | 获取 Session           |
| POST | `/api/sessions/:sessionID/run`        | 同步执行（带 Session） |
| POST | `/api/sessions/:sessionID/run/stream` | 流式执行（带 Session） |

### 10. SDK (src/sdk/client.ts)

客户端 SDK，用于连接 Agent Server。

```typescript
import { createPrimoClient } from 'agentforge';

const client = createPrimoClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'optional-key',
});

// 同步调用
const result = await client.run('Calculate 2+2');

// 流式调用
for await (const event of client.runStream('Hello')) {
  console.log(event);
}
```

### 7. PluginManager (src/plugin/index.ts)

插件管理器，提供事件驱动架构，基于 RxJS 实现。

```typescript
const pluginManager = new PluginManager();
pluginManager.register({
  name: 'my-plugin',
  hooks: {
    'tool.execute.before': async (input, output) => {
      console.log(`Calling ${input.tool}`);
    },
  },
});
agent.registerPlugin(myPlugin);

// RxJS 订阅
pluginManager.on('tool.execute.after', async (input, output) => {
  console.log('Tool executed:', input.result);
});
```

**RxJS 特性：**

- `on(event, handler)` - 订阅事件
- `observable(event)` - 获取 Observable
- `pipe(event, operators...)` - 使用 RxJS 操作符

### 8. Hooks 系统

预定义的钩子事件，插件可通过订阅这些事件来扩展功能。

| Hook                  | 输入                      | 输出           | 说明                     |
| --------------------- | ------------------------- | -------------- | ------------------------ |
| `agent.start`         | `{ userInput }`           | `{}`           | Agent 开始执行           |
| `agent.step`          | `{ step, maxSteps }`      | `{}`           | 步骤变化                 |
| `agent.complete`      | `{ userInput, response }` | `{}`           | Agent 完成               |
| `agent.error`         | `{ error }`               | `{}`           | Agent 错误               |
| `tool.execute.before` | `{ tool, args }`          | `{ args }`     | 工具执行前（可修改参数） |
| `tool.execute.after`  | `{ tool, args, result }`  | `{ result }`   | 工具执行后（可修改结果） |
| `state.change`        | `{ from, to }`            | `{}`           | 状态变化                 |
| `message.transform`   | `{}`                      | `{ messages }` | 消息转换                 |
| `system.prompt`       | `{}`                      | `{ prompt }`   | 系统提示词               |

### 11. Session 管理 (src/session/)

Session 支持多轮对话持久化，包含存储、CRUD API 和上下文压缩。

```typescript
import { createSessionAPI } from 'agentforge';

const sessionApi = createSessionAPI();
await sessionApi.init();

// 创建 Session
const session = await sessionApi.create({ title: 'Chat' });

// 添加消息
await sessionApi.addMessage(session.id, { role: 'user', content: 'Hello' });
await sessionApi.addMessage(session.id, { role: 'assistant', content: 'Hi!' });

// 获取历史
const history = await sessionApi.get(session.id);
console.log(history.messages); // [{ role: 'user', content: 'Hello' }, ...]
```

**上下文压缩**：

当消息数超过阈值时自动压缩，保留首尾消息并生成摘要。

```typescript
import { compactSession } from 'agentforge';

const result = await compactSession(session, {
  maxMessages: 50, // 压缩后保留的最大消息数
  keepFirst: 2, // 保留前几条
  keepLast: 10, // 保留后几条
});
console.log(result.summary); // 压缩摘要
```

**Server 配置**：

```typescript
await startServer({
  port: 3000,
  agent,
  compactionThreshold: 50, // 消息数阈值
  compactionEnabled: true, // 是否启用
});
```

### 12. 错误处理 (src/server/error.ts)

统一错误响应格式。

```typescript
import { AppError, NotFoundError, toErrorResponse } from 'agentforge';

// 抛出错误
throw new NotFoundError('Session not found');
throw new AppError('INVALID_INPUT', 'Input is required', 400);

// 统一响应格式
// { error: { code: 'NOT_FOUND', message: 'Session not found' } }
```

**错误类型**：

| Error               | Code             | Status | 说明       |
| ------------------- | ---------------- | ------ | ---------- |
| `NotFoundError`     | NOT_FOUND        | 404    | 资源未找到 |
| `BadRequestError`   | BAD_REQUEST      | 400    | 请求错误   |
| `UnauthorizedError` | UNAUTHORIZED     | 401    | 未授权     |
| `ValidationError`   | VALIDATION_ERROR | 400    | 验证失败   |

## 数据流

### Agent 执行循环

```
User Input
    │
    ▼
┌─────────────────────────────────────────┐
│  Agent.runStream()                       │
│  1. history.add('user', input)          │
│  2. Loop (maxSteps):                    │
│     a. messages = history.getMessages() │
│     b. for event of adapter.chatStream()│
│        - text → history.add() + yield   │
│        - tool_call_start → pending      │
│        - tool_call_delta → parse args   │
│        - tool_call_end → execute + yield │
│        - done → check finishReason       │
│           - 'tool-calls' → continue     │
│           - 'stop' → return              │
└─────────────────────────────────────────┘
          │
          ▼
   Server 自动保存到 Session
```

### Session 多轮对话流程

```
Client                              Server                         Session
  │                                    │                              │
  │──── POST /sessions/:id/run/stream │                              │
  │      { input: "继续" }             │                              │
  │                                    ├─ GET /sessions/:id          │
  │                                    │  ← messages: [history]      │
  │                                    │                              │
  │                                    ├─ Agent.run(input, messages)│
  │                                    │                              │
  │◄─── stream events ─────────────────│                              │
  │                                    ├─ addMessage(user, input)    │
  │                                    ├─ addMessage(assistant, resp)│
  │                                    │                              │
  │                                    ├─ 检查消息数 > 阈值          │
  │                                    ├─ compactSession()           │
  │                                    │                              │
  │                            如果超过压缩阈值                        │
  │                                    ├─ update(messages: compacted)│
  │                                    │                              │
```

### 流事件类型

| Event                                        | 说明                    |
| -------------------------------------------- | ----------------------- |
| `{ type: 'text', content }`                  | 文本块                  |
| `{ type: 'tool_call_start', id, name }`      | 工具调用开始            |
| `{ type: 'tool_call_delta', id, arguments }` | 工具参数增量            |
| `{ type: 'tool_call_end', id, result? }`     | 工具调用结束            |
| `{ type: 'done', response }`                 | 完成，携带 finishReason |

### StreamHandler

流式事件回调接口。

| 回调            | 参数                             | 说明         |
| --------------- | -------------------------------- | ------------ |
| onText          | (text: string)                   | 文本块输出   |
| onStep          | (step: number, maxSteps: number) | 迭代步骤变化 |
| onStateChange   | (state: TaskState)               | 任务状态变化 |
| onToolCallStart | (id: string, name: string)       | 工具调用开始 |
| onToolCallEnd   | (id: string, result?: string)    | 工具调用结束 |
| onError         | (error: Error)                   | 执行异常     |

## 文件结构

```
src/
├── index.ts                 # 统一导出
├── types.ts                # Zod schemas + 类型定义
├── agent/
│   ├── index.ts           # Agent 导出
│   └── agent.ts          # Agent 核心实现
├── server/
│   ├── index.ts          # Server + API 路由
│   ├── error.ts         # 统一错误处理
│   └── middleware/
│       ├── auth.ts       # API Key 认证
│       ├── error.ts     # 全局错误处理
│       ├── logging.ts   # 请求日志
│       └── rate-limit.ts # 速率限制
├── sdk/
│   └── client.ts         # 客户端 SDK
├── logger/
│   └── index.ts         # 全局日志服务
├── tracer.ts             # 链路追踪
├── registry.ts           # 工具注册 (含缓存)
├── history.ts           # 历史管理
├── adapters/
│   └── ai.ts           # @ai-sdk 适配器
├── plugin/
│   ├── index.ts        # PluginManager
│   ├── manager.ts      # RxJS 插件管理
│   ├── types.ts       # Hooks 类型
│   └── context.ts     # PluginContext
├── session/              # Session 管理
│   ├── index.ts        # SessionAPI 导出
│   ├── storage.ts      # 文件系统存储 (基于 Storage)
│   └── compaction.ts   # 上下文压缩
├── storage/              # 通用存储模块 (文件系统 JSON)
│   ├── index.ts        # Storage 命名空间
│   ├── lock.ts         # 读写锁
│   └── filesystem.ts   # 文件系统工具
├── config/                # 配置验证 (Zod)
│   ├── index.ts
│   └── schema.ts
├── errors/               # 错误类型
│   ├── index.ts
│   └── types.ts
├── retry/               # 重试机制
│   └── index.ts
├── cache/               # 工具缓存
│   └── index.ts
├── tools/
│   └── index.ts       # 内置工具
├── examples/
│   ├── demo.ts        # Demo 入口
│   └── web-ui.html   # Web UI 页面
└── cli.ts             # CLI 入口
```

## 使用方式

### 编程接口 (本地)

```typescript
import { Agent, InMemoryHistory, ToolRegistry, AIAdapter, calculatorTool } from 'agentforge';

const adapter = new AIAdapter({ model: 'gpt-4-turbo', apiKey: 'xxx' });
const registry = new ToolRegistry();
registry.register(calculatorTool);
adapter.setTools(registry.list());

const history = new InMemoryHistory();
const agent = new Agent(adapter, history, registry);

// 同步接口
const response = await agent.run('Calculate 123 * 456');

// 流式接口
for await (const event of agent.runStream('Calculate 123 * 456', {
  onText: (text) => process.stdout.write(text),
  onToolCallStart: (id, name) => console.log(`[Calling ${name}...]`),
  onToolCallEnd: (id, result) => console.log(` => ${result}`),
})) {
}
```

### Server 模式

```typescript
import { Agent, InMemoryHistory, ToolRegistry, AIAdapter, startServer } from 'agentforge';

const adapter = new AIAdapter({ model: 'gpt-4-turbo', apiKey: 'xxx' });
const registry = new ToolRegistry();
registry.register(calculatorTool);
adapter.setTools(registry.list());

const agent = new Agent(adapter, new InMemoryHistory(), registry);

await startServer({
  port: 3000,
  apiKey: 'my-api-key', // 可选
  agent,
  corsOrigins: ['http://localhost:8080'], // 可选
  compactionThreshold: 50, // 可选
  compactionEnabled: true, // 可选
});
```

### SDK 客户端

```typescript
import { createPrimoClient } from 'agentforge';

const client = createPrimoClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'my-api-key', // 可选
});

// 创建 Session
const session = await client.createSession({ title: 'Chat' });

// 带 Session 运行
for await (const event of client.runStream('继续刚才的话题', { sessionId: session.id })) {
  console.log(event);
}

// 获取历史
const history = await client.getSession(session.id);
console.log(history.messages);
```

// 同步调用
const result = await client.run('Calculate 2+2');

// 流式调用
for await (const event of client.runStream('Hello')) {
console.log(event);
}

// 获取 Agent 状态
const status = await client.getStatus();

````

### 插件使用

```typescript
const myPlugin = {
  name: 'debug-plugin',
  hooks: {
    'tool.execute.before': async (input, output) => {
      console.log(`[DEBUG] Calling tool: ${input.tool}`, input.args);
    },
    'tool.execute.after': async (input, output) => {
      console.log(`[DEBUG] Tool result:`, output.result);
    },
    'agent.step': async (input) => {
      console.log(`[DEBUG] Step ${input.step}/${input.maxSteps}`);
    }
  }
};

agent.registerPlugin(myPlugin);
await agent.run('Calculate 2+2');
````

### CLI

```bash
# 单次 prompt
agentforge run -p "Calculate 123 * 456"

# 交互模式
agentforge run

# 指定 maxSteps
agentforge run -s 5
```

### Demo 模式

```bash
# 交互式 Demo（本地 Agent）
pnpm demo

# 启动 Agent Server
pnpm demo:server

# 启动 Web UI（连接 localhost:3000）
pnpm demo:web

# CLI 客户端
pnpm demo:client "Calculate 2+2"

# E2E 测试
pnpm demo:e2e
```

### Web UI

启动 Server 和 Web UI：

```bash
# 终端1: 启动 Agent Server
pnpm demo:server

# 终端2: 启动 Web Server
pnpm demo:web
# 打开浏览器访问 http://localhost:8080
```

## 环境变量

### Agent 配置

| Variable          | Description     | Default       |
| ----------------- | --------------- | ------------- |
| `OPENAI_API_KEY`  | OpenAI API 密钥 | -             |
| `MODEL`           | 模型名称        | `gpt-4-turbo` |
| `OPENAI_BASE_URL` | API 地址        | -             |

### Server 配置

| Variable               | Description    | Default |
| ---------------------- | -------------- | ------- |
| `PORT`                 | Server 端口    | 3000    |
| `SERVER_API_KEY`       | API 认证密钥   | -       |
| `CORS_ORIGINS`         | 允许的Origins  | `*`     |
| `COMPACTION_THRESHOLD` | 压缩阈值消息数 | 20      |
| `COMPACTION_ENABLED`   | 是否启用压缩   | `true`  |

### Demo 配置

| Variable          | Description     |
| ----------------- | --------------- |
| `DOUBAO_API_KEY`  | LLM API 密钥    |
| `DOUBAO_BASE_URL` | LLM API 地址    |
| `SERVER_URL`      | Client 连接地址 |
| `CLIENT_API_KEY`  | Client 认证密钥 |

## 技术栈

- **语言**: TypeScript (ESM)
- **运行时**: Node.js
- **包管理**: pnpm
- **LLM SDK**: @ai-sdk
- **HTTP 框架**: Hono
- **响应式**: RxJS
- **验证**: Zod
- **测试**: Vitest

## 多客户端架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      多客户端架构                                 │
├─────────────┬─────────────┬─────────────┬──────────────────────┤
│  Web        │  CLI        │  Mobile     │  Future...          │
│  (浏览器)   │  (终端)    │  (App)      │  (扩展)             │
└──────┬──────┴──────┬──────┴──────┬──────┴──────────┬───────┘
       │             │             │                │
       │    SDK (TypeScript)       │                │
       └─────────────────────────────┴────────────────┘
                        │
                 ┌──────▼──────┐
                 │ Agent Server │
                 │  (单一实例)  │
                 └──────────────┘
```

### 扩展新客户端

1. Server 提供 REST API + OpenAPI 文档
2. 使用 OpenAPI Generator 生成各语言 SDK
3. 或手动实现 SDK（参考 `src/sdk/client.ts`）

## 模块开发规范

### 新增模块 Checklist

| 项目         | 必须 | 说明                         |
| ------------ | ---- | ---------------------------- |
| Logger 实例  | ✓    | `createLogger('moduleName')` |
| 初始化日志   | ✓    | 模块启动时记录               |
| 错误日志     | ✓    | 异常时记录                   |
| 关键操作日志 | ✓    | 核心逻辑执行时               |
| Hook 触发点  | △    | 仅当有扩展需求时             |
| Span 追踪    | △    | 仅当涉及多步骤操作时         |

### Hook 插入位置

```
模块生命周期：
    ┌─────────────┐
    │   初始化    │  → hook: 'module.init'
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   执行操作   │  → hook: 'module.operation.before/after'
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   完成/错误 │  → hook: 'module.complete' / 'module.error'
    └─────────────┘
```

### 代码模板

```typescript
// 新模块模板
import { createLogger } from './logger/index.js';
import { getTracer } from './tracer.js';
import { PluginManager } from './plugin/index.js';

const log = createLogger('newModule');

export class NewModule {
  constructor(private pluginManager: PluginManager) {
    log.info('NewModule initialized');
  }

  async execute(input: any) {
    const span = getTracer().startSpan('newModule.execute');

    try {
      log.info('Executing', { input });
      await this.pluginManager.trigger('newModule.before', { input }, {});

      const result = await this.doExecute(input);

      await this.pluginManager.trigger('newModule.after', { input, result }, {});
      log.info('Executed successfully', { result });
      getTracer().endSpan(span.spanId, 'completed');

      return result;
    } catch (err) {
      log.error('Execution failed', { error: err.message });
      getTracer().endSpan(span.spanId, 'failed', err);
      throw err;
    }
  }
}
```

### 日志级别规范

| 级别    | 使用场景                    |
| ------- | --------------------------- |
| `info`  | 关键操作入口/出口、状态变化 |
| `warn`  | 可恢复的异常、非致命错误    |
| `error` | 异常错误、失败操作          |
| `debug` | 详细调试信息（可选）        |

## 新增模块 (2026-04)

### 13. Config (src/config/)

配置验证，使用 Zod schemas。

```typescript
import { validateServerConfig, validateAgentConfig } from 'agentforge';

const serverConfig = validateServerConfig({ port: 3000 });
const agentConfig = validateAgentConfig({ model: 'gpt-4-turbo', maxSteps: 10 });
```

### 14. Errors (src/errors/)

统一错误类型体系。

```typescript
import { AppError, NotFoundError, ToolExecuteError, LLMError } from 'agentforge';

throw new NotFoundError('Session not found');
throw new ToolExecuteError('calculator', 'Division by zero');
throw new LLMError('API rate limit exceeded');
```

### 15. Retry (src/retry/)

重试机制，支持指数退避。

```typescript
import { withRetry } from 'agentforge';

const result = await withRetry(() => apiCall(), { maxAttempts: 3, delayMs: 1000, backoff: 2 });
```

### 16. Cache (src/cache/)

工具结果内存缓存，默认 TTL 60 秒。

```typescript
import { toolCache } from 'agentforge';

toolCache.set('key', 'value', 60000);
const value = toolCache.get<string>('key');
toolCache.clear();
```

### 17. Storage (src/storage/)

通用文件系统存储（见上文 Session 管理）。

### 18. Server 中间件

Server 已内置以下中间件：

| 中间件                | 说明                                 |
| --------------------- | ------------------------------------ |
| `errorMiddleware`     | 全局错误处理，统一错误响应格式       |
| `loggingMiddleware`   | 请求日志，记录方法、路径、状态、耗时 |
| `rateLimitMiddleware` | 速率限制，默认 100req/min            |
| `authMiddleware`      | API Key 认证                         |

## 环境变量

### 新增配置

| Variable | Description          | Default |
| -------- | -------------------- | ------- |
| -        | 配置验证在代码中完成 | -       |
