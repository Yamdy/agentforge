# 自定义适配器

学习如何创建自定义适配器来支持不同的 LLM 提供商。

## 适配器接口

```typescript
interface LLMAdapter {
  name: string;
  chat(params: ChatParams): Promise<ChatResponse>;
  stream(params: ChatParams): AsyncIterable<ChatChunk>;
}
```

## 创建适配器

### OpenAI 适配器

```typescript
import { LLMAdapter, ChatParams, ChatResponse } from 'agentforge/types';

export class OpenAIAdapter implements LLMAdapter {
  name = 'openai';

  constructor(
    private config: {
      apiKey: string;
      baseUrl?: string;
      model?: string;
    }
  ) {}

  async chat(params: ChatParams): Promise<ChatResponse> {
    const response = await fetch(
      `${this.config.baseUrl || 'https://api.openai.com/v1'}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model || 'gpt-4o',
          messages: params.messages,
          temperature: params.temperature,
          max_tokens: params.maxTokens,
        }),
      }
    );

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
    };
  }

  async *stream(params: ChatParams): AsyncIterable<ChatChunk> {
    const response = await fetch(
      `${this.config.baseUrl || 'https://api.openai.com/v1'}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model || 'gpt-4o',
          messages: params.messages,
          temperature: params.temperature,
          max_tokens: params.maxTokens,
          stream: true,
        }),
      }
    );

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((line) => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        const parsed = JSON.parse(data);
        const content = parsed.choices[0]?.delta?.content;
        if (content) {
          yield { content };
        }
      }
    }
  }
}
```

### Anthropic 适配器

```typescript
export class AnthropicAdapter implements LLMAdapter {
  name = 'anthropic';

  constructor(
    private config: {
      apiKey: string;
      model?: string;
    }
  ) {}

  async chat(params: ChatParams): Promise<ChatResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model || 'claude-3-opus-20240229',
        max_tokens: params.maxTokens || 4096,
        messages: params.messages,
      }),
    });

    const data = await response.json();
    return {
      content: data.content[0].text,
      usage: data.usage,
    };
  }

  async *stream(params: ChatParams): AsyncIterable<ChatChunk> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model || 'claude-3-opus-20240229',
        max_tokens: params.maxTokens || 4096,
        messages: params.messages,
        stream: true,
      }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((line) => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        const parsed = JSON.parse(data);

        if (parsed.type === 'content_block_delta') {
          yield { content: parsed.delta.text };
        }
      }
    }
  }
}
```

### 本地模型适配器

```typescript
export class LocalModelAdapter implements LLMAdapter {
  name = 'local';

  constructor(
    private config: {
      endpoint: string;
      model?: string;
    }
  ) {}

  async chat(params: ChatParams): Promise<ChatResponse> {
    const response = await fetch(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'local-model',
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      }),
    });

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
    };
  }

  async *stream(params: ChatParams): AsyncIterable<ChatChunk> {
    const response = await fetch(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'local-model',
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: true,
      }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((line) => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        const parsed = JSON.parse(data);
        const content = parsed.choices[0]?.delta?.content;
        if (content) {
          yield { content };
        }
      }
    }
  }
}
```

## 使用自定义适配器

```typescript
import { Agent } from 'agentforge';
import { InMemoryHistory } from 'agentforge/memory';
import { ToolRegistry } from 'agentforge/registry';

// 创建自定义适配器
const adapter = new OpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
});

// 创建 Agent
const history = new InMemoryHistory();
const registry = new ToolRegistry();

const agent = new Agent(adapter, history, registry, {
  name: 'My Agent',
  maxSteps: 10,
});

// 使用 Agent
const result = await agent.run('Hello!');
```

## 适配器注册

```typescript
import { registerAdapter } from 'agentforge/adapters';

registerAdapter('openai', OpenAIAdapter);
registerAdapter('anthropic', AnthropicAdapter);
registerAdapter('local', LocalModelAdapter);

// 通过配置使用
const config = await loadConfig({
  model: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
  },
});
```

## 适配器配置

```typescript
interface AdapterConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  [key: string]: any;
}
```

## 适配器工厂

```typescript
import { LLMAdapter } from 'agentforge/types';

class AdapterFactory {
  private static adapters = new Map<string, new (config: any) => LLMAdapter>();

  static register(name: string, adapter: new (config: any) => LLMAdapter) {
    this.adapters.set(name, adapter);
  }

  static create(config: AdapterConfig): LLMAdapter {
    const AdapterClass = this.adapters.get(config.provider);
    if (!AdapterClass) {
      throw new Error(`Unknown adapter: ${config.provider}`);
    }
    return new AdapterClass(config);
  }
}

// 注册适配器
AdapterFactory.register('openai', OpenAIAdapter);
AdapterFactory.register('anthropic', AnthropicAdapter);

// 创建适配器
const adapter = AdapterFactory.create({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
});
```

## 适配器测试

```typescript
import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from './openai';

describe('OpenAIAdapter', () => {
  it('should send chat request', async () => {
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
    });

    const response = await adapter.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response.content).toBeTruthy();
  });

  it('should stream chat', async () => {
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
    });

    const chunks = [];
    for await (const chunk of adapter.stream({
      messages: [{ role: 'user', content: 'Hello' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

## 完整示例

```typescript
import { LLMAdapter, ChatParams, ChatResponse, ChatChunk } from 'agentforge/types';

export class CustomAdapter implements LLMAdapter {
  name = 'custom';

  constructor(
    private config: {
      endpoint: string;
      apiKey: string;
      model: string;
    }
  ) {}

  async chat(params: ChatParams): Promise<ChatResponse> {
    const response = await fetch(`${this.config.endpoint}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      content: data.response,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  async *stream(params: ChatParams): AsyncIterable<ChatChunk> {
    const response = await fetch(`${this.config.endpoint}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: true,
      }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.content) {
            yield { content: data.content };
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  }
}
```

## 最佳实践

1. **错误处理**：妥善处理 API 错误和网络问题
2. **重试机制**：实现重试逻辑处理临时故障
3. **流式支持**：尽可能支持流式响应
4. **类型安全**：使用 TypeScript 类型确保类型安全
5. **测试覆盖**：编写完整的测试用例
6. **文档完善**：提供清晰的使用文档

## 下一步

- [插件系统](./plugins.md) - 了解插件系统
- [测试](./testing.md) - 学习如何测试
