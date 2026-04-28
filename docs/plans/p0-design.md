# P0 设计方案：Google/Ollama 适配器 + 记忆持久化

> 创建时间：2026-04-28
> 状态：待审查

---

## 一、Google/Ollama 适配器实现

### 1.1 现状分析

| 维度 | Google | Ollama |
|------|--------|--------|
| **当前状态** | Stub | Stub |
| **Stub 行为** | `chat()` 抛出错误，`stream()` 返回 `EMPTY` | 同左 |
| **需要依赖** | `@ai-sdk/google` | `@ai-sdk/ollama` |
| **环境变量** | `GOOGLE_API_KEY` | 无（本地服务） |
| **默认 Base URL** | `https://generativelanguage.googleapis.com/v1beta` | `http://localhost:11434` |
| **支持模型** | Gemini 系列（`gemini-2.0-flash`, `gemini-2.5-pro`） | 任意本地模型 |

### 1.2 文件结构

```
src/adapters/
├── google.ts      # 新增 - Google Gemini 适配器
├── ollama.ts      # 新增 - Ollama 本地模型适配器
└── index.ts       # 修改 - 注册 factory 函数

tests/adapters/
├── google.spec.ts    # 新增
└── ollama.spec.ts    # 新增
```

### 1.3 Google 适配器设计 (`src/adapters/google.ts`)

```typescript
/**
 * Google Gemini LLM Adapter for AgentForge
 *
 * Implements LLMAdapter interface using @ai-sdk/google package.
 * Supports Gemini 2.0/2.5 series models.
 *
 * @packageDocumentation
 */

import { Observable } from 'rxjs';
import { generateText, streamText, jsonSchema } from 'ai';
import { google, createGoogle } from '@ai-sdk/google';
import type {
  LLMAdapter,
  LLMResponse,
  LLMChunk,
  LLMOptions,
  FunctionDefinition,
  ToolChoice,
} from '../core/interfaces.js';
import type { JSONSchema7 } from 'json-schema';
import type { Message, ToolCall } from '../core/events.js';

// ============================================================
// Types
// ============================================================

export interface GoogleAdapterOptions {
  /** API key (defaults to GOOGLE_API_KEY env var) */
  apiKey?: string;
  /** Base URL for custom endpoints */
  baseURL?: string;
}

// ============================================================
// Google Adapter Implementation
// ============================================================

export class GoogleAdapter implements LLMAdapter {
  readonly name: string;
  readonly provider = 'google';

  private readonly model: ReturnType<typeof google>;

  constructor(modelName: string, options?: GoogleAdapterOptions) {
    this.name = `google-${modelName}`;

    if (options && (options.apiKey || options.baseURL)) {
      const settings: Record<string, string> = {};
      if (options.apiKey) settings.apiKey = options.apiKey;
      if (options.baseURL) settings.baseURL = options.baseURL;

      const provider = createGoogle(settings as Parameters<typeof createGoogle>[0]);
      this.model = provider(modelName);
    } else {
      this.model = google(modelName);
    }
  }

  /**
   * Convert AgentForge Message[] to AI SDK v6 message format
   *
   * Google Gemini 使用 content blocks 格式，与 OpenAI 类似
   */
  private convertMessages(messages: Message[]): Array<Record<string, unknown>> {
    return messages.map(msg => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: msg.toolCallId ?? '',
              toolName: msg.name ?? '',
              output: content,
            },
          ],
        };
      }

      return { role: msg.role, content };
    });
  }

  /**
   * Extract system prompt from messages
   *
   * Gemini 使用 systemInstruction 参数传递系统提示
   */
  private extractSystemPrompt(messages: Message[]): {
    systemPrompt: string | undefined;
    filteredMessages: Message[];
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const systemPrompt =
      systemMessages.length > 0 ? systemMessages.map(m => m.content).join('\n\n') : undefined;

    return { systemPrompt, filteredMessages: otherMessages };
  }

  /**
   * Non-streaming chat completion
   */
  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    try {
      const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);

      const config: Record<string, unknown> = {
        model: this.model,
        messages: this.convertMessages(filteredMessages),
      };

      if (systemPrompt) config.system = systemPrompt;
      if (options?.temperature !== undefined) config.temperature = options.temperature;
      if (options?.maxTokens !== undefined) config.maxTokens = options.maxTokens;

      // 工具处理
      const tools = options?.tools as FunctionDefinition[] | undefined;
      if (tools && tools.length > 0) {
        const toolsRecord: Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> = {};
        for (const tool of tools) {
          toolsRecord[tool.name] = {
            description: tool.description,
            parameters: jsonSchema(tool.parameters as JSONSchema7),
          };
        }
        config.tools = toolsRecord;
      }

      const result = await generateText(config as Parameters<typeof generateText>[0]);

      // 转换 tool calls
      const toolCalls: ToolCall[] | undefined =
        result.toolCalls && result.toolCalls.length > 0
          ? result.toolCalls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: (tc as { input?: Record<string, unknown> }).input ?? {},
            }))
          : undefined;

      const response: LLMResponse = {
        content: result.text,
        finishReason: result.finishReason as LLMResponse['finishReason'],
      };

      if (toolCalls) response.toolCalls = toolCalls;
      if (result.usage) {
        response.usage = {
          promptTokens: result.usage.inputTokens ?? 0,
          completionTokens: result.usage.outputTokens ?? 0,
        };
      }

      return response;
    }
    // 注意：不捕获错误，让 agent-loop.ts 的 catchError 统一处理
    // 这与 stream() 方法的 subscriber.error() 行为一致
  }

  /**
   * Streaming chat completion
   */
  stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk> {
    return new Observable<LLMChunk>(subscriber => {
      const run = async (): Promise<void> => {
        try {
          const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);

          const config: Record<string, unknown> = {
            model: this.model,
            messages: this.convertMessages(filteredMessages),
          };

          if (systemPrompt) config.system = systemPrompt;
          if (options?.temperature !== undefined) config.temperature = options.temperature;
          if (options?.maxTokens !== undefined) config.maxTokens = options.maxTokens;

          const tools = options?.tools as FunctionDefinition[] | undefined;
          if (tools && tools.length > 0) {
            const toolsRecord: Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> = {};
            for (const tool of tools) {
              toolsRecord[tool.name] = {
                description: tool.description,
                parameters: jsonSchema(tool.parameters as JSONSchema7),
              };
            }
            config.tools = toolsRecord;
          }

          const result = streamText(config as Parameters<typeof streamText>[0]);

          for await (const textPart of result.textStream) {
            subscriber.next({ text: textPart });
          }

          subscriber.complete();
        } catch (error) {
          subscriber.error(error instanceof Error ? error : new Error(String(error)));
        }
      };

      run().catch(error => subscriber.error(error instanceof Error ? error : new Error(String(error))));
    });
  }

  /**
   * Format tools for Gemini API
   *
   * Gemini 使用 function_declarations 格式，但 AI SDK 会自动转换
   */
  formatTools(tools: FunctionDefinition[]): unknown {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  normalizeMessages(messages: Message[]): unknown[] {
    return this.convertMessages(messages);
  }

  formatToolChoice(choice: ToolChoice): unknown {
    if (typeof choice === 'string') return choice;
    return { type: 'tool', name: choice.name };
  }
}

// ============================================================
// Factory Functions
// ============================================================

export function createGoogleAdapter(model: string, options?: GoogleAdapterOptions): LLMAdapter {
  return new GoogleAdapter(model, options);
}

export function googleAdapterFactory(model: string, options: Record<string, unknown>): LLMAdapter {
  return createGoogleAdapter(model, options as GoogleAdapterOptions);
}
```

### 1.4 Ollama 适配器设计 (`src/adapters/ollama.ts`)

```typescript
/**
 * Ollama LLM Adapter for AgentForge
 *
 * Implements LLMAdapter interface using @ai-sdk/ollama package.
 * Supports local models running on Ollama server.
 *
 * @packageDocumentation
 */

import { Observable } from 'rxjs';
import { generateText, streamText, jsonSchema } from 'ai';
import { ollama, createOllama } from '@ai-sdk/ollama';
import type {
  LLMAdapter,
  LLMResponse,
  LLMChunk,
  LLMOptions,
  FunctionDefinition,
  ToolChoice,
} from '../core/interfaces.js';
import type { JSONSchema7 } from 'json-schema';
import type { Message, ToolCall } from '../core/events.js';

// ============================================================
// Types
// ============================================================

export interface OllamaAdapterOptions {
  /** Base URL for Ollama server (default: http://localhost:11434) */
  baseURL?: string;
}

// ============================================================
// Ollama Adapter Implementation
// ============================================================

export class OllamaAdapter implements LLMAdapter {
  readonly name: string;
  readonly provider = 'ollama';

  private readonly model: ReturnType<typeof ollama>;

  constructor(modelName: string, options?: OllamaAdapterOptions) {
    this.name = `ollama-${modelName}`;
    const baseURL = options?.baseURL ?? 'http://localhost:11434';
    const provider = createOllama({ baseURL });
    this.model = provider(modelName);
  }

  private convertMessages(messages: Message[]): Array<Record<string, unknown>> {
    return messages.map(msg => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: msg.toolCallId ?? '',
              toolName: msg.name ?? '',
              output: content,
            },
          ],
        };
      }

      return { role: msg.role, content };
    });
  }

  /**
   * Extract system prompt from messages
   *
   * Ollama 使用 system 参数传递系统提示
   */
  private extractSystemPrompt(messages: Message[]): {
    systemPrompt: string | undefined;
    filteredMessages: Message[];
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const systemPrompt =
      systemMessages.length > 0 ? systemMessages.map(m => m.content).join('\n\n') : undefined;

    return { systemPrompt, filteredMessages: otherMessages };
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);

    const config: Record<string, unknown> = {
      model: this.model,
      messages: this.convertMessages(filteredMessages),
    };

    if (systemPrompt) config.system = systemPrompt;
    if (options?.temperature !== undefined) config.temperature = options.temperature;
    if (options?.maxTokens !== undefined) config.maxTokens = options.maxTokens;

    const tools = options?.tools as FunctionDefinition[] | undefined;
    if (tools && tools.length > 0) {
      const toolsRecord: Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> = {};
      for (const tool of tools) {
        toolsRecord[tool.name] = {
          description: tool.description,
          parameters: jsonSchema(tool.parameters as JSONSchema7),
        };
      }
      config.tools = toolsRecord;
    }

    const result = await generateText(config as Parameters<typeof generateText>[0]);

    const toolCalls: ToolCall[] | undefined =
      result.toolCalls && result.toolCalls.length > 0
        ? result.toolCalls.map(tc => ({
            id: tc.toolCallId,
            name: tc.toolName,
            args: (tc as { input?: Record<string, unknown> }).input ?? {},
          }))
        : undefined;

    const response: LLMResponse = {
      content: result.text,
      finishReason: result.finishReason as LLMResponse['finishReason'],
    };

    if (toolCalls) response.toolCalls = toolCalls;
    if (result.usage) {
      response.usage = {
        promptTokens: result.usage.inputTokens ?? 0,
        completionTokens: result.usage.outputTokens ?? 0,
      };
    }

    return response;
    // 注意：不捕获错误，让 agent-loop.ts 的 catchError 统一处理
    // 这与 stream() 方法的 subscriber.error() 行为一致
  }

  stream(messages: Message[], options?: LLMOptions): Observable<LLMChunk> {
    return new Observable<LLMChunk>(subscriber => {
      const run = async (): Promise<void> => {
        try {
          const { systemPrompt, filteredMessages } = this.extractSystemPrompt(messages);

          const config: Record<string, unknown> = {
            model: this.model,
            messages: this.convertMessages(filteredMessages),
          };

          if (systemPrompt) config.system = systemPrompt;

          if (options?.temperature !== undefined) config.temperature = options.temperature;
          if (options?.maxTokens !== undefined) config.maxTokens = options.maxTokens;

          const tools = options?.tools as FunctionDefinition[] | undefined;
          if (tools && tools.length > 0) {
            const toolsRecord: Record<string, { description: string; parameters: ReturnType<typeof jsonSchema> }> = {};
            for (const tool of tools) {
              toolsRecord[tool.name] = {
                description: tool.description,
                parameters: jsonSchema(tool.parameters as JSONSchema7),
              };
            }
            config.tools = toolsRecord;
          }

          const result = streamText(config as Parameters<typeof streamText>[0]);

          for await (const textPart of result.textStream) {
            subscriber.next({ text: textPart });
          }

          subscriber.complete();
        } catch (error) {
          subscriber.error(error instanceof Error ? error : new Error(String(error)));
        }
      };

      run().catch(error => subscriber.error(error instanceof Error ? error : new Error(String(error))));
    });
  }

  formatTools(tools: FunctionDefinition[]): unknown {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  normalizeMessages(messages: Message[]): unknown[] {
    return this.convertMessages(messages);
  }

  formatToolChoice(choice: ToolChoice): unknown {
    if (typeof choice === 'string') {
      if (choice === 'required') return { type: 'function' };
      return choice;
    }
    return { type: 'function', function: { name: choice.name } };
  }
}

// ============================================================
// Factory Functions
// ============================================================

export function createOllamaAdapter(model: string, options?: OllamaAdapterOptions): LLMAdapter {
  return new OllamaAdapter(model, options);
}

export function ollamaAdapterFactory(model: string, options: Record<string, unknown>): LLMAdapter {
  return createOllamaAdapter(model, options as OllamaAdapterOptions);
}
```

### 1.5 注册到 Factory (`src/adapters/index.ts` 修改)

在 `LLMAdapterFactoryImpl.initializeBuiltins()` 方法中添加：

```typescript
// Try to register Google adapter
try {
  const { googleAdapterFactory } = require('./google.js') as {
    googleAdapterFactory: AdapterFactoryFn;
  };
  this.factories.set('google', googleAdapterFactory);
} catch {
  // @ai-sdk/google not installed - stub will be used
}

// Try to register Ollama adapter
try {
  const { ollamaAdapterFactory } = require('./ollama.js') as {
    ollamaAdapterFactory: AdapterFactoryFn;
  };
  this.factories.set('ollama', ollamaAdapterFactory);
} catch {
  // @ai-sdk/ollama not installed - stub will be used
}
```

### 1.6 依赖更新 (`package.json`)

```json
{
  "optionalDependencies": {
    "@ai-sdk/google": "^1.0.0",
    "@ai-sdk/ollama": "^1.0.0"
  }
}
```

---

## 二、记忆持久化

### 2.1 现状分析

| 维度 | 现状 |
|------|------|
| **压缩策略** | `truncate-oldest`, `summarize`, `importance-weighted` ✅ |
| **文件记忆** | `PersistentMemory` 接口，AGENTS.md 文件加载 ✅ |
| **历史卸载** | `history-offload.ts` 将压缩消息保存为 Markdown ✅ |
| **向量存储** | ❌ 无 |
| **Embedding** | ❌ 无 |
| **跨会话检索** | ❌ 仅文件搜索，无语义检索 |

### 2.2 架构图

```
┌─────────────────────────────────────────────────────────┐
│                   Memory System                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │ Short-term  │    │   Long-term │    │  Semantic   │ │
│  │   Memory    │    │   Memory    │    │   Search    │ │
│  │ (Messages)  │    │ (Persistent)│    │  (Vector)   │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│         │                  │                  │         │
│         └──────────────────┼──────────────────┘         │
│                            │                            │
│                   ┌────────▼────────┐                   │
│                   │  SemanticMemory │                   │
│                   │    Manager      │                   │
│                   └────────┬────────┘                   │
│                            │                            │
│         ┌──────────────────┼──────────────────┐         │
│         │                  │                  │         │
│  ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐  │
│  │  Embedding  │   │   Vector    │   │   Memory    │  │
│  │   Model     │   │   Store     │   │   Entry     │  │
│  └─────────────┘   └─────────────┘   └─────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.3 文件结构

```
src/memory/
├── embedding.ts           # 新增 - Embedding 模型抽象
├── vector-store.ts        # 新增 - 向量存储接口
├── stores/
│   ├── sqlite.ts          # 新增 - SQLite 向量存储
│   └── redis.ts           # 新增 - Redis 向量存储（可选）
└── semantic-memory.ts     # 新增 - 语义记忆管理器
```

### 2.4 Embedding 模型抽象 (`src/memory/embedding.ts`)

```typescript
/**
 * AgentForge Embedding Model Interface
 *
 * Abstracts embedding generation for different providers.
 * Used by SemanticMemory for vector search.
 *
 * @module
 */

/**
 * Embedding Model Interface
 */
export interface EmbeddingModel {
  /** Provider name (e.g., 'openai', 'google', 'ollama') */
  readonly provider: string;

  /** Model name (e.g., 'text-embedding-3-small') */
  readonly model: string;

  /** Embedding dimensions (e.g., 1536 for text-embedding-3-small) */
  readonly dimensions: number;

  /**
   * Generate embedding for a single text
   *
   * @param text - Text to embed
   * @returns Embedding vector
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts (batch)
   *
   * @param texts - Texts to embed
   * @returns Embedding vectors
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * Embedding Model Options
 */
export interface EmbeddingModelOptions {
  /** API key */
  apiKey?: string;

  /** Model name override */
  model?: string;

  /** Dimensions override */
  dimensions?: number;
}

// ============================================================
// OpenAI Embedding Model
// ============================================================

/**
 * OpenAI Embedding Model
 *
 * Uses text-embedding-3-small (1536 dims) or text-embedding-3-large (3072 dims)
 */
export class OpenAIEmbeddingModel implements EmbeddingModel {
  readonly provider = 'openai';
  readonly model: string;
  readonly dimensions: number;

  private apiKey: string;

  constructor(options?: EmbeddingModelOptions) {
    this.apiKey = options?.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
    this.model = options?.model ?? 'text-embedding-3-small';
    this.dimensions = options?.dimensions ?? (this.model.includes('large') ? 3072 : 1536);

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI embedding model');
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0]?.embedding ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map(d => d.embedding);
  }
}

// ============================================================
// Google Embedding Model
// ============================================================

/**
 * Google Embedding Model
 *
 * Uses text-embedding-004 (768 dims)
 */
export class GoogleEmbeddingModel implements EmbeddingModel {
  readonly provider = 'google';
  readonly model: string;
  readonly dimensions: number;

  private apiKey: string;

  constructor(options?: EmbeddingModelOptions) {
    this.apiKey = options?.apiKey ?? process.env['GOOGLE_API_KEY'] ?? '';
    this.model = options?.model ?? 'text-embedding-004';
    this.dimensions = options?.dimensions ?? 768;

    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is required for Google embedding model');
    }
  }

  async embed(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });

    if (!response.ok) {
      throw new Error(`Google embedding error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      embedding: { values: number[] };
    };

    return data.embedding.values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Google batch API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map(text => ({
      model: `models/${this.model}`,
      content: { parts: [{ text }] },
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      throw new Error(`Google batch embedding error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      embeddings: Array<{ values: number[] }>;
    };

    return data.embeddings.map(e => e.values);
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Create embedding model by provider name
 */
export function createEmbeddingModel(
  provider: 'openai' | 'google',
  options?: EmbeddingModelOptions
): EmbeddingModel {
  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingModel(options);
    case 'google':
      return new GoogleEmbeddingModel(options);
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}
```

### 2.5 向量存储接口 (`src/memory/vector-store.ts`)

```typescript
/**
 * AgentForge Vector Store Interface
 *
 * Abstracts vector storage and retrieval for semantic memory.
 *
 * @module
 */

/**
 * Vector Document
 */
export interface VectorDocument {
  /** Unique ID */
  id: string;

  /** Embedding vector */
  embedding: number[];

  /** Original content */
  content: string;

  /** Metadata */
  metadata?: Record<string, unknown>;

  /** Creation timestamp (ms) */
  createdAt: number;
}

/**
 * Vector Search Result
 */
export interface VectorSearchResult {
  /** Document */
  document: VectorDocument;

  /** Similarity score (0-1, higher is more similar) */
  score: number;
}

/**
 * Vector Store Interface
 */
export interface VectorStore {
  /** Store name for logging */
  readonly name: string;

  /**
   * Insert a document with embedding
   */
  insert(doc: VectorDocument): Promise<void>;

  /**
   * Insert multiple documents (batch)
   */
  insertBatch(docs: VectorDocument[]): Promise<void>;

  /**
   * Search similar documents by embedding
   *
   * @param embedding - Query embedding vector
   * @param limit - Max results (default: 5)
   * @param threshold - Min similarity score (default: 0.7)
   * @returns Matching documents with scores
   */
  search(embedding: number[], limit?: number, threshold?: number): Promise<VectorSearchResult[]>;

  /**
   * Get document by ID
   */
  get(id: string): Promise<VectorDocument | null>;

  /**
   * Delete document by ID
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all documents
   */
  clear(): Promise<void>;

  /**
   * Get document count
   */
  count(): Promise<number>;

  /**
   * Close connection (cleanup)
   */
  close(): Promise<void>;
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### 2.6 SQLite 向量存储 (`src/memory/stores/sqlite.ts`)

```typescript
/**
 * SQLite Vector Store
 *
 * Uses SQLite for vector storage with in-memory cosine similarity calculation.
 * Lightweight, no external dependencies beyond better-sqlite3 (already in project).
 *
 * @module
 */

import Database from 'better-sqlite3';
import type { VectorStore, VectorDocument, VectorSearchResult } from '../vector-store.js';
import { cosineSimilarity } from '../vector-store.js';

export interface SQLiteVectorStoreOptions {
  /** Database file path (default: ':memory:') */
  dbPath?: string;

  /** Table name (default: 'vectors') */
  tableName?: string;
}

export class SQLiteVectorStore implements VectorStore {
  readonly name = 'sqlite';

  private db: Database.Database;
  private tableName: string;

  constructor(options?: SQLiteVectorStoreOptions) {
    const dbPath = options?.dbPath ?? ':memory:';
    this.tableName = options?.tableName ?? 'vectors';
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at
      ON ${this.tableName}(created_at);
    `);
  }

  async insert(doc: VectorDocument): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (id, embedding, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const embeddingBuffer = Buffer.from(new Float32Array(doc.embedding).buffer);
    const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null;

    stmt.run(doc.id, embeddingBuffer, doc.content, metadataJson, doc.createdAt);
  }

  async insertBatch(docs: VectorDocument[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (id, embedding, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((documents: VectorDocument[]) => {
      for (const doc of documents) {
        const embeddingBuffer = Buffer.from(new Float32Array(doc.embedding).buffer);
        const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null;
        stmt.run(doc.id, embeddingBuffer, doc.content, metadataJson, doc.createdAt);
      }
    });

    insertMany(docs);
  }

  async search(embedding: number[], limit = 5, threshold = 0.7): Promise<VectorSearchResult[]> {
    // 获取所有文档（对于小规模数据集可行）
    // 生产环境应使用 HNSW 索引或专用向量数据库
    const rows = this.db.prepare(`SELECT * FROM ${this.tableName}`).all() as Array<{
      id: string;
      embedding: Buffer;
      content: string;
      metadata: string | null;
      created_at: number;
    }>;

    const results: VectorSearchResult[] = [];

    for (const row of rows) {
      const docEmbedding = Array.from(new Float32Array(row.embedding.buffer));
      const score = cosineSimilarity(embedding, docEmbedding);

      if (score >= threshold) {
        results.push({
          document: {
            id: row.id,
            embedding: docEmbedding,
            content: row.content,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            createdAt: row.created_at,
          },
          score,
        });
      }
    }

    // 按相似度降序排序，返回 top-k
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async get(id: string): Promise<VectorDocument | null> {
    const row = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id) as {
      id: string;
      embedding: Buffer;
      content: string;
      metadata: string | null;
      created_at: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      embedding: Array.from(new Float32Array(row.embedding.buffer)),
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    };
  }

  async delete(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
  }

  async clear(): Promise<void> {
    this.db.exec(`DELETE FROM ${this.tableName}`);
  }

  async count(): Promise<number> {
    const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`).get() as {
      count: number;
    };
    return result.count;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
```

### 2.7 语义记忆管理器 (`src/memory/semantic-memory.ts`)

```typescript
/**
 * AgentForge Semantic Memory Manager
 *
 * Combines embedding model with vector store for semantic memory.
 * Provides save, search, and prompt injection capabilities.
 *
 * @module
 */

import type { EmbeddingModel } from './embedding.js';
import type { VectorStore, VectorDocument } from './vector-store.js';
import type { MemoryEntry } from './types.js';

/**
 * Semantic Memory Configuration
 */
export interface SemanticMemoryConfig {
  /** Embedding model */
  embeddingModel: EmbeddingModel;

  /** Vector store */
  vectorStore: VectorStore;

  /** Default search limit */
  defaultLimit?: number;

  /** Default similarity threshold */
  defaultThreshold?: number;
}

/**
 * Semantic Memory Manager
 *
 * Provides semantic search over stored memories using vector embeddings.
 */
export class SemanticMemory {
  private embeddingModel: EmbeddingModel;
  private vectorStore: VectorStore;
  private defaultLimit: number;
  private defaultThreshold: number;

  constructor(config: SemanticMemoryConfig) {
    this.embeddingModel = config.embeddingModel;
    this.vectorStore = config.vectorStore;
    this.defaultLimit = config.defaultLimit ?? 5;
    this.defaultThreshold = config.defaultThreshold ?? 0.7;
  }

  /**
   * Save a memory entry
   *
   * Generates embedding and stores in vector database.
   */
  async save(entry: MemoryEntry): Promise<void> {
    const embedding = await this.embeddingModel.embed(entry.content);

    const doc: VectorDocument = {
      id: entry.id,
      embedding,
      content: entry.content,
      metadata: {
        sourcePath: entry.sourcePath,
        tags: entry.tags,
      },
      createdAt: entry.createdAt,
    };

    await this.vectorStore.insert(doc);
  }

  /**
   * Save multiple memory entries (batch)
   */
  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    const texts = entries.map(e => e.content);
    const embeddings = await this.embeddingModel.embedBatch(texts);

    const docs: VectorDocument[] = entries.map((entry, i) => ({
      id: entry.id,
      embedding: embeddings[i]!,
      content: entry.content,
      metadata: {
        sourcePath: entry.sourcePath,
        tags: entry.tags,
      },
      createdAt: entry.createdAt,
    }));

    await this.vectorStore.insertBatch(docs);
  }

  /**
   * Search memories by semantic similarity
   *
   * @param query - Search query
   * @param limit - Max results
   * @param threshold - Min similarity score
   * @returns Matching memory entries
   */
  async search(
    query: string,
    limit?: number,
    threshold?: number
  ): Promise<MemoryEntry[]> {
    const queryEmbedding = await this.embeddingModel.embed(query);
    const results = await this.vectorStore.search(
      queryEmbedding,
      limit ?? this.defaultLimit,
      threshold ?? this.defaultThreshold
    );

    return results.map(r => ({
      id: r.document.id,
      content: r.document.content,
      sourcePath: (r.document.metadata?.sourcePath as string) ?? '',
      createdAt: r.document.createdAt,
      updatedAt: r.document.createdAt,
      tags: r.document.metadata?.tags as string[] | undefined,
    }));
  }

  /**
   * Format search results for system prompt injection
   */
  formatForPrompt(entries: MemoryEntry[]): string {
    if (entries.length === 0) return '';

    const lines = entries.map((e, i) => `[${i + 1}] ${e.content}`);
    return `## Relevant Memories\n\n${lines.join('\n\n')}`;
  }

  /**
   * Get memory by ID
   */
  async get(id: string): Promise<MemoryEntry | null> {
    const doc = await this.vectorStore.get(id);
    if (!doc) return null;

    return {
      id: doc.id,
      content: doc.content,
      sourcePath: (doc.metadata?.sourcePath as string) ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.createdAt,
      tags: doc.metadata?.tags as string[] | undefined,
    };
  }

  /**
   * Delete memory by ID
   */
  async delete(id: string): Promise<void> {
    await this.vectorStore.delete(id);
  }

  /**
   * Clear all memories
   */
  async clear(): Promise<void> {
    await this.vectorStore.clear();
  }

  /**
   * Get memory count
   */
  async count(): Promise<number> {
    return this.vectorStore.count();
  }
}

/**
 * Create semantic memory with default config
 */
export function createSemanticMemory(config: {
  embeddingProvider: 'openai' | 'google';
  vectorStore: VectorStore;
  embeddingOptions?: { apiKey?: string; model?: string };
}): SemanticMemory {
  // 动态导入避免循环依赖
  const { createEmbeddingModel } = require('./embedding.js') as {
    createEmbeddingModel: typeof import('./embedding.js').createEmbeddingModel;
  };

  const embeddingModel = createEmbeddingModel(config.embeddingProvider, config.embeddingOptions);

  return new SemanticMemory({
    embeddingModel,
    vectorStore: config.vectorStore,
  });
}
```

### 2.8 记忆模块导出 (`src/memory/index.ts` 修改)

```typescript
// 现有导出
export * from './types.js';
export * from './strategies.js';
export * from './compaction.js';
export * from './persistent.js';
export * from './file-memory.js';
export * from './history-offload.js';
export * from './guidelines.js';

// 新增导出
export * from './embedding.js';
export * from './vector-store.js';
export * from './semantic-memory.js';
export * from './stores/sqlite.js';
```

### 2.9 依赖更新 (`package.json`)

```json
{
  "dependencies": {
    "better-sqlite3": "^12.9.0"  // 已有
  }
}
```

---

## 三、实现优先级与工作量

| 任务 | 工作量 | 依赖 | 优先级 | 状态 |
|------|--------|------|--------|------|
| Google 适配器 | 小（2-4h） | @ai-sdk/google | P0 | 待实现 |
| Ollama 适配器 | 小（2-4h） | @ai-sdk/ollama | P0 | 待实现 |
| Embedding 模型抽象 | 中（4-6h） | 无 | P0 | 待实现 |
| SQLite 向量存储 | 中（4-6h） | better-sqlite3 | P0 | 待实现 |
| 语义记忆管理器 | 中（4-6h） | Embedding + VectorStore | P0 | 待实现 |
| **总计** | **约 2-3 天** | | | |

---

## 四、测试策略

### 4.1 单元测试

```
tests/adapters/
├── google.spec.ts       # Google 适配器测试
└── ollama.spec.ts       # Ollama 适配器测试

tests/memory/
├── embedding.spec.ts    # Embedding 模型测试（Mock API）
├── vector-store.spec.ts # 向量存储测试
├── sqlite-store.spec.ts # SQLite 存储测试
└── semantic-memory.spec.ts # 语义记忆测试
```

### 4.2 集成测试

- Embedding → VectorStore → SemanticMemory 端到端
- Agent Loop + SemanticMemory 集成

### 4.3 Mock 策略

- 使用 Mock Embedding Model（返回固定向量）
- 使用 SQLite `:memory:` 存储
- 使用 Mock LLM 适配器

---

## 五、后续扩展（P1）

| 功能 | 说明 | 工作量 |
|------|------|--------|
| **Redis 向量存储** | 高性能分布式场景 | 中 |
| **更多 Embedding 模型** | Ollama 本地嵌入 | 小 |
| **混合检索** | 向量 + 关键词 + 重排序 | 大 |
| **记忆压缩** | 自动总结长期记忆 | 中 |
| **记忆过期** | TTL 自动清理 | 小 |

---

## 六、风险与注意事项

### 6.1 Google 适配器

- **风险**：Gemini API 格式与 OpenAI 不同，需要仔细处理 tool_calls 格式
- **缓解**：AI SDK v6 已处理大部分格式转换，只需测试验证

### 6.2 Ollama 适配器

- **风险**：本地模型质量参差不齐，tool calling 支持不完整
- **缓解**：文档说明支持限制，提供 fallback 配置

### 6.3 记忆持久化

- **风险**：SQLite 向量搜索性能随数据量增长下降
- **缓解**：明确适用场景（<10K 文档），大数据量推荐专用向量数据库

### 6.4 Embedding API 调用

- **风险**：Embedding API 调用有成本
- **缓解**：提供缓存机制，避免重复嵌入相同内容

---

*文档结束*
