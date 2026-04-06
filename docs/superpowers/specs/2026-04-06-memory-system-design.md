# Memory System Enhancement Design

## Overview

记忆系统增强，参考 Mastra 的多层次架构：Message History + Working Memory + Observational Memory。

## Tech Stack

- **Language:** TypeScript (ESM)
- **Storage:** InMemory, SQLite
- **Validation:** Zod

## Core Abstractions

### 1. MemoryStorage (存储抽象)

```typescript
export interface MemoryStorage {
  // 线程/会话操作
  getThread(threadId: string): Promise<Thread | null>;
  saveThread(thread: Thread): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
  listThreads(options?: ListThreadsOptions): Promise<Thread[]>;

  // 消息操作
  getMessages(threadId: string): Promise<Message[]>;
  addMessage(threadId: string, message: Message): Promise<void>;

  // 工作记忆操作
  getWorkingMemory(threadId: string): Promise<WorkingMemory | null>;
  saveWorkingMemory(threadId: string, memory: WorkingMemory): Promise<void>;

  // 观察记忆操作 (可选)
  getObservationalMemory(threadId: string): Promise<ObservationalMemory | null>;
  saveObservationalMemory(threadId: string, memory: ObservationalMemory): Promise<void>;
}
```

### 2. MessageHistory (消息历史 - 短期记忆)

```typescript
export interface MessageHistoryConfig {
  lastMessages?: number; // 默认 20
}

export interface MessageHistory {
  add(message: Message): void;
  getMessages(): Message[];
  clear(): void;
}
```

### 3. WorkingMemory (工作记忆)

```typescript
export interface WorkingMemoryConfig {
  enabled: boolean;
  template?: string; // Markdown/JSON 模板
}

export interface WorkingMemory {
  content: string;
  update(content: string): void;
  get(): string;
}
```

### 4. ObservationalMemory (观察记忆 - 可选)

```typescript
export interface ObservationalMemoryConfig {
  enabled: boolean;
  compressionLevel?: 0 | 1 | 2 | 3 | 4; // 默认 2
}

export interface ObservationalMemory {
  observations: Observation[];
  addObservation(observation: Observation): void;
  getObservations(): Observation[];
  compress(level: number): void;
}
```

### 5. MemoryManager (统一入口)

```typescript
export interface MemoryManagerConfig {
  messageHistory?: MessageHistoryConfig;
  workingMemory?: WorkingMemoryConfig;
  observationalMemory?: ObservationalMemoryConfig;
  storage?: MemoryStorage;
}

export interface MemoryManager {
  // 消息历史
  addMessage(message: Message): void;
  getMessages(): Message[];

  // 工作记忆
  getWorkingMemory(): WorkingMemory | null;
  updateWorkingMemory(content: string): void;

  // 观察记忆 (可选)
  getObservationalMemory(): ObservationalMemory | null;
  addObservation(observation: Observation): void;

  // 存储
  save(): Promise<void>;
  load(): Promise<void>;
}
```

## File Structure

```
src/memory/
├── index.ts                    # 主导出
├── types.ts                    # 类型定义
├── base.ts                     # MemoryStorage 基类
├── manager.ts                  # MemoryManager（统一入口）
├── message-history.ts          # 消息历史（短期记忆）
├── working-memory.ts           # 工作记忆
├── observational-memory.ts     # 观察记忆（可选）
├── compressors/
│   └── simple.ts               # 简单压缩器
└── storages/
    ├── inmemory.ts             # 内存存储
    └── sqlite.ts               # SQLite 存储
```

## Core Components

| Component             | File                                 | Description            |
| --------------------- | ------------------------------------ | ---------------------- |
| `MemoryManager`       | `src/memory/manager.ts`              | 统一入口，协调各记忆层 |
| `MessageHistory`      | `src/memory/message-history.ts`      | 短期消息记忆           |
| `WorkingMemory`       | `src/memory/working-memory.ts`       | 结构化工作记忆         |
| `ObservationalMemory` | `src/memory/observational-memory.ts` | 智能观察和总结（可选） |
| `InMemoryStorage`     | `src/memory/storages/inmemory.ts`    | 内存存储实现           |
| `SQLiteStorage`       | `src/memory/storages/sqlite.ts`      | SQLite 存储实现        |

## Usage Examples

### 基本使用

```typescript
import { createMemory, InMemoryStorage } from 'primo-agent/memory';

const memory = createMemory({
  messageHistory: { lastMessages: 20 },
  workingMemory: { enabled: true },
  storage: new InMemoryStorage(),
});

memory.addMessage({ role: 'user', content: 'Hello' });
const messages = memory.getMessages();
```

### 工作记忆

```typescript
memory.updateWorkingMemory('# User Info\n- Name: John');
const workingMemory = memory.getWorkingMemory();
```

### SQLite 持久化

```typescript
import { SQLiteStorage } from 'primo-agent/memory';

const memory = createMemory({
  storage: new SQLiteStorage('./memory.db'),
});

await memory.save();
await memory.load();
```

## Data Flow

### MemoryManager 协调

```
User Input → MemoryManager
              ↓
    ┌─────────┬─────────┬─────────────┐
    ↓         ↓         ↓             ↓
MessageHistory WorkingMemory ObservationalMemory (可选)
    ↓         ↓         ↓
    └─────────┴─────────┴─────────────┘
              ↓
         MemoryStorage
```

## Integration Points

- 替换现有的 `InMemoryHistory` (`src/history.ts`)
- 与 `Session` 系统共享存储
- 保持向后兼容：现有 `HistoryManager` 接口继续支持

## References

- Mastra: `D:\code\mastra\packages\memory\src\memory.ts` (988 行)
- AgentScope: `D:\code\agentscope\src\agentscope\memory\_base.py`
