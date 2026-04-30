# AgentForge LLM I/O 改进详细设计

> 基于 5 框架（AgentScope / DeepAgents / Mastra / OpenCode / OpenHarness）对比分析
> + 业界最佳实践研究，针对 AgentForge 现有架构的增量改进方案。
>
> **核心原则**：不引入新范式，复用 AgentForge 已有的 InterceptorPlugin 系统。
>
> **修订记录**：
> - v1.0 初始设计（引入 Middleware 概念）
> - v1.1 增加 Promise ↔ Observable 适配层
> - v1.2 移除 Promise，改为 Observable-native transformRequest
> - v1.3 修复 warmup()/run() race condition
> - **v2.0 回归 AgentForge 原始架构**：删除 Middleware，改用已有的 InterceptorPlugin 实现 Memory/Skills/Summarization 注入。零新增概念。demo 测试 10/10 通过。

---

## 目录

1. [设计总览](#1-设计总览)
2. [模块一：持久化 Memory（AGENTS.md）](#2-模块一持久化-memoryagentsmd)
3. [模块二：历史 Offload](#3-模块二历史-offload)
4. [模块三：Plugin-based 上下文注入](#4-模块三plugin-based-上下文注入)
5. [模块四：Skills 渐进式披露](#5-模块四skills-渐进式披露)
6. [模块五：Provider 注册表](#6-模块五provider-注册表)
7. [模块间协作时序](#7-模块间协作时序)
8. [与现有代码的集成点](#8-与现有代码的集成点)
9. [测试策略](#9-测试策略)
10. [迁移路径](#10-迁移路径)
11. [附录 A：与 5 框架的设计映射](#附录-a与-5-框架的设计映射)
12. [附录 B：关键设计决策](#附录-b关键设计决策)

---

## 1. 设计总览

### 1.1 设计目标

| 目标 | 说明 |
|---|---|
| **持久化记忆** | 跨会话的长期记忆，基于 AGENTS.md 文件 |
| **历史可追溯** | 压缩时不丢弃旧消息，offload 到文件 |
| **上下文可组合** | InterceptorPlugin 拦截事件，在 LLM 调用前注入上下文 |
| **Skill 省 token** | 渐进式披露：只注入元数据，按需加载 |
| **Provider 可扩展** | 内置注册表 + 动态加载，支持运行时切换 |

### 1.2 架构原则

1. **增量改进**：不破坏现有 API，复用已有 InterceptorPlugin 系统
2. **事件驱动**：所有注入通过拦截 `agent.start` / `llm.request` 事件实现
3. **零新增概念**：不引入 Middleware，用已有 Plugin 系统
4. **文件即记忆**：参考 DeepAgents/OpenHarness，用 Markdown 文件作为记忆载体

### 1.3 模块关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Loop                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Plugin Pipeline (已有)                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │   │
│  │  │ Skills   │ │ Memory   │ │ Summarize│                 │   │
│  │  │ Plugin   │ │ Plugin   │ │ Plugin   │                 │   │
│  │  │ p=5      │ │ p=10     │ │ p=20     │                 │   │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘                 │   │
│  │       │             │            │                        │   │
│  │       │  intercept('agent.start') → 加载数据             │   │
│  │       │  intercept('llm.request') → prepend messages     │   │
│  │       ▼             ▼            ▼                        │   │
│  │  ┌──────────────────────────────────────────────────┐    │   │
│  │  │     AgentEvent (llm.request + injected messages)  │    │   │
│  │  │  messages: [...injected, ...history, user_input]  │    │   │
│  │  └──────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    LLMAdapter                             │   │
│  │  formatTools() + normalizeMessages() + formatToolChoice() │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**关键设计**：Plugin 拦截 `llm.request` 事件，修改 `event.messages`（prepend 注入内容）。
Agent Loop 完全无感——`callLLM()`、`handleLLMRequest()` 无需修改。

---

## 2. 模块一：持久化 Memory（AGENTS.md）

### 2.1 设计目标

- 跨会话持久化记忆，基于 `AGENTS.md` 文件
- 模型通过 `edit_file` 工具主动更新记忆
- 记忆内容注入 system prompt
- 包含 memory guidelines 教模型何时/如何写记忆

### 2.2 类型定义

```typescript
// src/memory/types.ts

/** 记忆条目 */
export interface MemoryEntry {
  id: string;
  content: string;
  sourcePath: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

export interface MemoryLoadResult {
  success: boolean;
  entries: MemoryEntry[];
  error?: string;
}

export interface MemoryConfig {
  sources: string[];
  enabled: boolean;
  searchLimit?: number;
  encoding?: string;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  sources: [],
  enabled: false,
  searchLimit: 5,
  encoding: 'utf-8',
};
```

### 2.3 PersistentMemory 接口

```typescript
// src/memory/persistent.ts

export interface PersistentMemory {
  load(sources: string[]): Promise<MemoryLoadResult>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  save(entry: MemoryEntry): Promise<boolean>;
  update(id: string, content: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  formatForPrompt(entries: MemoryEntry[]): string;
  /** Phase 3：向量搜索（预留） */
  vectorSearch?(query: string, limit?: number): Promise<MemoryEntry[]>;
}
```

### 2.4 FileBasedMemory 实现

```typescript
// src/memory/file-memory.ts

export class FileBasedMemory implements PersistentMemory {
  private config: MemoryConfig;
  private cache: Map<string, MemoryEntry[]> = new Map();

  async load(sources: string[]): Promise<MemoryLoadResult> {
    const entries: MemoryEntry[] = [];
    const errors: string[] = [];

    for (const source of sources) {
      try {
        const content = await readFile(source, this.config.encoding);
        entries.push({
          id: this.generateId(source),
          content: content.toString(),
          sourcePath: resolve(source),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        this.cache.set(source, entries.slice(-1));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          errors.push(`Failed to load ${source}: ${(error as Error).message}`);
        }
        // ENOENT = 文件不存在，跳过（不报错）
      }
    }

    return { success: errors.length === 0, entries, error: errors.join('; ') || undefined };
  }

  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const allEntries = Array.from(this.cache.values()).flat();
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    return allEntries
      .map(entry => ({
        entry,
        score: queryTerms.filter(t => entry.content.toLowerCase().includes(t)).length,
      }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entry);
  }

  async save(entry: MemoryEntry): Promise<boolean> {
    try {
      await mkdir(dirname(entry.sourcePath), { recursive: true });
      let existing = '';
      try { existing = await readFile(entry.sourcePath, 'utf-8'); } catch {}

      const timestamp = new Date().toISOString();
      await writeFile(entry.sourcePath, existing + `\n\n## ${timestamp}\n\n${entry.content}\n`, 'utf-8');
      return true;
    } catch { return false; }
  }

  formatForPrompt(entries: MemoryEntry[]): string {
    if (entries.length === 0) {
      return MEMORY_SYSTEM_PROMPT.replace('{agent_memory}', '(No memory loaded)');
    }
    const sections = entries.map(e => `### ${e.sourcePath}\n\n${e.content}`);
    return MEMORY_SYSTEM_PROMPT.replace('{agent_memory}', sections.join('\n\n'));
  }
}
```

### 2.5 Memory Guidelines

```typescript
// src/memory/guidelines.ts

export const MEMORY_SYSTEM_PROMPT = `<agent_memory>
{agent_memory}
</agent_memory>

<memory_guidelines>
The above <agent_memory> was loaded from files. As you learn, save new knowledge by calling \`edit_file\`.

**When to update memories:**
- User explicitly asks you to remember something
- User gives feedback on your work
- You discover new patterns or preferences

**When to NOT update memories:**
- Temporary or transient information
- One-time task requests
- Never store API keys, passwords, or credentials
</memory_guidelines>`;
```

### 2.6 Memory 注入（via InterceptorPlugin）

> **注意**：Memory 注入使用 AgentForge 已有的 `InterceptorPlugin` 接口实现。
> 具体实现见 §4.3 MemoryPlugin。

工作流程：
1. `agent.start` 事件时：加载 AGENTS.md 文件 → 缓存 entries
2. `llm.request` 事件时：将记忆内容 prepend 到 messages 前面

---

## 3. 模块二：历史 Offload

### 3.1 设计目标

- 压缩时不丢弃旧消息，offload 到持久存储
- 每次压缩追加一个带时间戳的 section 到文件
- 支持回溯查看历史

### 3.2 HistoryOffloadManager

```typescript
// src/memory/history-offload.ts

export interface OffloadConfig {
  enabled: boolean;
  historyDir: string;
  filenameTemplate: string;  // 支持 {sessionId} 占位符
}

export const DEFAULT_OFFLOAD_CONFIG: OffloadConfig = {
  enabled: true,
  historyDir: '/conversation_history',
  filenameTemplate: '{sessionId}.md',
};

export class HistoryOffloadManager {
  private config: OffloadConfig;

  async offload(sessionId: string, messages: Message[]): Promise<string | null> {
    if (!this.config.enabled || messages.length === 0) return null;

    const filePath = join(this.config.historyDir,
      this.config.filenameTemplate.replace('{sessionId}', sessionId));

    try {
      await mkdir(dirname(filePath), { recursive: true });
      const timestamp = new Date().toISOString();
      const formatted = messages
        .filter(m => m.role !== 'system')
        .map(m => `[${m.role}]: ${m.content}`)
        .join('\n\n');

      let existing = '';
      try { existing = await readFile(filePath, 'utf-8'); } catch {}

      await writeFile(filePath, existing + `## Summarized at ${timestamp}\n\n${formatted}\n\n`, 'utf-8');
      return filePath;
    } catch { return null; }
  }

  async load(sessionId: string): Promise<string | null> {
    try {
      return await readFile(
        join(this.config.historyDir, this.config.filenameTemplate.replace('{sessionId}', sessionId)),
        'utf-8'
      );
    } catch { return null; }
  }
}
```

---

## 4. 模块三：Plugin-based 上下文注入

### 4.1 为什么不用 Middleware

AgentForge 已有完整的插件系统（`InterceptorPlugin` + `buildPluginPipeline`），
可以实现 Memory、Skills、Summarization 注入，**无需引入 Middleware 概念**。

```
DeepAgents Middleware（外来范式）          AgentForge Plugin（已有范式）
─────────────────────────────            ───────────────────────────
AgentMiddleware 接口                      InterceptorPlugin 接口（已有）
ModelRequest 类型                         AgentEvent 类型（已有）
composeRequestTransformers()             buildPluginPipeline()（已有）
新增 ~500 行代码                           **零新增概念**
```

**功能等价性验证**（demo 测试已通过，10/10）：

| 需求 | InterceptorPlugin 实现 |
|---|---|
| 注入 Memory 到 system_message | 拦截 `llm.request`，prepend memory message |
| 加载 Skills | 拦截 `agent.start`，扫描 SKILL.md |
| Skills 渐进式披露 | 只注入 `name + description`，不注入完整内容 |
| 压缩 messages | 拦截 `llm.request`，检查阈值，压缩 |
| 响应后副作用 | 使用 `ObserverPlugin`（已有） |

### 4.2 插件优先级与消息顺序

Pipeline 按 priority 升序执行插件。每个插件 prepend 自己的 message 到数组前面。

**关键洞察**：后执行的插件 prepend 在最前面。

```
插件注册顺序：[SkillsPlugin(priority=5), MemoryPlugin(priority=10)]

执行流程：
  初始 messages: [user_msg]
  SkillsPlugin (priority=5, 先执行): → [skills_msg, user_msg]
  MemoryPlugin (priority=10, 后执行): → [memory_msg, skills_msg, user_msg]

最终 messages 发送给 LLM：
  [0] memory_msg   ← 后执行，prepend 在最前
  [1] skills_msg   ← 先执行
  [2] user_msg     ← 原始消息
```

**推荐优先级**：

| 插件 | Priority | 说明 |
|---|---|---|
| SkillsPlugin | 5 | 先注入技能列表 |
| MemoryPlugin | 10 | 后注入记忆内容（在 skills 之前，因为 prepend） |
| SummarizationPlugin | 20 | 最后处理压缩 |

### 4.3 MemoryPlugin 实现

```typescript
// src/plugins/memory-plugin.ts

export function createMemoryPlugin(
  memory: PersistentMemory,
  config: MemoryConfig
): InterceptorPlugin {
  let entries: MemoryEntry[] = [];
  let loaded = false;

  return {
    name: 'memory',
    type: 'interceptor',
    priority: 10,
    eventTypes: ['agent.start', 'llm.request'],
    enabled: config.enabled,

    intercept(event: AgentEvent, _ctx: PluginContext): Observable<AgentEvent> {
      if (event.type === 'agent.start' && !loaded) {
        return from(memory.load(config.sources)).pipe(
          map(result => {
            entries = result.entries;
            loaded = true;
            return event;
          })
        );
      }

      if (event.type === 'llm.request' && loaded && entries.length > 0) {
        const memoryText = memory.formatForPrompt(entries);
        const memoryMessage: Message = {
          role: 'system',
          content: memoryText,
          name: 'memory',
        };
        return of({ ...event, messages: [memoryMessage, ...event.messages] });
      }

      return of(event);
    },
  };
}
```

### 4.4 SkillsPlugin 实现

```typescript
// src/plugins/skills-plugin.ts

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  uri?: string;
  license?: string | null;
  compatibility?: string | null;
  allowedTools?: string[];
}

export function createSkillsPlugin(sources: string[]): InterceptorPlugin {
  const registry = new SkillRegistry();
  let skills: SkillMetadata[] = [];

  return {
    name: 'skills',
    type: 'interceptor',
    priority: 5,
    eventTypes: ['agent.start', 'llm.request'],
    enabled: true,

    intercept(event: AgentEvent, _ctx: PluginContext): Observable<AgentEvent> {
      if (event.type === 'agent.start') {
        return from(registry.discover(sources)).pipe(
          map(discovered => {
            skills = discovered.map(s => ({
              name: s.frontmatter.name,
              description: s.frontmatter.description,
              path: s.location,
              uri: s.frontmatter.uri,
              license: s.frontmatter.license,
              compatibility: s.frontmatter.compatibility,
              allowedTools: s.frontmatter.allowedTools,
            }));
            return event;
          })
        );
      }

      if (event.type === 'llm.request' && skills.length > 0) {
        const skillsList = skills.map(s => {
          let line = `- **${s.name}**: ${s.description}`;
          if (s.license || s.compatibility) {
            const ann = [s.license && `License: ${s.license}`, s.compatibility && `Compatibility: ${s.compatibility}`]
              .filter(Boolean).join(', ');
            line += ` (${ann})`;
          }
          line += `\n  -> Read \`${s.path}\` for full instructions`;
          return line;
        }).join('\n');

        const skillsMessage: Message = {
          role: 'system',
          content: `## Skills System\n\n**Available Skills:**\n\n${skillsList}`,
          name: 'skills',
        };
        return of({ ...event, messages: [skillsMessage, ...event.messages] });
      }

      return of(event);
    },
  };
}
```

### 4.5 SummarizationPlugin 实现

```typescript
// src/plugins/summarization-plugin.ts

export function createSummarizationPlugin(config: {
  triggerThreshold: number;  // 0.8 = 80% context window
  maxTokens: number;
  preserveRecent: number;
  offloadDir?: string;
}): InterceptorPlugin {
  const offloadManager = config.offloadDir
    ? new HistoryOffloadManager({ historyDir: config.offloadDir })
    : null;

  return {
    name: 'summarization',
    type: 'interceptor',
    priority: 20,
    eventTypes: ['llm.request'],
    enabled: true,

    intercept(event: AgentEvent, _ctx: PluginContext): Observable<AgentEvent> {
      if (event.type !== 'llm.request') return of(event);

      const tokens = estimateTokens(event.messages);
      const threshold = config.triggerThreshold * config.maxTokens;
      if (tokens < threshold) return of(event);

      const result = truncateOldest(event.messages, config.preserveRecent);

      // offload 被移除的消息（关键：不能丢弃）
      if (offloadManager && result.removedCount > 0) {
        const removed = event.messages.slice(0, result.removedCount);
        // 注意：offload 是异步的，这里用 defer 包装
        return defer(async () => {
          await offloadManager.offload(event.sessionId, removed);
          return { ...event, messages: result.messages };
        });
      }

      return of({ ...event, messages: result.messages });
    },
  };
}
```

### 4.6 插件组装

```typescript
// 复用已有 PluginManager，零新增代码

const manager = createPluginManager();
manager.register(createMemoryPlugin(fileMemory, { enabled: true, sources: ['~/.agentforge/AGENTS.md'] }));
manager.register(createSkillsPlugin(['/skills/user/', '/skills/project/']));

// Plugin Pipeline 自动拦截 llm.request 事件
const pipeline = manager.buildPipeline(source$, pluginContext);
```

---

## 5. 模块四：Skills 渐进式披露

### 5.1 设计目标

- 只将技能元数据（name + description）注入 system prompt
- 模型按需读取完整 SKILL.md
- 节省 token，避免加载不相关内容

### 5.2 SkillsPlugin 实现

> **注意**：Skills 注入使用 AgentForge 已有的 `InterceptorPlugin` 接口实现。
> 具体实现见 §4.4 SkillsPlugin。

工作流程：
1. `agent.start` 时：扫描技能目录，解析 SKILL.md frontmatter → 缓存 skills 列表
2. `llm.request` 时：将技能列表（name + description + path）prepend 到 messages 前面
3. 模型看到列表后，按需用 `read_file` 读取完整 SKILL.md

---

## 6. 模块五：Provider 注册表

### 6.1 设计目标

- 内置常用 Provider 的工厂映射
- 支持 `provider/model` 格式解析
- 支持动态加载（lazy import）

### 6.2 ProviderRegistry

```typescript
// src/adapters/registry.ts

export type ProviderFactory = (model: string, options?: ProviderOptions) => LLMAdapter;

export const BUILTIN_PROVIDERS: Record<string, () => Promise<ProviderFactory>> = {
  'openai': () => import('./openai.js').then(m => m.createOpenAIAdapter),
  'anthropic': () => import('./anthropic.js').then(m => m.createAnthropicAdapter),
  'ollama': () => import('./ollama.js').then(m => m.createOllamaAdapter),
};

export class ProviderRegistry implements LLMAdapterFactory {
  private providers: Map<string, ProviderFactory> = new Map();
  private loading: Map<string, Promise<ProviderFactory>> = new Map();

  async create(spec: string, options?: ProviderOptions): Promise<LLMAdapter> {
    const [provider, model] = this.parseSpec(spec);
    const factory = await this.getFactory(provider);
    return factory(model, options);
  }

  register(name: string, factory: ProviderFactory): void {
    this.providers.set(name, factory);
  }

  listProviders(): string[] {
    return [...new Set([...this.providers.keys(), ...this.loading.keys()])];
  }

  private parseSpec(spec: string): [provider: string, model: string] {
    const slashIdx = spec.indexOf('/');
    if (slashIdx > 0) return [spec.slice(0, slashIdx), spec.slice(slashIdx + 1)];
    return [this.detectProvider(spec), spec];
  }

  private detectProvider(model: string): string {
    if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('llama') || model.startsWith('mistral')) return 'ollama';
    return 'openai';
  }

  private async getFactory(name: string): Promise<ProviderFactory> {
    const registered = this.providers.get(name);
    if (registered) return registered;

    const loading = this.loading.get(name);
    if (loading) {
      const factory = await loading;
      this.providers.set(name, factory);
      this.loading.delete(name);
      return factory;
    }
    throw new Error(`Unknown provider: ${name}. Available: ${this.listProviders().join(', ')}`);
  }
}
```

---

## 7. 模块间协作时序

### 7.1 完整 LLM 调用时序（Plugin-based）

```
用户输入 "帮我写个排序算法"
    │
    ▼
AgentLoop.run(input)
    │
    ├── 1. agent.start 事件
    │   └── Plugin Pipeline 拦截
    │       ├── SkillsPlugin.intercept(agent.start) → 扫描 SKILL.md → 缓存 skills
    │       └── MemoryPlugin.intercept(agent.start) → 加载 AGENTS.md → 缓存 entries
    │
    ├── 2. 构建初始 state
    │   └── messages = [system_prompt, ...history, user_input]
    │
    └── 3. step() 循环
         │
         ├── llm.request 事件
         │   └── Plugin Pipeline 拦截（buildPluginPipeline 已有的机制）
         │       ├── SkillsPlugin.intercept(llm.request)  [priority=5]
         │       │   └── prepend 技能列表 → messages = [skills_msg, ...原始]
         │       ├── MemoryPlugin.intercept(llm.request)  [priority=10]
         │       │   └── prepend 记忆内容 → messages = [memory_msg, skills_msg, ...]
         │       └── llm.request 事件（已注入） → handleLLMRequest()
         │           └── LLMAdapter.chat(messages, tools)
         │
         ├── llm.response 事件 → 解析 content + toolCalls
         ├── tool.execute 事件 → 执行工具
         └── done 事件 → 结束循环

关键：Plugin 拦截 llm.request，修改 event.messages。
      Agent Loop 的 callLLM()、handleLLMRequest() 完全无感。
```

### 7.2 System Prompt 最终结构

```
┌─────────────────────────────────────────────────┐
│ System Message (最终发送给 LLM)                   │
├─────────────────────────────────────────────────┤
│ [Base System Prompt]                            │
│                                                 │
│ [Skills Section]                                │
│ "## Skills System                               │
│  - **web-research**: Research skill...          │
│    -> Read /skills/web/SKILL.md"                │
│                                                 │
│ [Memory Section]                                │
│ "<agent_memory>                                 │
│  ### ~/.agentforge/AGENTS.md                    │
│  User prefers TypeScript...                     │
│  </agent_memory>"                               │
│                                                 │
│ [Summarization] (如触发压缩)                      │
│ "Conversation history saved to /path...         │
│  <summary>...</summary>"                        │
└─────────────────────────────────────────────────┘
```

---

## 8. 与现有代码的集成点

### 8.1 需要修改的文件

| 文件 | 修改内容 | 影响范围 |
|---|---|---|
| `src/memory/index.ts` | 导出新模块 | 扩展 |
| `src/plugins/index.ts` | 导出 MemoryPlugin、SkillsPlugin | 扩展 |
| `src/adapters/index.ts` | 导出 ProviderRegistry | 扩展 |

**关键**：Plugin 方案**不需要修改**以下文件：
- `src/loop/agent-loop.ts` — Agent Loop 无需修改
- `src/loop/handlers/llm.ts` — `callLLM()` 无需修改
- `src/core/interfaces.ts` — 无需增加 Middleware 接口

### 8.2 新增文件

| 文件 | 职责 |
|---|---|
| `src/memory/types.ts` | MemoryEntry、MemoryConfig 类型定义 |
| `src/memory/persistent.ts` | PersistentMemory 接口 |
| `src/memory/file-memory.ts` | FileBasedMemory 实现 |
| `src/memory/guidelines.ts` | Memory Guidelines 文本 |
| `src/memory/offload.ts` | OffloadConfig 类型 |
| `src/memory/history-offload.ts` | HistoryOffloadManager |
| `src/plugins/memory-plugin.ts` | MemoryPlugin（InterceptorPlugin） |
| `src/plugins/skills-plugin.ts` | SkillsPlugin（InterceptorPlugin） |
| `src/adapters/registry.ts` | ProviderRegistry |

### 8.3 集成方式

```typescript
// src/api/create-agent.ts（修改）

export function createAgent(config: AgentConfig): Agent {
  const ctx = buildContext(config);
  const manager = createPluginManager();

  if (config.memory?.enabled) {
    manager.register(createMemoryPlugin(new FileBasedMemory(config.memory), config.memory));
  }
  if (config.skills?.enabled) {
    manager.register(createSkillsPlugin(config.skills.sources));
  }

  // Plugin Pipeline 自动拦截 llm.request 事件
  // Agent Loop 完全无感
  const loop = createAgentLoop(ctx, { ...config, pluginManager: manager });

  return { run: (input) => loop.run(input), destroy: () => loop.destroy() };
}
```

#### 8.3.1 首次 LLM 调用可能看不到 Memory

`agent.start` 事件触发加载是异步的。如果第一次 `llm.request` 在 IO 完成前到达，记忆不会注入。

**行为**：首次 LLM 调用可能看不到 Memory，后续调用自动生效。
**缓解**：接受（延迟 ~100ms）或预热（在 createAgent 中提前触发加载）。

---

## 9. 测试策略

> **Plugin 方案的 demo 已通过**：`tests/plugins/memory-plugin.spec.ts`（10/10）。

### 9.1 单元测试

| 模块 | 测试文件 | 测试数 |
|---|---|---|
| FileBasedMemory | `tests/memory/file-memory.test.ts` | 5 |
| MemoryPlugin | `tests/plugins/memory-plugin.spec.ts` | 3 |
| SkillsPlugin | `tests/plugins/memory-plugin.spec.ts` | 2 |
| Plugin Chain | `tests/plugins/memory-plugin.spec.ts` | 5 |
| HistoryOffload | `tests/memory/history-offload.test.ts` | 3 |
| ProviderRegistry | `tests/adapters/registry.test.ts` | 3 |

### 9.2 集成测试

| 测试 | 验证 |
|---|---|
| Memory × AgentLoop | 端到端注入（llm.request 包含 memory message） |
| Plugin Priority | 后执行的 prepend 在前 |
| Provider × Agent | `createAgent({ model: 'openai/gpt-4o' })` 端到端 |

---

## 10. 迁移路径

### 10.1 向后兼容

- 所有新功能以 opt-in 方式引入
- 现有 `createAgent()` API 不变
- 新 Plugin 通过 `pluginManager.register()` 注册
- **不修改** `callLLM()`、`handleLLMRequest()`、`agent-loop.ts`

### 10.2 分阶段发布

```
v0.9.0  Phase 1: 基础能力（Plugin-based）
        ├── MemoryPlugin（InterceptorPlugin 实现）
        ├── FileBasedMemory + PersistentMemory 接口
        ├── Memory Guidelines（注入 system prompt）
        ├── HistoryOffloadManager
        └── SkillsPlugin（渐进式披露）

v0.10.0 Phase 2: 架构升级
        ├── ProviderRegistry
        ├── SummarizationPlugin（压缩 + offload）
        └── 补充集成测试

v0.11.0 Phase 3: 优化打磨
        ├── 工具参数截断
        ├── PersistentMemory.vectorSearch() 向量搜索
        ├── Skills uri 字段（远程 Studio 支持）
        └── 性能优化
```

### 10.3 使用示例

```typescript
import { createAgent, FileBasedMemory } from 'agentforge';
import { createMemoryPlugin, createSkillsPlugin, createPluginManager } from 'agentforge/plugins';

const manager = createPluginManager();
manager.register(createMemoryPlugin(new FileBasedMemory(), {
  enabled: true,
  sources: ['~/.agentforge/AGENTS.md', './AGENTS.md'],
}));
manager.register(createSkillsPlugin(['/skills/user/', '/skills/project/']));

const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  pluginManager: manager,
});

agent.run('Hello').subscribe(event => console.log(event.type));
```

---

## 附录 A：与 5 框架的设计映射

| AgentForge 设计 | 来源框架 | 关键参考文件 |
|---|---|---|
| `FileBasedMemory` | DeepAgents + OpenHarness | `middleware/memory.py`, `memory/memdir.py` |
| `MemoryPlugin` | DeepAgents | `middleware/memory.py` 第 159-354 行 |
| `MEMORY_SYSTEM_PROMPT` | DeepAgents | `middleware/memory.py` 第 97-156 行 |
| `HistoryOffloadManager` | DeepAgents | `middleware/summarization.py` 第 735-807 行 |
| `SkillsPlugin` (渐进式) | DeepAgents | `middleware/skills.py` 第 560-599 行 |
| `ProviderRegistry` | OpenCode | `provider/provider.ts` (BUNDLED_PROVIDERS) |
| `InterceptorPlugin` 接口 | AgentForge 已有 | `src/plugins/plugin.ts` |
| `buildPluginPipeline` | AgentForge 已有 | `src/plugins/pipeline.ts` |

## 附录 B：关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 记忆格式 | AGENTS.md (Markdown) | 人类可读、模型可写、与 DeepAgents/OpenHarness 兼容 |
| 记忆注入位置 | system prompt | 所有框架都采用此方式，最简单可靠 |
| 插件优先级 | Skills(5) → Memory(10) → Summarize(20) | 后执行的 prepend 在前，Memory 在 Skills 之前 |
| Provider 加载方式 | lazy import | 减少 bundle 大小，按需加载 |
| 渐进式披露 | 元数据注入 + 按需读取 | DeepAgents 验证，节省 token |
| 历史存储格式 | Markdown sections | 人类可读，追加友好 |
| **扩展机制** | `InterceptorPlugin`（已有） | **不引入 Middleware**。AgentForge 已有完整的 Plugin 系统，功能等价性已通过 demo 测试验证（10/10）。零新增概念。 |
| **数据加载** | `agent.start` 事件触发 | 拦截 `agent.start` 加载 AGENTS.md/SKILL.md |
| **消息注入** | `llm.request` 事件拦截 | prepend 注入的 message 到 messages 数组前面 |
| **错误隔离** | 返回 `throwError()` 而非同步 throw | 同步 throw 会绕过 RxJS catchError |
| ~~Middleware 接口~~ | ~~已废弃~~ | ~~与 AgentForge 已有 Plugin 系统功能重叠，改用 InterceptorPlugin~~ |
| ~~Promise ↔ Observable~~ | ~~已废弃~~ | ~~已被 Plugin 方案替代~~ |
