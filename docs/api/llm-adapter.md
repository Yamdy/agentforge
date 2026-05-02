# LLMAdapter API

LLMAdapter 是 AgentForge 的 LLM 提供商抽象接口。

## 接口定义

```typescript
interface LLMAdapter {
  readonly name: string;
  readonly provider: string;

  chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
  stream(messages: Message[], options?: LLMOptions): AsyncGenerator<LLMChunk>;

  // 可选：Provider 特定方法
  formatTools?(tools: FunctionDefinition[]): unknown;
  normalizeMessages?(messages: Message[]): unknown[];
  formatToolChoice?(choice: ToolChoice): unknown;
}
```

## LLMOptions

```typescript
interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: FunctionDefinition[];
  toolChoice?: ToolChoice;
  [key: string]: unknown;
}
```

## LLMResponse

```typescript
interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
  usage?: LLMUsage;
}
```

## LLMChunk

```typescript
interface LLMChunk {
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsDelta?: string;
}
```

## LLMUsage

```typescript
interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
}
```

## ToolChoice

```typescript
type ToolChoice = 'auto' | 'none' | 'required' | { name: string };
```

## 内置适配器

### OpenAI Adapter

```typescript
import { OpenAIAdapter, createOpenAIAdapter } from 'agentforge/adapters';

// 使用工厂函数
const adapter = createOpenAIAdapter('gpt-4o', {
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1',
});

// 或使用类
const adapter = new OpenAIAdapter('gpt-4o', {
  apiKey: process.env.OPENAI_API_KEY,
});
```

### Anthropic Adapter

```typescript
import { AnthropicAdapter, createAnthropicAdapter } from 'agentforge/adapters';

const adapter = createAnthropicAdapter('claude-sonnet-4-5', {
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

## ModelSpec 格式

AgentForge 支持字符串格式的模型规格：

```typescript
type ModelSpec = string;

// 格式："provider/model"
createOpenAIAdapter('gpt-4o');                       // 自动识别 OpenAI
createOpenAIAdapter('openai/gpt-4o');                 // 显式指定 Provider
createAnthropicAdapter('anthropic/claude-sonnet-4-5'); // Anthropic
```

### 自动识别规则

| Provider | 模型名称模式 |
|----------|-------------|
| OpenAI | `gpt-*`, `o1-*`, `o3-*` |
| Anthropic | `claude-*` |

## 创建自定义适配器

```typescript
import type { LLMAdapter, LLMResponse, LLMChunk, LLMOptions } from 'agentforge';

class CustomLLMAdapter implements LLMAdapter {
  readonly name = 'custom';
  readonly provider = 'custom';

  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    // 实现非流式聊天
    const response = await yourLLMlib.chat({
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature,
    });

    return {
      content: response.text,
      finishReason: 'stop',
      usage: {
        promptTokens: response.usage.input,
        completionTokens: response.usage.output,
      },
    };
  }

  async *stream(messages: Message[], options?: LLMOptions): AsyncGenerator<LLMChunk> {
    // 实现流式聊天
    const stream = yourLLMlib.stream({ messages });

    for await (const chunk of stream) {
      yield { text: chunk.text };
    }
  }
}
```

## 通过 ModelSpec 工厂创建

```typescript
import { createLLMAdapter, parseModelSpec } from 'agentforge/adapters';

// 从字符串创建适配器
const adapter = createLLMAdapter('openai/gpt-4o', {
  apiKey: process.env.OPENAI_API_KEY,
});

const adapter = createLLMAdapter('anthropic/claude-sonnet-4-5', {
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 解析 ModelSpec
const { provider, model } = parseModelSpec('openai/gpt-4o');
console.log(provider); // 'openai'
console.log(model);    // 'gpt-4o'
```

## 错误处理

LLM Adapter 实现应遵循"错误即事件"模式：

```typescript
async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
  try {
    // 执行 LLM 调用
    return await this.doChat(messages, options);
  } catch (error) {
    // 返回错误响应，而非抛出异常
    return {
      content: '',
      finishReason: 'error',
    };
  }
}
```

## 相关 API

- [createAgent](/api/create-agent) - Agent 创建
- [事件系统](/api/events) - LLM 事件类型
- [ToolDefinition](/api/tool-definition) - 工具定义