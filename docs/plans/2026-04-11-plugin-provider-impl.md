# Plugin Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让插件能提供 LLM Provider 能力（认证、自定义 fetch、headers 注入），使第三方 LLM 服务可通过插件灵活引入

**Architecture:** Plugin 接口新增 `provider()` 函数，返回 ProviderResult（baseURL、fetch、headers、timeout、tlsRejectUnauthorized）。AgentFactory 创建 adapter 时调用 provider() 收集结果，合并到 AIAdapterConfig。`llm.request.before` hook 通过 RequestInterceptor 桥接，用于每次请求的动态 headers/body 注入。token 刷新逻辑封装在 provider() 返回的 fetch 函数内部。

**Tech Stack:** TypeScript, Vitest, Zod, RxJS

---

### Task 1: Add ProviderContext and ProviderResult types

**Files:**
- Modify: `src/plugin/types.ts`

**Step 1: Add new type definitions after LLMRequestBeforeOutput**

Add after line 119 (after `LLMRequestBeforeOutput` interface):

```typescript
import type { TimeoutConfig } from '../types.js';

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
```

**Step 2: Update PluginSchema to include provider**

Replace the PluginSchema (around line 157-161):

```typescript
export const PluginSchema = z.object({
  name: z.string().min(1, 'Plugin name is required'),
  version: z.string().optional(),
  hooks: z.record(z.string(), z.function()).optional(),
  provider: z.function().optional(),
});
```

Note: `Plugin` type will still be inferred from schema. We need to override it to add proper typing.

**Step 3: Override Plugin type with proper provider typing**

After PluginSchema, replace `export type Plugin = z.infer<typeof PluginSchema>;` with:

```typescript
export type Plugin = {
  name: string;
  version?: string;
  hooks?: Record<string, (input: unknown, output: unknown) => Promise<void>>;
  provider?: (ctx: ProviderContext) => Promise<ProviderResult>;
};
```

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no new errors)

**Step 5: Commit**

```bash
git add src/plugin/types.ts
git commit -m "feat: add ProviderContext and ProviderResult types to plugin system"
```

---

### Task 2: Add collectProviders method to PluginManager

**Files:**
- Modify: `src/plugin/manager.ts`

**Step 1: Add collectProviders method**

Add after the `get()` method (around line 119):

```typescript
async collectProviders(ctx: ProviderContext): Promise<ProviderResult[]> {
    const results: ProviderResult[] = [];
    for (const plugin of this.plugins) {
      if (plugin.provider) {
        try {
          const result = await plugin.provider(ctx);
          if (result) {
            results.push(result);
            this.context.logger.info('Provider collected', { plugin: plugin.name });
          }
        } catch (err) {
          this.context.logger.error(`Provider failed for plugin ${plugin.name}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return results;
  }
```

**Step 2: Add import for ProviderContext and ProviderResult**

Update the import from `./types.js` to include the new types:

```typescript
import { Plugin, PluginSchema, type ProviderContext, type ProviderResult } from './types.js';
```

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/plugin/manager.ts
git commit -m "feat: add collectProviders method to PluginManager"
```

---

### Task 3: Add setInterceptors method to AIAdapter

**Files:**
- Modify: `src/adapters/ai.ts`

**Step 1: Add setInterceptors method after getTool**

Add after line 58 (after `getTool` method):

```typescript
setInterceptors(interceptors: RequestInterceptor[]): void {
    this.interceptors = interceptors;
  }
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/adapters/ai.ts
git commit -m "feat: add setInterceptors method to AIAdapter"
```

---

### Task 4: Write failing tests for plugin provider

**Files:**
- Create: `tests/plugin/provider.test.ts`

**Step 1: Write test file**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PluginManager } from '../../src/plugin/manager.js';
import type { Plugin, ProviderContext, ProviderResult } from '../../src/plugin/types.js';
import { AIAdapter } from '../../src/adapters/ai.js';

describe('Plugin Provider', () => {
  describe('collectProviders', () => {
    it('should collect provider results from plugins', async () => {
      const providerResult: ProviderResult = {
        baseURL: 'https://api.example.com/v1',
        headers: { 'x-auth-token': 'test-token' },
        timeout: { total: 60000 },
        tlsRejectUnauthorized: false,
      };

      const plugin: Plugin = {
        name: 'test-provider',
        version: '1.0.0',
        async provider(ctx) {
          return providerResult;
        },
      };

      const manager = new PluginManager({ plugins: [plugin] });
      const results = await manager.collectProviders({
        model: 'gpt-4o',
        apiKey: 'key',
      });

      expect(results).toHaveLength(1);
      expect(results[0].baseURL).toBe('https://api.example.com/v1');
      expect(results[0].headers?.['x-auth-token']).toBe('test-token');
    });

    it('should skip plugins without provider', async () => {
      const plugin: Plugin = {
        name: 'no-provider',
        hooks: {},
      };

      const manager = new PluginManager({ plugins: [plugin] });
      const results = await manager.collectProviders({
        model: 'gpt-4o',
      });

      expect(results).toHaveLength(0);
    });

    it('should handle provider errors gracefully', async () => {
      const plugin: Plugin = {
        name: 'failing-provider',
        async provider() {
          throw new Error('Provider failed');
        },
      };

      const manager = new PluginManager({ plugins: [plugin] });
      const results = await manager.collectProviders({
        model: 'gpt-4o',
      });

      expect(results).toHaveLength(0);
    });

    it('should collect from multiple plugins', async () => {
      const plugin1: Plugin = {
        name: 'provider-1',
        async provider() {
          return { baseURL: 'https://api1.example.com' };
        },
      };
      const plugin2: Plugin = {
        name: 'provider-2',
        async provider() {
          return { headers: { 'x-custom': 'value' } };
        },
      };

      const manager = new PluginManager({ plugins: [plugin1, plugin2] });
      const results = await manager.collectProviders({ model: 'gpt-4o' });

      expect(results).toHaveLength(2);
    });

    it('should pass ProviderContext to provider function', async () => {
      let receivedCtx: ProviderContext | undefined;
      const plugin: Plugin = {
        name: 'context-check',
        async provider(ctx) {
          receivedCtx = ctx;
          return {};
        },
      };

      const manager = new PluginManager({ plugins: [plugin] });
      await manager.collectProviders({
        model: 'gpt-4o',
        apiKey: 'test-key',
        baseURL: 'https://default.example.com',
      });

      expect(receivedCtx?.model).toBe('gpt-4o');
      expect(receivedCtx?.apiKey).toBe('test-key');
      expect(receivedCtx?.baseURL).toBe('https://default.example.com');
    });
  });

  describe('AIAdapter with provider results', () => {
    it('should accept interceptors from setInterceptors', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
      });

      adapter.setInterceptors([
        {
          beforeRequest(ctx) {
            ctx.headers['x-injected'] = 'from-interceptor';
            return ctx;
          },
        },
      ]);

      expect(adapter).toBeDefined();
    });

    it('should accept fetch from provider result', () => {
      const customFetch = vi.fn();
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        fetch: customFetch,
      });

      expect(adapter).toBeDefined();
    });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/plugin/provider.test.ts`
Expected: All 7 tests PASS

**Step 3: Commit**

```bash
git add tests/plugin/provider.test.ts
git commit -m "test: add plugin provider tests"
```

---

### Task 5: Update AgentFactory to collect provider results and bridge hooks

**Files:**
- Modify: `src/agent/factory.ts`

**Step 1: Update imports**

Replace the imports section with:

```typescript
import { Agent } from './agent.js';
import { AIAdapter } from '../adapters/ai.js';
import { ToolRegistry } from '../registry.js';
import { InMemoryHistory } from '../history.js';
import { PluginManager } from '../plugin/index.js';
import { createLogger } from '../logger/index.js';
import {
  AgentForgeConfig,
  AgentConfig,
  ModelConfig,
  validateAgentConfig,
} from '../config/index.js';
import type { LLMAdapter, HistoryManager, RequestInterceptor } from '../types';
import type { ProviderResult } from '../plugin/types.js';
import type { Middleware } from '../middleware/index.js';
import { allTools } from '../tools/index.js';
```

**Step 2: Remove interceptors from AgentFactoryOptions**

Remove `interceptors?: RequestInterceptor[];` from `AgentFactoryOptions` interface since interceptors will now come from plugins.

**Step 3: Rewrite createAdapter method**

Replace the `createAdapter` method:

```typescript
private async createAdapter(config: ModelConfig, pluginManager: PluginManager): Promise<LLMAdapter> {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey && !config.baseURL) {
      this.log.warn(
        'No API key provided for LLM adapter. Set OPENAI_API_KEY environment variable or provide it in config.'
      );
    }

    const providerCtx = { model: config.model, apiKey, baseURL: config.baseURL };
    const providerResults = await pluginManager.collectProviders(providerCtx);

    const mergedConfig: Record<string, unknown> = {
      model: config.model,
      apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout,
      tlsRejectUnauthorized: config.tlsRejectUnauthorized,
    };

    const interceptors: RequestInterceptor[] = [];

    for (const result of providerResults) {
      if (result.baseURL) mergedConfig.baseURL = result.baseURL;
      if (result.apiKey) mergedConfig.apiKey = result.apiKey;
      if (result.fetch) mergedConfig.fetch = result.fetch;
      if (result.timeout) mergedConfig.timeout = result.timeout;
      if (result.tlsRejectUnauthorized !== undefined) {
        mergedConfig.tlsRejectUnauthorized = result.tlsRejectUnauthorized;
      }
      if (result.headers) {
        const staticHeaders = result.headers;
        interceptors.push({
          beforeRequest(ctx) {
            return { ...ctx, headers: { ...staticHeaders, ...ctx.headers } };
          },
        });
      }
    }

    const hookInterceptor: RequestInterceptor = {
      async beforeRequest(ctx) {
        const output = { headers: { ...ctx.headers }, body: { ...ctx.body } };
        await pluginManager.trigger('llm.request.before', 
          { headers: ctx.headers, body: ctx.body },
          output
        );
        return { ...ctx, headers: output.headers, body: output.body };
      },
    };
    interceptors.push(hookInterceptor);

    const adapter = new AIAdapter({
      model: mergedConfig.model as string,
      apiKey: mergedConfig.apiKey as string,
      baseURL: mergedConfig.baseURL as string | undefined,
      timeout: mergedConfig.timeout as { total?: number; firstToken?: number; chunk?: number } | undefined,
      tlsRejectUnauthorized: mergedConfig.tlsRejectUnauthorized as boolean | undefined,
      fetch: mergedConfig.fetch as ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined,
      interceptors,
    });

    return adapter;
  }
```

**Step 4: Update create() method to make it async-compatible**

The `createAdapter` is now async, so `create()` needs to be updated. Change the `create()` method signature and the adapter creation line:

```typescript
create(): Agent {
```

becomes:

```typescript
create(): Agent {
```

But since `createAdapter` is now async, we need to handle this. The cleanest approach: make `create()` return a Promise.

Replace the entire `create()` method:

```typescript
async create(): Promise<Agent> {
    const agentConfig =
      'agent' in this.config ? this.config.agent : validateAgentConfig(this.config);

    let modelConfig: ModelConfig;
    if ('model' in this.config && this.config.model && typeof this.config.model === 'object') {
      const cfgModel = this.config.model as Record<string, unknown>;
      modelConfig = {
        model: (cfgModel.model as string) || agentConfig.model,
        provider: (cfgModel.provider as string) ?? 'openai-compatible',
        apiKey: (cfgModel.apiKey as string) || agentConfig.apiKey,
        baseURL: (cfgModel.baseURL as string) || agentConfig.baseURL,
        temperature: (cfgModel.temperature as number) ?? agentConfig.temperature,
        maxTokens: (cfgModel.maxTokens as number) ?? agentConfig.maxTokens,
        timeout: cfgModel.timeout as { total?: number; firstToken?: number; chunk?: number } | undefined,
        tlsRejectUnauthorized: cfgModel.tlsRejectUnauthorized as boolean | undefined,
      };
    } else {
      modelConfig = {
        model: agentConfig.model,
        provider: 'openai-compatible',
        apiKey: agentConfig.apiKey,
        baseURL: agentConfig.baseURL,
        temperature: agentConfig.temperature,
        maxTokens: agentConfig.maxTokens,
      };
    }

    const pluginManager = this.options.pluginManager ?? new PluginManager();
    const adapter = this.options.adapter ?? await this.createAdapter(modelConfig, pluginManager);
    const history = this.options.history ?? this.createHistory();
    const registry = this.options.registry ?? this.createRegistry(agentConfig);

    const agent = new Agent(adapter, history, registry, {
      ...agentConfig,
      pluginManager,
      middleware: this.options.middleware,
    });

    this.log.info('Agent created successfully', { name: agentConfig.name });
    return agent;
  }
```

**Step 5: Update static methods and createAgent function**

```typescript
static async create(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Promise<Agent> {
    const factory = new AgentFactory(config, options);
    return factory.create();
  }

  static async fromConfig(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Promise<Agent> {
    return this.create(config, options);
  }
```

```typescript
export async function createAgent(
  config: AgentForgeConfig | AgentConfig,
  options?: AgentFactoryOptions
): Promise<Agent> {
  return AgentFactory.create(config, options);
}
```

**Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: May have errors in callers of `AgentFactory.create()` that now need `await`. Fix them.

**Step 7: Fix callers if needed**

Search for `AgentFactory.create`, `createAgent`, `factory.create()` calls and add `await`.

**Step 8: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 9: Commit**

```bash
git add src/agent/factory.ts
git commit -m "feat: integrate plugin provider into AgentFactory with hook bridging"
```

---

### Task 6: Export new types from index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Add ProviderContext and ProviderResult to plugin type exports**

Find the line:
```typescript
export type { Plugin, Hooks, HookEvent } from './plugin/types.js';
```

Replace with:
```typescript
export type { Plugin, Hooks, HookEvent, ProviderContext, ProviderResult } from './plugin/types.js';
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export ProviderContext and ProviderResult from public API"
```

---

### Task 7: Create Inferhub plugin example

**Files:**
- Create: `examples/inferhub-plugin.ts`
- Delete: `examples/inferhub-with-interceptors.ts` (replaced by this)

**Step 1: Create the plugin example**

```typescript
import type { Plugin, ProviderContext, ProviderResult } from '../src/index.js';

async function getW3Token(): Promise<string> {
  const token = process.env.X_AUTH_TOKEN || process.env.INFERHUB_AUTH_TOKEN || '';
  if (!token) {
    throw new Error('W3 token not found. Set X_AUTH_TOKEN or INFERHUB_AUTH_TOKEN environment variable.');
  }
  return token;
}

export const inferhubPlugin: Plugin = {
  name: 'inferhub',
  version: '1.0.0',

  async provider(ctx: ProviderContext): Promise<ProviderResult> {
    const token = await getW3Token();

    return {
      baseURL: process.env.INFERHUB_BASE_URL || 'https://ms-beta.devmate.huawei.com/codeAgent/chat/completions',
      tlsRejectUnauthorized: false,
      timeout: { total: 120000, firstToken: 60000, chunk: 30000 },
      headers: {
        'x-auth-token': token,
        'app-id': process.env.INFERHUB_APP_ID || 'CodeAgent2.0',
      },
      async fetch(input, init) {
        const currentToken = await getW3Token();
        const headers = new Headers(init?.headers);
        headers.set('x-auth-token', currentToken);
        return fetch(input, { ...init, headers });
      },
    };
  },

  hooks: {
    'llm.request.before': async (input, output) => {
      output.headers['x-snap-traceid'] = crypto.randomUUID();
      output.headers['x-session-id'] = process.env.INFERHUB_SESSION_ID || crypto.randomUUID();
      output.headers['oc-heartbeat'] = '1';
      output.body['tool_stream'] = true;
      output.body['oc-heartbeat'] = '1';
    },
  },
};
```

**Step 2: Delete old interceptor example**

Delete: `examples/inferhub-with-interceptors.ts`

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add examples/inferhub-plugin.ts
git rm examples/inferhub-with-interceptors.ts
git commit -m "docs: replace interceptor example with inferhub plugin example"
```

---

### Task 8: Final verification

**Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Run lint on changed files**

Run: `pnpm eslint src/plugin/types.ts src/plugin/manager.ts src/adapters/ai.ts src/agent/factory.ts src/index.ts`
Expected: PASS (no new errors)

**Step 3: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final cleanup for plugin provider feature"
```
