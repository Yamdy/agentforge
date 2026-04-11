# Plugin Provider 能力设计

**日期**: 2026-04-11
**目标**: 让插件能提供 LLM Provider 能力（认证、自定义 fetch、headers 注入），使 Inferhub 等第三方 LLM 服务可通过插件灵活引入

## 问题

当前插件只能通过 hooks 做事件通知，无法影响 LLM 请求的发送方式。Inferhub 等第三方 provider 需要：
1. 自定义认证（W3 OAuth token 获取与刷新）
2. 注入特殊 headers（`x-auth-token`、`app-id`、`x-session-id`）和 body 字段（`oc-heartbeat`、`tool_stream`）
3. 自定义 fetch（TLS 跳过验证、URL 重写）

## 设计决策

参考 OpenCode 的 `auth.loader` 模式：
- 插件声明 `provider()` 函数，返回 `{ fetch?, baseURL?, headers?, timeout?, tlsRejectUnauthorized? }`
- `provider()` 在 AgentFactory 创建 adapter 时调用一次，结果缓存在 AIAdapter 中
- token 刷新逻辑封装在 `provider()` 返回的 `fetch` 函数内部（参考 OpenCode Copilot/Codex 插件做法）
- `llm.request.before` hook 通过 RequestInterceptor 桥接，用于每次请求的动态 headers/body 注入

## 接口设计

### 1. Plugin 接口扩展

```typescript
// src/plugin/types.ts

export interface ProviderContext {
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export interface ProviderResult {
  baseURL?: string;
  apiKey?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  headers?: Record<string, string>;
  timeout?: TimeoutConfig;
  tlsRejectUnauthorized?: boolean;
}

// Plugin 接口新增 provider 字段
export interface Plugin {
  name: string;
  version?: string;
  hooks?: Partial<Hooks>;
  provider?: (ctx: ProviderContext) => Promise<ProviderResult>;
}
```

### 2. AgentFactory 收集 provider 结果

```typescript
// AgentFactory.createAdapter() 中：
// 1. 遍历所有插件的 provider()，收集结果
// 2. 合并到 AIAdapterConfig
// 3. 创建 hookInterceptor 桥接 llm.request.before
```

### 3. AIAdapter 新增 setInterceptors 方法

当前 interceptors 只能在构造时传入，需要支持后续设置：

```typescript
setInterceptors(interceptors: RequestInterceptor[]): void {
  this.interceptors = interceptors;
}
```

### 4. Hook 桥接

将 `llm.request.before` hook 的触发封装为 RequestInterceptor：

```typescript
const hookInterceptor: RequestInterceptor = {
  async beforeRequest(ctx) {
    const output = { headers: ctx.headers, body: ctx.body };
    await pluginManager.trigger('llm.request.before', 
      { headers: ctx.headers, body: ctx.body }, 
      output
    );
    return { ...ctx, headers: output.headers, body: output.body };
  },
};
```

### 5. ProviderResult.headers 处理

`provider()` 返回的 `headers` 是静态的初始 headers，通过 RequestInterceptor 注入：

```typescript
const staticHeadersInterceptor: RequestInterceptor = {
  beforeRequest(ctx) {
    return { ...ctx, headers: { ...providerResult.headers, ...ctx.headers } };
  },
};
```

## Inferhub 插件示例

```typescript
import type { Plugin, ProviderContext, ProviderResult } from 'agentforge';

async function getW3Token(): Promise<string> {
  // W3 OAuth token 获取逻辑
  // ...
  return token;
}

export const inferhubPlugin: Plugin = {
  name: 'inferhub',
  version: '1.0.0',

  async provider(ctx: ProviderContext): Promise<ProviderResult> {
    const token = await getW3Token();

    return {
      baseURL: 'https://ms-beta.devmate.huawei.com/codeAgent/chat/completions',
      tlsRejectUnauthorized: false,
      timeout: { total: 120000, firstToken: 60000, chunk: 30000 },
      headers: {
        'x-auth-token': token,
        'app-id': 'CodeAgent2.0',
      },
      async fetch(input, init) {
        // fetch 内部处理 token 刷新
        let currentToken = token;
        // ... token 刷新逻辑
        return fetch(input, init);
      },
    };
  },

  hooks: {
    'llm.request.before': async (input, output) => {
      output.headers['x-snap-traceid'] = crypto.randomUUID();
      output.headers['x-session-id'] = crypto.randomUUID();
      output.headers['oc-heartbeat'] = '1';
      output.body['tool_stream'] = true;
      output.body['oc-heartbeat'] = '1';
    },
  },
};
```

## 使用方式

```typescript
import { AgentFactory } from 'agentforge';
import { inferhubPlugin } from './plugins/inferhub';

const agent = AgentFactory.create({
  model: { model: 'Glm-4.7-Agent-Dev' },
  agent: { name: 'inferhub-agent' },
}, {
  pluginManager: new PluginManager({ plugins: [inferhubPlugin] }),
});
```

## 通用性分析

| 场景 | provider() 提供 | llm.request.before hook |
|------|----------------|------------------------|
| Inferhub | baseURL, fetch, headers, timeout, TLS | 动态 traceid, session, body 字段 |
| GitHub Copilot | fetch (OAuth), baseURL | 动态 headers (x-initiator) |
| OpenAI Codex | fetch (OAuth), baseURL | 动态 headers (originator) |
| 自定义代理 | fetch (URL 重写) | 动态 headers |
| 普通 OpenAI | 不需要 provider | 不需要 hook |

所有 LLM provider 接入场景都可以通过同一套 `provider()` + `llm.request.before` 覆盖，无需特化字段。

## 变更清单

1. `src/plugin/types.ts` — 新增 ProviderContext、ProviderResult，Plugin 接口新增 provider
2. `src/plugin/manager.ts` — 新增 collectProviders() 方法
3. `src/adapters/ai.ts` — 新增 setInterceptors() 方法
4. `src/agent/factory.ts` — createAdapter 中收集 provider 结果，桥接 hook
5. `src/types.ts` — 导出 ProviderContext、ProviderResult
6. `src/index.ts` — 导出新类型
7. `examples/inferhub-plugin.ts` — Inferhub 插件示例
8. `tests/plugin/provider.test.ts` — provider 功能测试
