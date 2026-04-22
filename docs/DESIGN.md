# AgentForge 框架设计文档

## 一、设计目标与原则

### 1.1 设计目标

构建一个**通用 Agent 开发框架**，使得开发者能够：

1. 基于框架构建各种类型的 Agent（不只是 Coding Agent）
2. 通过扩展机制定制 Agent 能力
3. 灵活接入各种 LLM Provider
4. 通过 Server SDK 将 Agent 作为服务暴露

### 1.2 设计原则

| 原则             | 描述                                      |
| ---------------- | ----------------------------------------- |
| **接口先于实现** | 先定义清晰接口，再实现具体逻辑            |
| **可插拔架构**   | 组件之间通过接口解耦，可动态替换          |
| **可扩展性**     | 支持 Middleware、Plugin、Skill 等扩展机制 |
| **类型安全**     | 严格 TypeScript 类型，100% 类型覆盖       |
| **最小依赖**     | 核心保持轻量，扩展按需引入                |

---

## 二、整体架构

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgentForge                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Core Layer                          │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │  Agent  │  │  Tool   │  │ Memory  │  │Provider │    │   │
│  │  │ Engine  │  │ System  │  │ System  │  │  Layer  │    │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │              Middleware System                  │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Extension Layer                       │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │   MCP   │  │  Skill  │  │ Plugin  │  │  Hook   │    │   │
│  │  │ Client  │  │ System  │  │ System  │  │ System  │    │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Server Layer                        │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │   HTTP  │  │ Session │  │  Chat   │  │   SDK   │    │   │
│  │  │ Server  │  │   API   │  │   API   │  │ Generator│   │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 包结构

```
packages/
├── core/                    # 核心抽象层
│   ├── agent/              # Agent 引擎
│   │   ├── index.ts        # 导出
│   │   ├── Agent.ts        # Agent 基类
│   │   ├── AgentFactory.ts # Agent 工厂
│   │   ├── types.ts        # 类型定义
│   │   ├── executor.ts     # 执行循环
│   │   └── registry.ts     # Agent 注册表
│   ├── tool/               # Tool 系统
│   │   ├── index.ts
│   │   ├── Tool.ts         # Tool 接口
│   │   ├── ToolRegistry.ts # 工具注册
│   │   ├── executor.ts     # 工具执行器
│   │   └── types.ts
│   ├── memory/             # Memory 系统
│   │   ├── index.ts
│   │   ├── Session.ts      # 会话
│   │   ├── SessionManager.ts
│   │   ├── Compactor.ts    # 上下文压缩
│   │   └── types.ts
│   ├── provider/           # LLM Provider
│   │   ├── index.ts
│   │   ├── Provider.ts     # Provider 接口
│   │   ├── registry.ts     # Provider 注册
│   │   ├── types.ts
│   │   └── stream.ts       # 流式支持
│   ├── middleware/         # 中间件系统
│   │   ├── index.ts
│   │   ├── Middleware.ts   # 中间件接口
│   │   ├── Pipeline.ts     # 管道
│   │   └── types.ts
│   ├── storage/            # 存储层
│   │   ├── index.ts
│   │   ├── Storage.ts      # 存储接口
│   │   ├── QueryBuilder.ts
│   │   └── types.ts
│   └── types/              # 共享类型
│       └── index.ts
├── server/                  # Server SDK
│   ├── src/
│   │   ├── index.ts        # 服务入口
│   │   ├── http/           # HTTP 服务
│   │   │   ├── server.ts
│   │   │   └── middleware.ts
│   │   ├── session/        # Session API
│   │   │   ├── routes.ts
│   │   │   └── handler.ts
│   │   ├── chat/           # Chat API
│   │   │   ├── routes.ts
│   │   │   ├── handler.ts
│   │   │   └── sse.ts
│   │   ├── tool/           # Tool API
│   │   ├── agent/          # Agent API
│   │   ├── auth/           # 认证
│   │   │   ├── index.ts
│   │   │   └── middleware.ts
│   │   ├── openapi/        # OpenAPI 文档
│   │   │   └── index.ts
│   │   └── error/          # 错误处理
│   │       └── handler.ts
│   └── package.json
├── extensions/              # 扩展机制
│   ├── mcp/                # MCP Client
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   └── tools.ts
│   │   └── package.json
│   ├── skill/              # Skill 系统
│   │   ├── src/
│   │   │   ├── Skill.ts
│   │   │   ├── SkillManager.ts
│   │   │   ├── loader.ts
│   │   │   └── types.ts
│   │   └── package.json
│   └── plugin/             # Plugin 系统
│       ├── src/
│       │   ├── Plugin.ts
│       │   ├── PluginManager.ts
│       │   ├── hooks.ts
│       │   └── types.ts
│       └── package.json
├── llm/                     # LLM Provider 实现
│   ├── openai/             # OpenAI
│   ├── anthropic/          # Anthropic
│   └── openai-compatible/  # OpenAI 兼容
└── storage/                 # 存储实现
    ├── memory/             # 内存存储
    ├── sqlite/             # SQLite
    └── postgres/           # PostgreSQL
```

---

## 三、框架对比分析

### 3.1 现有框架架构对比

| 维度         | Mastra                       | DeepAgents             | OpenHarness            |
| ------------ | ---------------------------- | ---------------------- | ---------------------- |
| **语言**     | TypeScript                   | Python                 | Python                 |
| **架构模式** | 中心化编排 + 插件            | Middleware 模式        | Swarm 多 Agent         |
| **核心组件** | Agent/Tools/Memory/Workflows | Agent/Middleware/Tools | Agent/Swarm/Permission |
| **存储**     | 可插拔 (DuckDB/PG)           | 中间件                 | 可配置                 |
| **Server**   | 完整                         | 完整                   | 基础                   |
| **复杂度**   | ⭐⭐⭐⭐⭐                   | ⭐⭐⭐⭐               | ⭐⭐⭐⭐               |

### 3.2 设计模式总结

#### Mastra 的设计模式（推荐参考）

```
Mastra Core
├── Mastra 类（中心配置 + DI）
├── Agent（AI 交互抽象，含 tools/memory/voice）
├── Tools（动态工具组合）
├── Memory（Thread 持久化 + 语义召回）
├── Workflows（步骤执行 + 暂停/恢复）
└── Storage（可插拔后端）
```

**关键设计理念：**

- **中心化配置**：Mastra 类作为核心入口
- **可组合性**：Tool、Memory 等都是可插拔组件
- **依赖注入**：通过 Mastra 实例管理依赖

#### DeepAgents 的设计模式

```
DeepAgents
├── Agent（核心执行）
├── Middleware（拦截器模式）
│   ├── Memory Middleware
│   ├── Filesystem Middleware
│   └── ...
├── ACP（Agent Context Protocol）
└── Evals（评估套件）
```

**关键设计理念：**

- **Middleware 拦截**：所有能力通过 Middleware 注入
- **协议化**：ACP 定义 Agent 交互协议
- **评估驱动**：Evals 作为核心组成部分

#### OpenHarness 的设计模式

```
OpenHarness
├── AgentDefinition（Agent 定义）
├── Swarm（多 Agent 编排）
│   ├── InProcessSwarm
│   └── MailboxSwarm
├── Coordinator（协调器）
└── Permission（权限控制）
```

**关键设计理念：**

- **多 Agent 协作**：Swarm 作为多 Agent 运行时
- **权限控制**：Permission 机制
- **Mailbox 通信**：Agent 间消息传递

---

## 四、核心组件设计

### 4.1 Agent 引擎 (`packages/core/agent`)

#### 4.1.1 Agent 类型定义

```typescript
// types.ts

export type AgentType =
  | 'general' // 通用对话 Agent
  | 'coding' // 编码 Agent
  | 'planning' // 规划 Agent
  | 'exploring' // 探索 Agent
  | 'custom'; // 自定义类型

export type AgentStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

export interface AgentConfig {
  id: string;
  name: string;
  type: AgentType;
  description?: string;

  // 模型配置
  model: string;
  provider: string;
  modelSettings?: ModelSettings;

  // 能力配置
  tools?: Tool[];
  skills?: ISkill[];
  middleware?: Middleware[];

  // 执行配置
  maxToolCallRounds?: number;
  timeout?: number;

  // 扩展配置
  metadata?: Record<string, unknown>;
}

export interface ModelSettings {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
}

export interface AgentContext {
  sessionId: string;
  agentId: string;
  startTime: number;
  round: number;
  shouldStop: boolean;
  shouldBreak: boolean;
  metadata: Record<string, unknown>;
}

export interface AgentStats {
  rounds: number;
  llmCalls: number;
  toolCalls: number;
  totalTokens: number;
  duration: number;
}
```

#### 4.1.2 Agent 基类

```typescript
// Agent.ts

import { Effect } from 'effect';
import type { AgentConfig, AgentContext, AgentStatus, AgentStats } from './types.js';
import type { Tool } from '../tool/types.js';
import type { Middleware } from '../middleware/types.js';
import type { Provider } from '../provider/types.js';
import type { Session } from '../memory/types.js';

export interface Agent {
  // 标识
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly status: AgentStatus;

  // 生命周期
  initialize(): Effect<void, AgentError>;
  execute(input: AgentInput): Effect<AgentResponse, AgentError>;
  pause(): Effect<void, AgentError>;
  resume(): Effect<void, AgentError>;
  stop(): Effect<void, AgentError>;

  // 能力注册
  registerTool(tool: Tool): void;
  unregisterTool(name: string): void;
  getTools(): Tool[];

  registerMiddleware(middleware: Middleware): void;
  getMiddleware(): Middleware[];

  // 状态
  getContext(): AgentContext;
  getStats(): AgentStats;
  getSession(): Effect<Session, AgentError>;

  // 快照
  takeSnapshot(): string;
  restore(data: string): void;
}

export interface AgentInput {
  messages: Message[];
  sessionId?: string;
  stream?: boolean;
  onChunk?: (chunk: string) => void;
}

export interface AgentResponse {
  text: string;
  session: Session;
  toolCalls?: ToolCall[];
  stats: AgentStats;
}

export interface Message {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolName?: string;
  timestamp?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}
```

#### 4.1.3 Agent 工厂

```typescript
// AgentFactory.ts

import { Effect } from 'effect';
import type { Agent, AgentConfig } from './Agent.js';

export interface AgentFactory {
  create(config: AgentConfig): Effect<Agent, FactoryError>;
  registerBuilder(type: string, builder: AgentBuilder): void;
  getBuilder(type: string): AgentBuilder | undefined;
  listBuilders(): string[];
}

export interface AgentBuilder {
  build(config: AgentConfig): Effect<Agent, BuildError>;
  getDefaultConfig(): Partial<AgentConfig>;
  getRequiredFields(): string[];
}

// 内置 Builder
export class GeneralAgentBuilder implements AgentBuilder { ... }
export class CodingAgentBuilder implements AgentBuilder { ... }
export class PlanningAgentBuilder implements AgentBuilder { ... }
```

#### 4.1.4 Agent 执行器（ReAct 循环）

```typescript
// executor.ts

import { Effect, pipe } from 'effect';
import type { Agent, AgentInput, AgentResponse } from './Agent.js';
import type { Provider } from '../provider/types.js';
import type { ToolExecutor } from '../tool/executor.js';
import type { SessionManager } from '../memory/SessionManager.js';

export class AgentExecutor {
  constructor(
    private provider: Provider,
    private toolExecutor: ToolExecutor,
    private sessionManager: SessionManager,
    private maxRounds: number = 5
  ) {}

  execute(agent: Agent, input: AgentInput): Effect<AgentResponse, ExecutorError> {
    const processRound = (round: number): Effect<AgentResponse, ExecutorError> => {
      // 1. 检查停止条件
      if (round > this.maxRounds) {
        return Effect.fail(new ExecutorError('Max rounds exceeded'));
      }

      // 2. 获取当前会话消息
      const messages = this.buildMessages(agent, input);

      // 3. 调用 LLM
      return pipe(
        this.provider.generate({
          messages,
          tools: agent.getTools(),
        }),
        Effect.flatMap((result) => {
          // 4. 无工具调用，直接返回
          if (!result.toolCalls || result.toolCalls.length === 0) {
            return this.returnResponse(agent, result.text);
          }

          // 5. 执行工具调用
          return pipe(
            this.toolExecutor.execute(result.toolCalls),
            Effect.flatMap(() => processRound(round + 1))
          );
        })
      );
    };

    return processRound(1);
  }

  private buildMessages(agent: Agent, input: AgentInput): Message[] {
    // 构建完整的消息列表
    return [
      ...agent.getSystemPrompt(), // 系统提示
      ...input.messages, // 用户输入
    ];
  }
}
```

---

### 4.2 Tool 系统 (`packages/core/tool`)

#### 4.2.1 Tool 接口

```typescript
// types.ts

export interface Tool {
  // 标识
  readonly name: string;
  readonly description: string;

  // Schema
  readonly parameters: JSONSchema;
  readonly returns?: JSONSchema;

  // 执行
  execute(params: Record<string, unknown>): Effect<ToolResult, ToolError>;

  // 元数据
  readonly category?: string;
  readonly tags?: string[];
  readonly examples?: ToolExample[];
  readonly deprecated?: boolean;
  readonly deprecationMessage?: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: {
    duration: number;
    tokens?: number;
    [key: string]: unknown;
  };
}

export interface ToolExample {
  input: Record<string, unknown>;
  output: unknown;
  description?: string;
}

export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'null';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
}
```

#### 4.2.2 Tool 注册表

```typescript
// ToolRegistry.ts

import { Effect } from 'effect';
import type { Tool, ToolResult, ToolError } from './types.js';

export interface ToolRegistry {
  // 注册
  register(tool: Tool): Effect<void, RegistryError>;
  unregister(name: string): Effect<void, RegistryError>;
  registerBatch(tools: Tool[]): Effect<void, RegistryError>;

  // 查询
  get(name: string): Tool | undefined;
  getAll(): Tool[];
  getByCategory(category: string): Tool[];
  search(query: string): Tool[];

  // 工具
  has(name: string): boolean;
  size(): number;
  clear(): void;
}

// 内置工具分类
export const TOOL_CATEGORIES = {
  FILESYSTEM: 'filesystem',
  NETWORK: 'network',
  SHELL: 'shell',
  SEARCH: 'search',
  CODE: 'code',
  CUSTOM: 'custom',
} as const;
```

#### 4.2.3 Tool 执行器

```typescript
// executor.ts

import { Effect, pipe } from 'effect';
import type { Tool, ToolResult, ToolCall } from './types.js';
import type { ToolRegistry } from './ToolRegistry.js';

export interface ToolExecutor {
  execute(toolCalls: ToolCall[]): Effect<ToolResult[], ExecutorError>;
  executeSingle(toolCall: ToolCall): Effect<ToolResult, ExecutorError>;
}

export class DefaultToolExecutor implements ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private options: ExecutorOptions = {}
  ) {}

  execute(toolCalls: ToolCall[]): Effect<ToolResult[], ExecutorError> {
    return pipe(
      Effect.all(toolCalls.map((tc) => this.executeSingle(tc))),
      Effect.mapError((errors) => new ExecutorError(errors.join('; ')))
    );
  }

  executeSingle(toolCall: ToolCall): Effect<ToolResult, ExecutorError> {
    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      return Effect.fail(new ExecutorError(`Tool not found: ${toolCall.name}`));
    }

    const startTime = Date.now();

    return pipe(
      Effect.tryPromise({
        try: async () => await tool.execute(toolCall.parameters),
        catch: (error) => new ExecutorError(`Tool execution failed: ${error}`),
      }),
      Effect.map((result) => ({
        ...result,
        metadata: {
          ...result.metadata,
          duration: Date.now() - startTime,
        },
      }))
    );
  }
}

export interface ExecutorOptions {
  parallel?: boolean;
  maxParallel?: number;
  timeout?: number;
  retry?: RetryOptions;
}

export interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
}
```

---

### 4.3 Memory 系统 (`packages/core/memory`)

#### 4.3.1 Session 接口

```typescript
// types.ts

export interface Session {
  readonly id: string;
  readonly agentId: string;
  readonly createdAt: number;
  readonly updatedAt: number;

  // 消息
  messages: Message[];
  systemPrompt?: string;

  // 上下文
  context: SessionContext;
  metadata: SessionMetadata;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SessionContext {
  variables: Record<string, unknown>;
  history: ConversationHistory[];
}

export interface SessionMetadata {
  title?: string;
  description?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface ConversationHistory {
  round: number;
  userMessage: string;
  assistantMessage: string;
  toolCalls: ToolCall[];
  timestamp: number;
}
```

#### 4.3.2 Session 管理器

```typescript
// SessionManager.ts

import { Effect } from 'effect';
import type { Session, SessionConfig, SessionFilter } from './types.js';

export interface SessionManager {
  // 生命周期
  create(config: SessionConfig): Effect<Session, SessionError>;
  get(id: string): Effect<Session | null, SessionError>;
  update(session: Session): Effect<Session, SessionError>;
  delete(id: string): Effect<void, SessionError>;

  // 查询
  list(filter?: SessionFilter): Effect<Session[], SessionError>;
  count(filter?: SessionFilter): Effect<number, SessionError>;

  // 消息操作
  addMessage(sessionId: string, message: Message): Effect<Session, SessionError>;
  getMessages(sessionId: string, options?: MessageQueryOptions): Effect<Message[], SessionError>;
  clearMessages(sessionId: string): Effect<void, SessionError>;

  // 持久化
  persist(session: Session): Effect<void, SessionError>;
  restore(id: string): Effect<Session, SessionError>;

  // 压缩
  compress(sessionId: string, maxTokens: number): Effect<Session, SessionError>;
}

export interface SessionConfig {
  agentId: string;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionFilter {
  agentId?: string;
  startDate?: number;
  endDate?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MessageQueryOptions {
  limit?: number;
  offset?: number;
  roles?: Message['role'][];
  since?: number;
}
```

#### 4.3.3 上下文压缩器

```typescript
// Compactor.ts

import { Effect } from 'effect';
import type { Message } from './types.js';

export interface ContextCompactor {
  compress(messages: Message[], maxTokens: number): Effect<Message[], CompactorError>;
  extract(messages: Message[], focusOn: string[]): Effect<Message[], CompactorError>;
  summarize(messages: Message[]): Effect<string, CompactorError>;
}

export interface CompactionStrategy {
  name: string;
  description: string;
  compress(messages: Message[], maxTokens: number): Message[];
}

export const COMPACTION_STRATEGIES = {
  KEEP_LATEST: 'keep-latest',
  KEEP_TOOL_RESULTS: 'keep-tool-results',
  SLIDING_WINDOW: 'sliding-window',
  SMART_SUMMARY: 'smart-summary',
} as const;
```

---

### 4.4 LLM Provider 层 (`packages/core/provider`)

#### 4.4.1 Provider 接口

```typescript
// types.ts

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly supportsStream: boolean;
  readonly supportsFunctionCalling: boolean;

  generate(options: GenerateOptions): Effect<GenerateResult, ProviderError>;
  generateStream?(options: GenerateOptions): Effect<StreamResult, ProviderError>;
  listModels(): Model[];
  validateKey(): Effect<void, ProviderError>;
}

export interface GenerateOptions {
  messages: Message[];
  tools?: Tool[];
  modelSettings?: ModelSettings;
  systemPrompt?: string;
}

export interface GenerateResult {
  text: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  finishReason: 'stop' | 'length' | 'tool_calls';
}

export interface ModelSettings {
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  presencePenalty?: number;
  frequencyPenalty?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  inputCostPer1kTokens?: number;
  outputCostPer1kTokens?: number;
}
```

#### 4.4.2 流式支持

```typescript
// stream.ts

export interface StreamEvent {
  type: 'text-delta' | 'tool-call-start' | 'tool-call-delta' | 'tool-call-end' | 'done' | 'error';
  content?: string;
  toolCallId?: string;
  toolName?: string;
  parameters?: Record<string, unknown>;
  text?: string;
  toolCalls?: ToolCall[];
  error?: string;
}

export interface StreamResult extends AsyncIterable<StreamEvent> {
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>;
  collectText(): Promise<string>;
  collectToolCalls(): Promise<ToolCall[]>;
}
```

#### 4.4.3 Provider 注册表

```typescript
// registry.ts

import { Effect } from 'effect';
import type { Provider, Model } from './types.js';

export interface ProviderRegistry {
  register(provider: Provider): Effect<void, RegistryError>;
  unregister(id: string): Effect<void, RegistryError>;
  get(id: string): Provider | undefined;
  getByModel(modelId: string): Provider | undefined;
  listProviders(): Provider[];
  listModels(): Model[];
  listModelsByProvider(providerId: string): Model[];
  has(id: string): boolean;
  size(): number;
}

export const PROVIDER_IDS = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GOOGLE: 'google',
  AZURE_OPENAI: 'azure-openai',
  BEDROCK: 'bedrock',
  OPENAI_COMPATIBLE: 'openai-compatible',
} as const;
```

---

### 4.5 Middleware 系统 (`packages/core/middleware`)

#### 4.5.1 Middleware 接口

```typescript
// types.ts

export type MiddlewareEventType =
  | 'agent:start'
  | 'agent:stop'
  | 'agent:message:receive'
  | 'agent:message:send'
  | 'agent:step:complete'
  | 'agent:status:change'
  | 'llm:request:before'
  | 'llm:request:after'
  | 'llm:stream:start'
  | 'llm:stream:chunk'
  | 'llm:stream:end'
  | 'tool:call:start'
  | 'tool:call:end'
  | 'tool:call:error'
  | 'session:create'
  | 'session:restore'
  | 'error';

export interface MiddlewareContext {
  event: MiddlewareEventType;
  timestamp: number;
  sessionId?: string;
  agentId?: string;
  data: Record<string, unknown>;
}

export interface Middleware {
  readonly name: string;
  readonly events: MiddlewareEventType[];
  process(context: MiddlewareContext): Effect<MiddlewareContext, MiddlewareError>;
  initialize?(): Effect<void, MiddlewareError>;
  destroy?(): Effect<void, MiddlewareError>;
}

export interface MiddlewarePipeline {
  use(middleware: Middleware): void;
  execute(event: MiddlewareEventType, data: Record<string, unknown>): Effect<void, PipelineError>;
  remove(name: string): void;
  clear(): void;
}
```

#### 4.5.2 内置 Middleware

```typescript
// builtins.ts

export class LoggerMiddleware implements Middleware {
  name = 'logger';
  events = ['*'];

  process(context: MiddlewareContext): Effect<MiddlewareContext, MiddlewareError> {
    console.log(`[${context.event}]`, context.data);
    return Effect.succeed(context);
  }
}

export class MetricsMiddleware implements Middleware {
  name = 'metrics';
  events = ['llm:request:after', 'tool:call:end', 'agent:step:complete'];

  private metrics = new Map<string, number>();

  process(context: MiddlewareContext): Effect<MiddlewareContext, MiddlewareError> {
    return Effect.succeed(context);
  }
}

export class ErrorHandlerMiddleware implements Middleware {
  name = 'error-handler';
  events = ['error'];

  process(context: MiddlewareContext): Effect<MiddlewareContext, MiddlewareError> {
    return Effect.succeed(context);
  }
}
```

---

## 五、存储层设计 (`packages/storage`)

### 5.1 存储架构

```
packages/storage/
├── core/                    # 存储核心抽象
│   ├── index.ts            # 导出
│   ├── Storage.ts          # 存储接口
│   ├── QueryBuilder.ts     # 查询构建器
│   └── types.ts            # 类型定义
├── memory/                 # 内存存储实现
│   └── src/
│       └── MemoryStorage.ts
├── sqlite/                 # SQLite 实现
│   └── src/
│       ├── SQLiteStorage.ts
│       ├── migrations/
│       └── schema.ts
└── postgres/               # PostgreSQL 实现
    └── src/
        ├── PostgresStorage.ts
        ├── migrations/
        └── schema.ts
```

### 5.2 存储接口设计

```typescript
// core/types.ts

export interface StorageConfig {
  type: 'memory' | 'sqlite' | 'postgres';
  connectionString?: string;
  options?: StorageOptions;
}

export interface StorageOptions {
  maxConnections?: number;
  timeout?: number;
  retryAttempts?: number;
  filePath?: string;
  mode?: 'readwrite' | 'readonly' | 'memory';
  ssl?: boolean;
  poolSize?: number;
}

export interface Storage {
  connect(): Effect<void, StorageError>;
  disconnect(): Effect<void, StorageError>;
  isConnected(): boolean;
  insert<T>(table: string, data: T): Effect<string, StorageError>;
  upsert<T>(table: string, data: T, key: string): Effect<void, StorageError>;
  update<T>(table: string, id: string, data: Partial<T>): Effect<void, StorageError>;
  delete(table: string, id: string): Effect<void, StorageError>;
  findById<T>(table: string, id: string): Effect<T | null, StorageError>;
  findOne<T>(table: string, filter: Filter): Effect<T | null, StorageError>;
  findMany<T>(table: string, filter: Filter, options?: QueryOptions): Effect<T[], StorageError>;
  count(table: string, filter?: Filter): Effect<number, StorageError>;
  sum(table: string, field: string, filter?: Filter): Effect<number, StorageError>;
  transaction<T>(fn: () => Effect<T, StorageError>): Effect<T, StorageError>;
  migrate(): Effect<void, StorageError>;
  getVersion(): Effect<string, StorageError>;
}

export interface Filter {
  where?: Record<string, unknown>;
  and?: Filter[];
  or?: Filter[];
  not?: Filter;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: OrderBy[];
  select?: string[];
}

export interface OrderBy {
  field: string;
  direction: 'asc' | 'desc';
}
```

### 5.3 Schema 定义

```typescript
// sqlite/schema.ts

export const SCHEMA_VERSION = '1.0.0';

export const TABLES = {
  SESSIONS: 'sessions',
  MESSAGES: 'messages',
  AGENTS: 'agents',
  TOOLS: 'tools',
  METRICS: 'metrics',
} as const;

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLES.AGENTS} (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ${TABLES.SESSIONS} (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  system_prompt TEXT,
  context TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES ${TABLES.AGENTS}(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ${TABLES.MESSAGES} (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  name TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  timestamp INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES ${TABLES.SESSIONS}(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON ${TABLES.MESSAGES}(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON ${TABLES.MESSAGES}(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON ${TABLES.SESSIONS}(agent_id);

CREATE TABLE IF NOT EXISTS ${TABLES.METRICS} (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  value REAL NOT NULL,
  metadata TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES ${TABLES.SESSIONS}(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES ${TABLES.AGENTS}(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metrics_session ON ${TABLES.METRICS}(session_id);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON ${TABLES.METRICS}(timestamp);
`;
```

---

## 六、Server SDK 设计 (`packages/server`)

### 6.1 HTTP 服务

```typescript
// http/server.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Agent } from '@agentforge/core';

export interface ServerConfig {
  port: number;
  hostname: string;
  cors: CorsOptions;
  auth: AuthConfig;
  openapi: boolean;
}

export interface CorsOptions {
  origin: string | string[];
  credentials: boolean;
}

export interface AuthConfig {
  type: 'none' | 'basic' | 'bearer';
  users?: Record<string, string>;
  validator?: (token: string) => Promise<boolean>;
}

export class AgentServer {
  private app: Hono;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.app = new Hono();
    this.config = config;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use('*', cors(this.config.cors));
    this.app.use('*', logger());
    this.app.use('*', this.authMiddleware());
  }

  private setupRoutes() {
    this.app.get('/health', this.healthCheck());
    this.app.route('/api/sessions', this.sessionRouter);
    this.app.route('/api/chat', this.chatRouter);
    this.app.route('/api/tools', this.toolRouter);
    if (this.config.openapi) {
      this.app.get('/doc', this.openApiDocs());
    }
  }

  async start(): Promise<void> {
    console.log(
      `🚀 AgentForge Server running on http://${this.config.hostname}:${this.config.port}`
    );
  }
}
```

### 6.2 Session API

```typescript
// session/routes.ts

const sessionRouter = new Hono();

sessionRouter.post('/', zValidator('json', CreateSessionSchema), createSessionHandler);
sessionRouter.get('/', zValidator('query', ListSessionsSchema), listSessionsHandler);
sessionRouter.get('/:id', getSessionHandler);
sessionRouter.put('/:id', zValidator('json', UpdateSessionSchema), updateSessionHandler);
sessionRouter.delete('/:id', deleteSessionHandler);
sessionRouter.get('/:id/messages', zValidator('query', GetMessagesSchema), getMessagesHandler);
sessionRouter.post('/:id/messages', zValidator('json', AddMessageSchema), addMessageHandler);
sessionRouter.post('/:id/compress', zValidator('json', CompressSchema), compressHandler);

const CreateSessionSchema = z.object({
  agentId: z.string().min(1),
  systemPrompt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.number().optional(),
});

const ListSessionsSchema = z.object({
  agentId: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  orderBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
```

### 6.3 Chat API (SSE)

```typescript
// chat/routes.ts

const chatRouter = new Hono();

chatRouter.post('/', async (c) => {
  const { sessionId, message, stream } = await c.req.json();

  if (!stream) {
    const response = await agent.execute({ messages: [{ role: 'user', content: message }] });
    return c.json({ response: response.text, sessionId });
  }

  return streamSSE(c, async (stream) => {
    await agent.execute({
      messages: [{ role: 'user', content: message }],
      stream: true,
      onChunk: (chunk) => {
        stream.writeSSE({ data: JSON.stringify({ type: 'text-delta', content: chunk }) });
      },
    });

    stream.writeSSE({ data: JSON.stringify({ type: 'done' }) });
  });
});
```

---

## 七、扩展机制设计

### 7.1 MCP Client

```typescript
// mcp/client.ts

import { Effect } from 'effect';
import type { Tool } from '@agentforge/core';

export interface MCPClientConfig {
  serverUrl: string;
  auth?: { type: 'bearer'; token: string };
  timeout?: number;
}

export interface MCPClient {
  connect(): Effect<void, MCPError>;
  disconnect(): Effect<void, MCPError>;
  listTools(): Effect<MCPTool[], MCPError>;
  callTool(name: string, args: object): Effect<unknown, MCPError>;
  listResources(): Effect<MCPResource[], MCPError>;
  readResource(uri: string): Effect<string, MCPError>;
  toAgentForgeTool(mcpTool: MCPTool): Tool;
}
```

### 7.2 Skill 系统

```typescript
// skill/types.ts

export interface Skill {
  readonly meta: SkillMeta;
  readonly parameters: SkillParameter[];
  readonly prompt?: string;
  run(context: SkillContext, params: Record<string, unknown>): Effect<SkillResult, SkillError>;
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
  schema: object;
}

export interface SkillContext {
  agentId: string;
  sessionId: string;
  variables: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface SkillResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface SkillManager {
  loadFromDirectory(path: string): Effect<void, SkillError>;
  loadFromURL(url: string): Effect<void, SkillError>;
  register(skill: Skill): Effect<void, SkillError>;
  unregister(id: string): Effect<void, SkillError>;
  get(id: string): Skill | undefined;
  list(): Skill[];
}
```

### 7.3 Plugin 系统

```typescript
// plugin/types.ts

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;

  install(context: PluginContext): Effect<void, PluginError>;
  uninstall(): Effect<void, PluginError>;
  initialize(): Effect<void, PluginError>;
  destroy(): Effect<void, PluginError>;
  hooks(): PluginHooks;
}

export interface PluginHooks {
  'agent:created'?: (agent: Agent) => Effect<void, PluginError>;
  'agent:destroyed'?: (agent: Agent) => Effect<void, PluginError>;
  'tool:registered'?: (tool: Tool) => Effect<void, PluginError>;
  'session:created'?: (session: Session) => Effect<void, PluginError>;
  'request:before'?: (request: Request) => Effect<Request, PluginError>;
  'request:after'?: (request: Request, response: Response) => Effect<void, PluginError>;
}

export interface PluginContext {
  agentForgeVersion: string;
  config: Record<string, unknown>;
  registerHook(event: string, handler: Function): void;
  getService<T>(serviceId: string): T;
}

export interface PluginManager {
  install(plugin: Plugin): Effect<void, PluginError>;
  uninstall(pluginId: string): Effect<void, PluginError>;
  enable(pluginId: string): Effect<void, PluginError>;
  disable(pluginId: string): Effect<void, PluginError>;
  get(pluginId: string): Plugin | undefined;
  list(): Plugin[];
  listEnabled(): Plugin[];
}
```

---

## 八、类型定义汇总

```typescript
// packages/core/src/types/index.ts

// ========== Agent 类型 ==========
export type AgentType = 'general' | 'coding' | 'planning' | 'exploring' | 'custom';
export type AgentStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

export interface AgentConfig {
  id: string;
  name: string;
  type: AgentType;
  description?: string;
  model: string;
  provider: string;
  modelSettings?: ModelSettings;
  tools?: string[];
  skills?: string[];
  middleware?: string[];
  maxToolCallRounds?: number;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentContext {
  sessionId: string;
  agentId: string;
  startTime: number;
  round: number;
  shouldStop: boolean;
  shouldBreak: boolean;
  metadata: Record<string, unknown>;
}

export interface AgentStats {
  rounds: number;
  llmCalls: number;
  toolCalls: number;
  totalTokens: number;
  duration: number;
}

// ========== Tool 类型 ==========
export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  returns?: JSONSchema;
  execute(params: Record<string, unknown>): Effect<ToolResult, ToolError>;
  category?: string;
  tags?: string[];
  examples?: ToolExample[];
  deprecated?: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: { duration: number; tokens?: number; [key: string]: unknown };
}

// ========== Memory 类型 ==========
export interface Session {
  id: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  systemPrompt?: string;
  context: SessionContext;
  metadata: SessionMetadata;
  expiresAt?: number;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ========== Provider 类型 ==========
export interface Provider {
  id: string;
  name: string;
  supportsStream: boolean;
  supportsFunctionCalling: boolean;
  generate(options: GenerateOptions): Effect<GenerateResult, ProviderError>;
  generateStream?(options: GenerateOptions): Effect<StreamResult, ProviderError>;
  listModels(): Model[];
  validateKey(): Effect<void, ProviderError>;
}

export interface GenerateOptions {
  messages: Message[];
  tools?: Tool[];
  modelSettings?: ModelSettings;
  systemPrompt?: string;
}

export interface GenerateResult {
  text: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  finishReason: 'stop' | 'length' | 'tool_calls';
}

// ========== Middleware 类型 ==========
export type MiddlewareEventType =
  | 'agent:start'
  | 'agent:stop'
  | 'agent:message:receive'
  | 'agent:message:send'
  | 'agent:step:complete'
  | 'agent:status:change'
  | 'llm:request:before'
  | 'llm:request:after'
  | 'llm:stream:start'
  | 'llm:stream:chunk'
  | 'llm:stream:end'
  | 'tool:call:start'
  | 'tool:call:end'
  | 'tool:call:error'
  | 'session:create'
  | 'session:restore'
  | 'session:compress'
  | 'error';

export interface MiddlewareContext {
  event: MiddlewareEventType;
  timestamp: number;
  sessionId?: string;
  agentId?: string;
  data: Record<string, unknown>;
}

export interface Middleware {
  name: string;
  events: MiddlewareEventType[];
  process(context: MiddlewareContext): Effect<MiddlewareContext, MiddlewareError>;
  initialize?(): Effect<void, MiddlewareError>;
  destroy?(): Effect<void, MiddlewareError>;
}

// ========== Storage 类型 ==========
export interface Storage {
  connect(): Effect<void, StorageError>;
  disconnect(): Effect<void, StorageError>;
  isConnected(): boolean;
  insert<T>(table: string, data: T): Effect<string, StorageError>;
  upsert<T>(table: string, data: T, key: string): Effect<void, StorageError>;
  update<T>(table: string, id: string, data: Partial<T>): Effect<void, StorageError>;
  delete(table: string, id: string): Effect<void, StorageError>;
  findById<T>(table: string, id: string): Effect<T | null, StorageError>;
  findMany<T>(table: string, filter: Filter, options?: QueryOptions): Effect<T[], StorageError>;
  count(table: string, filter?: Filter): Effect<number, StorageError>;
  transaction<T>(fn: () => Effect<T, StorageError>): Effect<T, StorageError>;
  migrate(): Effect<void, StorageError>;
}

// ========== 错误类型 ==========
export abstract class AgentForgeError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AgentError extends AgentForgeError {
  readonly code = 'AGENT_ERROR';
  readonly statusCode = 500;
}

export class ToolError extends AgentForgeError {
  readonly code = 'TOOL_ERROR';
  readonly statusCode = 500;
}

export class SessionError extends AgentForgeError {
  readonly code = 'SESSION_ERROR';
  readonly statusCode = 500;
}

export class ProviderError extends AgentForgeError {
  readonly code = 'PROVIDER_ERROR';
  readonly statusCode = 502;
}

export class StorageError extends AgentForgeError {
  readonly code = 'STORAGE_ERROR';
  readonly statusCode = 500;
}

export class MiddlewareError extends AgentForgeError {
  readonly code = 'MIDDLEWARE_ERROR';
  readonly statusCode = 500;
}
```

---

## 九、实施路线图

### Phase 1: 核心框架 (MVP)

| 周次  | 任务              | 交付物                     |
| ----- | ----------------- | -------------------------- |
| 1-2   | 核心类型定义      | `packages/core/types`      |
| 3-4   | Agent 基类 + 工厂 | `packages/core/agent`      |
| 5-6   | Tool 系统         | `packages/core/tool`       |
| 7-8   | Memory 系统       | `packages/core/memory`     |
| 9-10  | Provider 层       | `packages/core/provider`   |
| 11-12 | Middleware        | `packages/core/middleware` |
| 13-14 | Server 基础       | `packages/server`          |
| 15-16 | 集成测试 + MVP    | 可运行的 Demo Agent        |

### Phase 2: 扩展机制

| 周次  | 任务            | 交付物                       |
| ----- | --------------- | ---------------------------- |
| 17-18 | MCP Client      | `packages/extensions/mcp`    |
| 19-20 | Skill 系统      | `packages/extensions/skill`  |
| 21-22 | Plugin 系统     | `packages/extensions/plugin` |
| 23-24 | 完善 Server API | 完整 Session/Chat API        |
| 25-26 | 认证 + OpenAPI  | 安全 + 文档                  |
| 27-28 | 集成测试        | 扩展机制测试                 |

### Phase 3: 高级能力

| 周次  | 任务          | 交付物                           |
| ----- | ------------- | -------------------------------- |
| 29-30 | 上下文压缩    | `packages/core/memory/Compactor` |
| 31-32 | 多 Agent 协作 | Swarm 支持                       |
| 33-34 | 可观测性      | 日志 + 监控 + 追踪               |
| 35-36 | 性能优化      | 性能测试 + 优化                  |
| 37-38 | SDK 生成      | TypeScript/Python SDK            |
| 39-40 | Demo 完善     | 完整示例                         |

---

## 十、技术决策汇总

| 决策项        | 选择                | 理由                     |
| ------------- | ------------------- | ------------------------ |
| 执行框架      | Effect Framework    | 与 Mastra 一致，类型安全 |
| 存储后端      | SQLite + PostgreSQL | 支持关系型数据           |
| Server 框架   | Hono                | 与 OpenCode/Mastra 一致  |
| 多 Agent 协作 | Phase 3             | MVP 阶段不需要           |
| 编程语言      | TypeScript          | 与现有代码一致           |
| 包管理器      | pnpm                | 与现有项目一致           |

