# 存储 API

存储系统 API 参考。

## IStorage 接口

```typescript
interface IStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  // 对话管理
  createConversation(conversation: Conversation): Promise<string>;
  getConversation(id: string): Promise<Conversation | null>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  listConversationsByAgent(agentId: string): Promise<Conversation[]>;
  listConversationsByUser(userId: string): Promise<Conversation[]>;

  // 消息管理
  createMessage(message: Message): Promise<string>;
  getMessage(id: string): Promise<Message | null>;
  listMessagesByConversation(conversationId: string): Promise<Message[]>;
  deleteMessage(id: string): Promise<void>;
  deleteMessagesByConversation(conversationId: string): Promise<void>;

  // Agent 运行管理
  createAgentRun(run: AgentRun): Promise<string>;
  getAgentRun(id: string): Promise<AgentRun | null>;
  updateAgentRun(id: string, updates: Partial<AgentRun>): Promise<void>;
  listAgentRunsByAgent(agentId: string): Promise<AgentRun[]>;
  listAgentRunsByConversation(conversationId: string): Promise<AgentRun[]>;
}
```

## 类型定义

### Conversation

```typescript
interface Conversation {
  id?: string;
  agentId: string;
  userId?: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}
```

### Message

```typescript
interface Message {
  id?: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}
```

### AgentRun

```typescript
interface AgentRun {
  id?: string;
  conversationId: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  input: string;
  output?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}
```

## SQLiteStorage

SQLite 存储实现。

### 构造函数

```typescript
new SQLiteStorage(config?: SQLiteStorageConfig)
```

**参数：**

```typescript
interface SQLiteStorageConfig {
  path?: string; // 数据库文件路径，默认 ':memory:'
}
```

### 方法

#### initialize

```typescript
async initialize(): Promise<void>
```

初始化数据库连接并创建表。

**示例：**

```typescript
const storage = new SQLiteStorage();
await storage.initialize();
```

#### close

```typescript
async close(): Promise<void>
```

关闭数据库连接。

**示例：**

```typescript
await storage.close();
```

#### createConversation

```typescript
async createConversation(
  conversation: Conversation
): Promise<string>
```

创建新对话，返回对话 ID。

**示例：**

```typescript
const conversationId = await storage.createConversation({
  agentId: 'agent-1',
  userId: 'user-1',
  title: 'My Conversation',
  createdAt: new Date(),
  updatedAt: new Date(),
});
```

#### getConversation

```typescript
async getConversation(id: string): Promise<Conversation | null>
```

获取对话详情。

**示例：**

```typescript
const conversation = await storage.getConversation(conversationId);
if (conversation) {
  console.log('Conversation:', conversation.title);
}
```

#### updateConversation

```typescript
async updateConversation(
  id: string,
  updates: Partial<Conversation>
): Promise<void>
```

更新对话信息。

**示例：**

```typescript
await storage.updateConversation(conversationId, {
  title: 'Updated Title',
  updatedAt: new Date(),
});
```

#### deleteConversation

```typescript
async deleteConversation(id: string): Promise<void>
```

删除对话。

**示例：**

```typescript
await storage.deleteConversation(conversationId);
```

#### listConversationsByAgent

```typescript
async listConversationsByAgent(
  agentId: string
): Promise<Conversation[]>
```

列出 Agent 的所有对话。

**示例：**

```typescript
const conversations = await storage.listConversationsByAgent('agent-1');
console.log('Total conversations:', conversations.length);
```

#### createMessage

```typescript
async createMessage(message: Message): Promise<string>
```

创建新消息，返回消息 ID。

**示例：**

```typescript
const messageId = await storage.createMessage({
  conversationId,
  role: 'user',
  content: 'Hello!',
  createdAt: new Date(),
});
```

#### listMessagesByConversation

```typescript
async listMessagesByConversation(
  conversationId: string
): Promise<Message[]>
```

列出对话的所有消息。

**示例：**

```typescript
const messages = await storage.listMessagesByConversation(conversationId);
messages.forEach((msg) => {
  console.log(`${msg.role}: ${msg.content}`);
});
```

#### createAgentRun

```typescript
async createAgentRun(run: AgentRun): Promise<string>
```

创建新的 Agent 运行记录。

**示例：**

```typescript
const runId = await storage.createAgentRun({
  conversationId,
  agentId: 'agent-1',
  status: 'running',
  input: 'Hello',
  startedAt: new Date(),
});
```

#### updateAgentRun

```typescript
async updateAgentRun(
  id: string,
  updates: Partial<AgentRun>
): Promise<void>
```

更新 Agent 运行记录。

**示例：**

```typescript
await storage.updateAgentRun(runId, {
  status: 'completed',
  output: 'Response',
  completedAt: new Date(),
});
```

## InMemoryHistory

内存历史记录实现，适合测试和简单场景。

```typescript
import { InMemoryHistory } from 'agentforge/memory';

const history = new InMemoryHistory();
```

### 方法

#### addMessage

```typescript
addMessage(message: Message): void
```

添加消息。

#### getMessages

```typescript
getMessages(): Message[]
```

获取所有消息。

#### clear

```typescript
clear(): void
```

清空所有消息。

## 完整示例

```typescript
import { SQLiteStorage } from 'agentforge/storage';

// 初始化存储
const storage = new SQLiteStorage({
  path: './database.sqlite',
});

await storage.initialize();

// 创建对话
const conversationId = await storage.createConversation({
  agentId: 'agent-1',
  userId: 'user-1',
  title: 'Test Conversation',
  createdAt: new Date(),
  updatedAt: new Date(),
});

// 添加消息
await storage.createMessage({
  conversationId,
  role: 'user',
  content: 'Hello!',
  createdAt: new Date(),
});

await storage.createMessage({
  conversationId,
  role: 'assistant',
  content: 'Hi there!',
  createdAt: new Date(),
});

// 创建 Agent 运行
const runId = await storage.createAgentRun({
  conversationId,
  agentId: 'agent-1',
  status: 'running',
  input: 'Hello!',
  startedAt: new Date(),
});

// 更新运行状态
await storage.updateAgentRun(runId, {
  status: 'completed',
  output: 'Hi there!',
  completedAt: new Date(),
});

// 查询数据
const conversation = await storage.getConversation(conversationId);
const messages = await storage.listMessagesByConversation(conversationId);
const runs = await storage.listAgentRunsByAgent('agent-1');

// 关闭存储
await storage.close();
```

## 相关文档

- [核心 API](./core.md) - 核心 API
- [配置 API](./config.md) - 配置系统 API
- [工具 API](./tools.md) - 工具系统 API
