# Mastra DX 特性补齐设计文档

> 创建日期: 2026-04-29
> 状态: 设计中
> 目标: 对标 Mastra DX 特性，补齐 AgentForge 缺失的开发者体验功能
> 范围: 排除 React SDK 和部署工具

---

## 1. 概述

### 1.1 现状分析

| Mastra DX 特性 | AgentForge 现状 | 需要补充 |
|----------------|-----------------|----------|
| CLI 脚手架 | ✅ 已存在 | `create-agentforge` CLI |
| 模板系统 | 2 个模板 | 扩充到 6+ |
| Dev Server | 有 docs server | 新增应用 dev server |
| Studio UI | 有 SSE server | 新增 Vue SPA |
| 可观测性 | 已存在 | 增强 OTel 集成 |

### 1.2 实施路线图

| 阶段 | 特性 | 工作量 | 优先级 |
|------|------|--------|--------|
| Phase 1 | 模板扩充 | 3 天 | P0 |
| Phase 2 | Dev Server | 5 天 | P0 |
| Phase 3 | Studio UI | 10 天 | P1 |
| Phase 4 | 可观测性增强 | 3 天 | P1 |
| **总计** | - | **21 天** | - |

---

## 2. 模板系统扩充

### 2.1 设计目标

从 2 个模板扩充到 6+，覆盖常见用例。

### 2.2 模板清单

| 模板 | 描述 | 复杂度 | 工时 |
|------|------|--------|------|
| `chat-agent` | 简单对话 Agent | 低 | 0.5 天 |
| `tool-agent` | 带自定义工具的 Agent | 低 | 0.5 天 |
| `rag-agent` | 检索增强生成 | 中 | 1 天 |
| `multi-agent` | 编排器 + 工作者模式 | 中 | 1 天 |
| `mcp-agent` | MCP 连接的 Agent | 中 | 0.5 天 |
| `production-agent` | 完整 MPU 栈 | 高 | 0.5 天 |

### 2.3 模板结构

```
packages/create-agentforge/templates/
├── base/                          # 基础模板
│   ├── package.json.hbs
│   ├── tsconfig.json.hbs
│   ├── .gitignore.hbs
│   └── README.md.hbs
├── modules/                       # 可选模块
│   ├── llm/
│   │   ├── openai.ts.hbs
│   │   ├── anthropic.ts.hbs
│   │   └── ollama.ts.hbs
│   ├── tools/
│   │   ├── weather.ts.hbs
│   │   ├── filesystem.ts.hbs
│   │   └── custom.ts.hbs
│   ├── observability/
│   │   ├── logger.ts.hbs
│   │   ├── tracer.ts.hbs
│   │   └── metrics.ts.hbs
│   └── memory/
│       ├── agents-md.ts.hbs
│       └── semantic.ts.hbs
├── examples/                      # 示例模板
│   ├── chat-agent/
│   │   ├── agentforge.config.ts
│   │   ├── package.json
│   │   └── src/
│   ├── tool-agent/
│   ├── rag-agent/
│   ├── multi-agent/
│   ├── mcp-agent/
│   └── production-agent/
└── template.json                  # 模板注册表
```

### 2.4 模板元数据

```json
// template.json
{
  "templates": [
    {
      "id": "chat-agent",
      "name": "Chat Agent",
      "description": "Simple conversational agent with memory",
      "category": "getting-started",
      "complexity": "low",
      "features": ["memory", "streaming"],
      "modules": ["llm/openai", "memory/agents-md"]
    },
    {
      "id": "tool-agent",
      "name": "Tool Agent",
      "description": "Agent with custom tools and filesystem access",
      "category": "getting-started",
      "complexity": "low",
      "features": ["tools", "filesystem"],
      "modules": ["llm/openai", "tools/filesystem"]
    },
    {
      "id": "rag-agent",
      "name": "RAG Agent",
      "description": "Retrieval-augmented generation with vector store",
      "category": "advanced",
      "complexity": "medium",
      "features": ["rag", "vector-store", "embeddings"],
      "modules": ["llm/openai", "memory/semantic"]
    },
    {
      "id": "multi-agent",
      "name": "Multi-Agent",
      "description": "Orchestrator + worker pattern with subagents",
      "category": "advanced",
      "complexity": "medium",
      "features": ["subagent", "workflow"],
      "modules": ["llm/openai", "tools/custom"]
    },
    {
      "id": "mcp-agent",
      "name": "MCP Agent",
      "description": "Agent connected to MCP servers",
      "category": "integration",
      "complexity": "medium",
      "features": ["mcp", "tools"],
      "modules": ["llm/openai", "tools/custom"]
    },
    {
      "id": "production-agent",
      "name": "Production Agent",
      "description": "Full MPU stack with observability and resilience",
      "category": "production",
      "complexity": "high",
      "features": ["observability", "resilience", "audit", "security"],
      "modules": ["llm/openai", "observability/logger", "observability/tracer", "observability/metrics"]
    }
  ]
}
```

### 2.5 CLI 命令

```bash
# 列出可用模板
npx create-agentforge --list

# 使用模板创建
npx create-agentforge my-agent --template tool-agent

# 交互式选择模板
npx create-agentforge my-agent
? Select a template: (Use arrow keys)
❯ Chat Agent - Simple conversational agent with memory
  Tool Agent - Agent with custom tools and filesystem access
  RAG Agent - Retrieval-augmented generation with vector store
  Multi-Agent - Orchestrator + worker pattern with subagents
  MCP Agent - Agent connected to MCP servers
  Production Agent - Full MPU stack with observability and resilience
```

### 2.6 文件清单

| 文件 | 功能 |
|------|------|
| `packages/create-agentforge/templates/examples/chat-agent/` | Chat Agent 模板 |
| `packages/create-agentforge/templates/examples/tool-agent/` | Tool Agent 模板 |
| `packages/create-agentforge/templates/examples/rag-agent/` | RAG Agent 模板 |
| `packages/create-agentforge/templates/examples/multi-agent/` | Multi-Agent 模板 |
| `packages/create-agentforge/templates/examples/mcp-agent/` | MCP Agent 模板 |
| `packages/create-agentforge/templates/examples/production-agent/` | Production Agent 模板 |
| `packages/create-agentforge/templates/template.json` | 模板注册表 |

---

## 3. Dev Server

### 3.1 设计目标

提供应用开发服务器，支持热重载和实时调试。

### 3.2 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentForge Dev Server                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   HTTP API   │    │  SSE Bridge  │    │  WebSocket   │  │
│  │  (Sessions)  │    │  (Events)    │    │  (Hot Reload)│  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                Session Manager                       │   │
│  │  - InMemorySessionStore                             │   │
│  │  - AgentFactory                                     │   │
│  │  - EventStreamBridge                                │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                Config Watcher                        │   │
│  │  - chokidar file watcher                            │   │
│  │  - Hot reload on config change                      │   │
│  │  - Agent recreation                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 API 设计

```typescript
// packages/server/src/api.ts

// Session 管理
POST   /api/sessions              # 创建会话
GET    /api/sessions              # 列出会话
GET    /api/sessions/:id          # 获取会话详情
DELETE /api/sessions/:id          # 删除会话

# Chat 接口
POST   /api/sessions/:id/chat             # 发送消息 (同步)
POST   /api/sessions/:id/chat/stream      # 发送消息 (SSE 流式)

# Agent 管理
GET    /api/agents                # 列出可用 Agent
GET    /api/agents/:name          # 获取 Agent 配置

# 健康检查
GET    /api/health                # 健康检查
GET    /api/metrics               # 指标数据
```

### 3.4 SSE 事件格式

```typescript
// 事件流格式
data: {"type":"agent.start","timestamp":1234567890,"sessionId":"sess_123","agentName":"coder"}

data: {"type":"llm.stream.text","delta":"Hello"}

data: {"type":"llm.stream.text","delta":" world"}

data: {"type":"tool.call","toolName":"read_file","args":{"path":"config.json"}}

data: {"type":"tool.result","result":"..."}

data: {"type":"agent.complete","output":"Hello world!","steps":3}

data: [DONE]
```

### 3.5 服务器实现

```typescript
// packages/server/src/server.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAgent, type AgentEvent } from '@primo512109/agentforge';

export interface ServerConfig {
  port: number;
  host: string;
  configDir: string;
  cors?: boolean;
}

export function createAgentForgeServer(config: ServerConfig): Hono {
  const app = new Hono();
  const sessionManager = new SessionManager();
  const agentFactory = new AgentFactory(config.configDir);
  
  if (config.cors !== false) {
    app.use('*', cors());
  }
  
  // 会话管理
  app.post('/api/sessions', async (c) => {
    const body = await c.req.json();
    const session = sessionManager.create(body.title);
    return c.json(session);
  });
  
  app.get('/api/sessions', (c) => {
    return c.json(sessionManager.list());
  });
  
  app.get('/api/sessions/:id', (c) => {
    const session = sessionManager.get(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json(session);
  });
  
  app.delete('/api/sessions/:id', (c) => {
    sessionManager.delete(c.req.param('id'));
    return c.json({ success: true });
  });
  
  // Chat 接口 (SSE 流式)
  app.post('/api/sessions/:id/chat/stream', async (c) => {
    const sessionId = c.req.param('id');
    const { message } = await c.req.json();
    
    const session = sessionManager.get(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    
    const agent = agentFactory.getOrCreate(session.agentName);
    
    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          
          agent.run(message, {
            onToken: (delta: string) => {
              const data = `data: ${JSON.stringify({ type: 'llm.stream.text', delta })}\n\n`;
              controller.enqueue(encoder.encode(data));
            },
            onEvent: (event: AgentEvent) => {
              const data = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(data));
            },
            onComplete: (output: string) => {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            },
            onError: (error: Error) => {
              const data = `data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`;
              controller.enqueue(encoder.encode(data));
              controller.close();
            },
          });
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  });
  
  // Agent 管理
  app.get('/api/agents', (c) => {
    return c.json(agentFactory.list());
  });
  
  app.get('/api/agents/:name', (c) => {
    const agent = agentFactory.get(c.req.param('name'));
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404);
    }
    return c.json(agent);
  });
  
  // 健康检查
  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', version: '0.1.0' });
  });
  
  app.get('/api/metrics', (c) => {
    return c.json(sessionManager.getMetrics());
  });
  
  return app;
}
```

### 3.6 Session Manager 实现

```typescript
// packages/server/src/session-manager.ts

import { generateId } from '@primo512109/agentforge';

export interface Session {
  id: string;
  title: string;
  agentName: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  
  create(title: string, agentName: string = 'default'): Session {
    const session: Session = {
      id: generateId(),
      title,
      agentName,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }
  
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  
  list(): Session[] {
    return Array.from(this.sessions.values());
  }
  
  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
  
  addMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.updatedAt = Date.now();
    }
  }
  
  getMetrics() {
    return {
      totalSessions: this.sessions.size,
      totalMessages: Array.from(this.sessions.values()).reduce(
        (sum, s) => sum + s.messages.length, 0
      ),
    };
  }
}
```

### 3.7 Agent Factory 实现

```typescript
// packages/server/src/agent-factory.ts

import { createAgent, type Agent } from '@primo512109/agentforge';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

export class AgentFactory {
  private agents = new Map<string, Agent>();
  private configs = new Map<string, any>();
  
  constructor(private configDir: string) {
    this.loadConfigs();
  }
  
  private async loadConfigs(): Promise<void> {
    try {
      const files = await readdir(this.configDir);
      for (const file of files) {
        if (file.endsWith('.ts') || file.endsWith('.js')) {
          const configPath = join(this.configDir, file);
          const config = await import(configPath);
          const name = file.replace(/\.(ts|js)$/, '');
          this.configs.set(name, config.default);
        }
      }
    } catch {
      // Config directory doesn't exist or is empty
    }
  }
  
  getOrCreate(name: string): Agent {
    if (!this.agents.has(name)) {
      const config = this.configs.get(name);
      if (!config) {
        throw new Error(`Agent config "${name}" not found`);
      }
      const agent = createAgent(config);
      this.agents.set(name, agent);
    }
    return this.agents.get(name)!;
  }
  
  get(name: string): any {
    return this.configs.get(name);
  }
  
  list(): string[] {
    return Array.from(this.configs.keys());
  }
  
  reload(): void {
    this.agents.clear();
    this.configs.clear();
    this.loadConfigs();
  }
}
```

### 3.8 Config Watcher 实现

```typescript
// packages/server/src/config-watcher.ts

import { watch, type FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';

export class ConfigWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  
  constructor(private configDir: string) {
    super();
  }
  
  start(): void {
    this.watcher = watch(this.configDir, {
      ignoreInitial: true,
      ignored: /(^|[\/\\])\../, // ignore dotfiles
    });
    
    this.watcher.on('change', (path) => {
      this.emit('change', path);
    });
    
    this.watcher.on('add', (path) => {
      this.emit('add', path);
    });
    
    this.watcher.on('unlink', (path) => {
      this.emit('unlink', path);
    });
  }
  
  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
```

### 3.9 CLI 命令

```bash
# 启动开发服务器
npx agentforge dev

# 指定端口和配置目录
npx agentforge dev --port 3000 --config-dir ./agents

# 启用 HTTPS
npx agentforge dev --https

# 启用调试
npx agentforge dev --inspect
```

### 3.10 文件清单

| 文件 | 功能 |
|------|------|
| `packages/server/src/server.ts` | 服务器主文件 |
| `packages/server/src/api.ts` | API 路由 |
| `packages/server/src/session-manager.ts` | 会话管理 |
| `packages/server/src/agent-factory.ts` | Agent 工厂 |
| `packages/server/src/config-watcher.ts` | 配置监听 |
| `packages/server/package.json` | 包配置 |
| `packages/server/tsconfig.json` | TypeScript 配置 |

---

## 4. Studio UI (Vue SPA)

### 4.1 设计目标

提供可视化调试界面，支持事件流查看、Agent 状态监控。

### 4.2 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Studio UI (Vue SPA)                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Event Stream│    │  Agent State │    │  Observability│  │
│  │  Viewer      │    │  Monitor     │    │  Dashboard    │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                SSE Client                            │   │
│  │  - EventSource connection                           │   │
│  │  - Auto-reconnect                                   │   │
│  │  - Event buffering                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                Dev Server API                        │   │
│  │  - /api/sessions/:id/chat/stream (SSE)              │   │
│  │  - /api/health                                       │   │
│  │  - /api/metrics                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 页面设计

| 页面 | 功能 | 路由 |
|------|------|------|
| **Dashboard** | 总览、健康状态 | `/` |
| **Sessions** | 会话列表、创建 | `/sessions` |
| **Chat** | 聊天界面、事件流 | `/sessions/:id` |
| **Events** | 事件查看器 | `/events` |
| **Metrics** | 指标仪表盘 | `/metrics` |
| **Config** | 配置编辑器 | `/config` |

### 4.4 技术栈

| 技术 | 用途 |
|------|------|
| **Vue 3** | 前端框架 |
| **Vite** | 构建工具 |
| **Vue Router** | 路由 |
| **Pinia** | 状态管理 |
| **Tailwind CSS** | 样式 |
| **Chart.js** | 图表 |

### 4.5 组件设计

#### 4.5.1 SSE 组合函数

```typescript
// packages/studio/src/composables/useSSE.ts

import { ref, onUnmounted } from 'vue';

export interface SSEOptions {
  url: string;
  onMessage?: (data: any) => void;
  onError?: (error: Event) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export function useSSE(options: SSEOptions) {
  const connected = ref(false);
  const events = ref<any[]>([]);
  let eventSource: EventSource | null = null;
  let reconnectTimer: number | null = null;
  
  function connect() {
    eventSource = new EventSource(options.url);
    
    eventSource.onopen = () => {
      connected.value = true;
    };
    
    eventSource.onmessage = (e) => {
      if (e.data === '[DONE]') return;
      
      try {
        const data = JSON.parse(e.data);
        events.value.push(data);
        options.onMessage?.(data);
      } catch {
        // Ignore parse errors
      }
    };
    
    eventSource.onerror = (e) => {
      connected.value = false;
      options.onError?.(e);
      
      if (options.autoReconnect) {
        reconnectTimer = window.setTimeout(() => {
          connect();
        }, options.reconnectInterval || 3000);
      }
    };
  }
  
  function disconnect() {
    eventSource?.close();
    eventSource = null;
    connected.value = false;
    
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }
  
  function clearEvents() {
    events.value = [];
  }
  
  onUnmounted(() => {
    disconnect();
  });
  
  return {
    connected,
    events,
    connect,
    disconnect,
    clearEvents,
  };
}
```

#### 4.5.2 Session Store

```typescript
// packages/studio/src/stores/session.ts

import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface Session {
  id: string;
  title: string;
  agentName: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>([]);
  const currentSession = ref<Session | null>(null);
  const loading = ref(false);
  
  async function fetchSessions() {
    loading.value = true;
    try {
      const response = await fetch('/api/sessions');
      sessions.value = await response.json();
    } finally {
      loading.value = false;
    }
  }
  
  async function createSession(title: string, agentName: string = 'default') {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, agentName }),
    });
    const session = await response.json();
    sessions.value.push(session);
    return session;
  }
  
  async function fetchSession(id: string) {
    const response = await fetch(`/api/sessions/${id}`);
    currentSession.value = await response.json();
  }
  
  async function deleteSession(id: string) {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    sessions.value = sessions.value.filter(s => s.id !== id);
    if (currentSession.value?.id === id) {
      currentSession.value = null;
    }
  }
  
  return {
    sessions,
    currentSession,
    loading,
    fetchSessions,
    createSession,
    fetchSession,
    deleteSession,
  };
});
```

#### 4.5.3 Chat View

```vue
<!-- packages/studio/src/views/ChatView.vue -->

<template>
  <div class="chat-view">
    <div class="sidebar">
      <h3>Events</h3>
      <div class="event-list">
        <div
          v-for="event in events"
          :key="event.timestamp"
          :class="['event', event.type]"
        >
          <span class="event-type">{{ event.type }}</span>
          <span class="event-time">{{ formatTime(event.timestamp) }}</span>
        </div>
      </div>
    </div>
    
    <div class="main">
      <div class="messages" ref="messagesRef">
        <div
          v-for="msg in messages"
          :key="msg.id"
          :class="['message', msg.role]"
        >
          <div class="message-content">{{ msg.content }}</div>
        </div>
      </div>
      
      <form class="input-form" @submit.prevent="send">
        <input
          v-model="input"
          placeholder="Type a message..."
          :disabled="streaming"
        />
        <button type="submit" :disabled="streaming || !input.trim()">
          Send
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useSSE } from '../composables/useSSE';
import { useSessionStore } from '../stores/session';

const route = useRoute();
const sessionStore = useSessionStore();
const sessionId = route.params.id as string;

const input = ref('');
const streaming = ref(false);
const messagesRef = ref<HTMLElement | null>(null);

const { events, connect, disconnect } = useSSE({
  url: `/api/sessions/${sessionId}/chat/stream`,
  autoReconnect: true,
});

onMounted(async () => {
  await sessionStore.fetchSession(sessionId);
});

const messages = computed(() => sessionStore.currentSession?.messages || []);

watch(messages, async () => {
  await nextTick();
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}, { deep: true });

async function send() {
  if (!input.value.trim() || streaming.value) return;
  
  const message = input.value;
  input.value = '';
  streaming.value = true;
  
  // Add user message
  sessionStore.currentSession?.messages.push({
    role: 'user',
    content: message,
    timestamp: Date.now(),
  });
  
  // Start SSE connection
  connect();
  
  // Send message via POST
  await fetch(`/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  
  // Wait for completion
  // ... handle SSE events to update messages
  
  streaming.value = false;
  disconnect();
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}
</script>

<style scoped>
.chat-view {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 300px;
  border-right: 1px solid #e5e7eb;
  overflow-y: auto;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.message {
  margin-bottom: 1rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
}

.message.user {
  background: #3b82f6;
  color: white;
  margin-left: 2rem;
}

.message.assistant {
  background: #f3f4f6;
  margin-right: 2rem;
}

.input-form {
  display: flex;
  padding: 1rem;
  border-top: 1px solid #e5e7eb;
}

.input-form input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.25rem;
}

.input-form button {
  margin-left: 0.5rem;
  padding: 0.5rem 1rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
}

.event {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  border-bottom: 1px solid #f3f4f6;
}

.event-type {
  font-weight: bold;
  margin-right: 0.5rem;
}

.event-time {
  color: #6b7280;
}
</style>
```

### 4.6 文件清单

| 文件 | 功能 |
|------|------|
| `packages/studio/src/App.vue` | 根组件 |
| `packages/studio/src/views/DashboardView.vue` | Dashboard 页面 |
| `packages/studio/src/views/ChatView.vue` | Chat 页面 |
| `packages/studio/src/views/EventsView.vue` | Events 页面 |
| `packages/studio/src/views/MetricsView.vue` | Metrics 页面 |
| `packages/studio/src/views/ConfigView.vue` | Config 页面 |
| `packages/studio/src/composables/useSSE.ts` | SSE 组合函数 |
| `packages/studio/src/stores/session.ts` | Session 状态 |
| `packages/studio/src/stores/event.ts` | Event 状态 |
| `packages/studio/src/router/index.ts` | 路由配置 |
| `packages/studio/package.json` | 包配置 |
| `packages/studio/vite.config.ts` | Vite 配置 |
| `packages/studio/tailwind.config.js` | Tailwind 配置 |
| `packages/studio/index.html` | 入口 HTML |

---

## 5. 可观测性增强

### 5.1 设计目标

增强现有可观测性模块，支持 OpenTelemetry 集成。

### 5.2 OTel Tracer 实现

```typescript
// src/observability/otel-tracer.ts

import { trace, SpanStatusCode, type Span, type Tracer as OtelTracer } from '@opentelemetry/api';
import type { Tracer, SpanOptions } from '../core/interfaces.js';

/**
 * OpenTelemetry Tracer 实现
 */
export class OtelTracerImpl implements Tracer {
  private otelTracer: OtelTracer;
  private spans = new Map<string, Span>();
  
  constructor(name: string = 'agentforge') {
    this.otelTracer = trace.getTracer(name);
  }
  
  startSpan(name: string, options?: SpanOptions): string {
    const span = this.otelTracer.startSpan(name, {
      attributes: options?.attributes,
    });
    
    const spanId = generateSpanId();
    this.spans.set(spanId, span);
    
    return spanId;
  }
  
  endSpan(spanId: string, options?: { code?: string }): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    
    if (options?.code === 'error') {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    
    span.end();
    this.spans.delete(spanId);
  }
  
  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    
    span.addEvent(name, attributes as any);
  }
  
  recordException(spanId: string, error: Error): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  }
}
```

### 5.3 Prometheus Metrics 实现

```typescript
// src/observability/prometheus-metrics.ts

import type { Metrics } from '../core/interfaces.js';

/**
 * Prometheus Metrics 实现
 */
export class PrometheusMetricsCollector implements Metrics {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  
  increment(name: string, value: number = 1, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }
  
  histogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
  }
  
  /**
   * 导出 Prometheus 格式指标
   */
  export(): string {
    let output = '';
    
    for (const [key, value] of this.counters) {
      output += `# TYPE ${key} counter\n`;
      output += `${key} ${value}\n`;
    }
    
    for (const [key, values] of this.histograms) {
      const sorted = values.sort((a, b) => a - b);
      output += `# TYPE ${key} histogram\n`;
      output += `${key}_count ${values.length}\n`;
      output += `${key}_sum ${values.reduce((a, b) => a + b, 0)}\n`;
      output += `${key}_bucket{le="0.1"} ${sorted.filter(v => v <= 0.1).length}\n`;
      output += `${key}_bucket{le="0.5"} ${sorted.filter(v => v <= 0.5).length}\n`;
      output += `${key}_bucket{le="1"} ${sorted.filter(v => v <= 1).length}\n`;
      output += `${key}_bucket{le="5"} ${sorted.filter(v => v <= 5).length}\n`;
      output += `${key}_bucket{le="+Inf"} ${values.length}\n`;
    }
    
    return output;
  }
  
  private buildKey(name: string, tags?: Record<string, string>): string {
    if (!tags) return name;
    const tagStr = Object.entries(tags).map(([k, v]) => `${k}="${v}"`).join(',');
    return `${name}{${tagStr}}`;
  }
}
```

### 5.4 Agent 事件追踪器

```typescript
// src/observability/agent-tracer.ts

import type { AgentEvent } from '../core/events.js';
import type { Tracer } from '../core/interfaces.js';

/**
 * Agent 事件追踪器
 * 
 * 将 Agent 事件转换为 OTel spans
 * 使用 LifecycleHook + eventSubscriptions 替代旧的 RxJS 操作符
 */
export function createAgentTracer(tracer: Tracer) {
  return {
    hooks: {
      onEvent(event: AgentEvent): void {
        switch (event.type) {
          case 'agent.start':
            tracer.startSpan('agent.run', {
              attributes: {
                'agent.name': event.agentName,
                'agent.model': event.model.model,
              },
            });
            break;
            
          case 'agent.step':
            tracer.startSpan('agent.step', {
              attributes: {
                'step.number': event.step,
                'step.max': event.maxSteps,
              },
            });
            break;
            
          case 'llm.request':
            tracer.addEvent('llm.request', {
              'messages.count': event.messages.length,
            });
            break;
            
          case 'llm.response':
            tracer.addEvent('llm.response', {
              'finish.reason': event.finishReason,
              'usage.prompt': event.usage?.promptTokens,
              'usage.completion': event.usage?.completionTokens,
            });
            break;
            
          case 'tool.call':
            tracer.addEvent('tool.call', {
              'tool.name': event.toolName,
            });
            break;
            
          case 'tool.result':
            tracer.addEvent('tool.result', {
              'tool.name': event.toolName,
              'tool.isError': event.isError,
            });
            break;
            
          case 'agent.complete':
            tracer.endSpan();
            break;
            
          case 'agent.error':
            tracer.recordException(new Error(event.error.message));
            tracer.endSpan();
            break;
        }
      },
    },
  };
}
```

### 5.5 使用示例

```typescript
import { createAgent } from 'agentforge';
import { OtelTracerImpl, createAgentTracer } from 'agentforge/observability';

// 创建 OTel Tracer
const tracer = new OtelTracerImpl('my-agent');

// 创建 Agent
const agent = createAgent({
  name: 'my-agent',
  model: { provider: 'openai', model: 'gpt-4o' },
  tracing: {
    tracer,
    enabled: true,
  },
});

// 运行 Agent
const result = await agent.run('Hello');
// Events are traced via lifecyle hooks configured in the agent config
```

### 5.6 文件清单

| 文件 | 功能 |
|------|------|
| `src/observability/otel-tracer.ts` | OTel Tracer 实现 |
| `src/observability/prometheus-metrics.ts` | Prometheus Metrics 实现 |
| `src/observability/agent-tracer.ts` | Agent 事件追踪器 |
| `tests/observability/otel-tracer.spec.ts` | 测试文件 |
| `tests/observability/prometheus-metrics.spec.ts` | 测试文件 |

---

## 6. 实施路线图

### Phase 1: 模板扩充 (3 天)

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 1 | chat-agent, tool-agent 模板 | 2 个模板目录 |
| Day 2 | rag-agent, multi-agent 模板 | 2 个模板目录 |
| Day 3 | mcp-agent, production-agent 模板 | 2 个模板目录 |

### Phase 2: Dev Server (5 天)

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 4-5 | Session Manager + API | `packages/server/src/` |
| Day 6-7 | SSE Bridge + Agent Factory | 更新 `packages/server/src/` |
| Day 8 | CLI 集成 + 测试 | 更新 `src/cli/` |

### Phase 3: Studio UI (10 天)

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 9-10 | Vue 项目初始化 + 路由 | `packages/studio/` |
| Day 11-12 | SSE Client + Event Stream | `packages/studio/src/composables/` |
| Day 13-14 | Chat View + Messages | `packages/studio/src/views/` |
| Day 15-16 | Dashboard + Metrics | `packages/studio/src/views/` |
| Day 17-18 | Config Editor + 集成 | `packages/studio/src/views/` |

### Phase 4: 可观测性增强 (3 天)

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 19 | OTel Tracer | `src/observability/otel-tracer.ts` |
| Day 20 | Prometheus Metrics | `src/observability/prometheus-metrics.ts` |
| Day 21 | Agent Tracer | `src/observability/agent-tracer.ts` |

**总计**: 21 天

---

## 7. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| Studio UI 范围蔓延 | 高 | 严格 Phase 分割，先实现核心功能 |
| Dev Server 性能 | 中 | 使用 Hono 框架，轻量级实现 |
| OTel 兼容性 | 中 | 使用标准 OTel API，避免定制化 |
| Vue 学习成本 | 低 | 使用 Composition API，现代化写法 |

---

## 8. 测试策略

### 8.1 单元测试

```typescript
// tests/server/session-manager.spec.ts
describe('SessionManager', () => {
  it('should create session', () => {
    // ...
  });
  
  it('should list sessions', () => {
    // ...
  });
});
```

### 8.2 集成测试

```typescript
// tests/server/api.spec.ts
describe('Server API', () => {
  it('should create and retrieve session', async () => {
    // ...
  });
  
  it('should stream SSE events', async () => {
    // ...
  });
});
```

### 8.3 E2E 测试

```typescript
// tests/e2e/studio.spec.ts
describe('Studio UI', () => {
  it('should load dashboard', async () => {
    // ...
  });
  
  it('should send message and receive response', async () => {
    // ...
  });
});
```
