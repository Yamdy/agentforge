# Request Interceptor Pattern Refactoring

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor AIAdapter to support request interceptors, timeout control, and TLS configuration, eliminating the need for InferhubAdapter as a separate class.

**Architecture:** Extract the differentiating features of InferhubAdapter (custom fetch with header/body injection, timeout control, TLS bypass) into composable configuration on AIAdapter. InferhubAdapter and InferhubAuth move to examples/ as reference implementations.

**Tech Stack:** TypeScript, Zod, RxJS, Vercel AI SDK, @ai-sdk/openai-compatible, Vitest

---

### Task 1: Add RequestInterceptor and TimeoutConfig types to src/types.ts

**Files:**
- Modify: `src/types.ts`

**Step 1: Add new type definitions**

Add after the `LLMAdapter` type definition (around line 113):

```typescript
export interface RequestContext {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface RequestInterceptor {
  beforeRequest?(context: RequestContext): Promise<RequestContext> | RequestContext;
}

export interface TimeoutConfig {
  total?: number;
  firstToken?: number;
  chunk?: number;
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no references yet, just new types)

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add RequestInterceptor and TimeoutConfig types"
```

---

### Task 2: Write failing tests for AIAdapter interceptor support

**Files:**
- Create: `tests/adapters/ai-interceptor.test.ts`

**Step 1: Write tests for interceptor, timeout, and TLS config**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIAdapter } from '../../src/adapters/ai.js';
import type { RequestInterceptor, TimeoutConfig } from '../../src/types.js';

describe('AIAdapter with interceptors', () => {
  describe('constructor', () => {
    it('should accept interceptors config', () => {
      const interceptor: RequestInterceptor = {
        beforeRequest(ctx) {
          ctx.headers['x-custom'] = 'value';
          return ctx;
        },
      };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        interceptors: [interceptor],
      });
      expect(adapter).toBeDefined();
    });

    it('should accept timeout config', () => {
      const timeout: TimeoutConfig = {
        total: 60000,
        firstToken: 30000,
        chunk: 15000,
      };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        timeout,
      });
      expect(adapter).toBeDefined();
    });

    it('should accept tlsRejectUnauthorized config', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        tlsRejectUnauthorized: false,
      });
      expect(adapter).toBeDefined();
    });

    it('should accept custom fetch function', () => {
      const customFetch = vi.fn();
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        fetch: customFetch,
      });
      expect(adapter).toBeDefined();
    });
  });

  describe('interceptor execution', () => {
    it('should call beforeRequest interceptor', async () => {
      const beforeRequest = vi.fn((ctx) => ctx);
      const interceptor: RequestInterceptor = { beforeRequest };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        interceptors: [interceptor],
      });

      const fetchFn = (adapter as unknown as { createCustomFetch: () => (input: string | URL | Request, init?: RequestInit) => Promise<Response> }).createCustomFetch();
      expect(typeof fetchFn).toBe('function');
    });

    it('should support multiple interceptors in order', () => {
      const order: number[] = [];
      const interceptor1: RequestInterceptor = {
        beforeRequest(ctx) {
          order.push(1);
          return ctx;
        },
      };
      const interceptor2: RequestInterceptor = {
        beforeRequest(ctx) {
          order.push(2);
          return ctx;
        },
      };
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        interceptors: [interceptor1, interceptor2],
      });
      expect(adapter).toBeDefined();
    });
  });

  describe('timeout config', () => {
    it('should default to no timeout when not configured', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
      });
      expect(adapter).toBeDefined();
    });

    it('should accept partial timeout config', () => {
      const adapter = new AIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        timeout: { firstToken: 30000 },
      });
      expect(adapter).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/adapters/ai-interceptor.test.ts`
Expected: FAIL - AIAdapter constructor does not accept interceptors/timeout/tlsRejectUnauthorized/fetch

**Step 3: Commit**

```bash
git add tests/adapters/ai-interceptor.test.ts
git commit -m "test: add failing tests for AIAdapter interceptor support"
```

---

### Task 3: Implement AIAdapter with interceptor, timeout, and TLS support

**Files:**
- Modify: `src/adapters/ai.ts`

**Step 1: Update AIAdapterConfig interface**

Replace the existing `AIAdapterConfig` interface with:

```typescript
import * as https from 'node:https';
import type { RequestInterceptor, TimeoutConfig } from '../types.js';

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface AIAdapterConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
  useTools?: boolean;
  interceptors?: RequestInterceptor[];
  timeout?: TimeoutConfig;
  tlsRejectUnauthorized?: boolean;
  fetch?: FetchFn;
}
```

**Step 2: Add new private fields to AIAdapter class**

Add after existing private fields:

```typescript
  private interceptors: RequestInterceptor[];
  private timeout: TimeoutConfig;
  private tlsRejectUnauthorized: boolean;
  private customFetch: FetchFn | undefined;
```

**Step 3: Update constructor to initialize new fields**

```typescript
  constructor(config: AIAdapterConfig) {
    this.modelId = config.model;
    this.apiKey = config.apiKey || '';
    this.baseURL = config.baseURL || '';
    this.useTools = config.useTools ?? true;
    this.interceptors = config.interceptors ?? [];
    this.timeout = config.timeout ?? {};
    this.tlsRejectUnauthorized = config.tlsRejectUnauthorized ?? true;
    this.customFetch = config.fetch;
  }
```

**Step 4: Add createCustomFetch method**

Add as a private method (adapted from InferhubAdapter):

```typescript
  private createCustomFetch(): FetchFn {
    const interceptors = this.interceptors;
    const rejectUnauthorized = this.tlsRejectUnauthorized;
    const customFetch = this.customFetch;

    return async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);

      let body: Record<string, unknown> | undefined;
      if (init?.body && typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = undefined;
        }
      }

      if (interceptors.length > 0 && body) {
        const ctx: import('../types.js').RequestContext = {
          url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
          method: init?.method || 'POST',
          headers: Object.fromEntries(headers.entries()),
          body,
        };

        let result = ctx;
        for (const interceptor of interceptors) {
          if (interceptor.beforeRequest) {
            result = await interceptor.beforeRequest(result);
          }
        }

        for (const [key, value] of Object.entries(result.headers)) {
          headers.set(key, value);
        }
        body = result.body;
      }

      const newInit: RequestInit = {
        ...init,
        headers,
        body: body ? JSON.stringify(body) : init?.body,
      };

      if (!rejectUnauthorized) {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.startsWith('https://')) {
          const agent = new https.Agent({ rejectUnauthorized: false });
          const parsedUrl = new URL(urlStr);
          const nodeRequestOptions: https.RequestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: (newInit.method || 'POST') as string,
            headers: Object.fromEntries(headers.entries()),
            agent,
          };

          return new Promise<Response>((resolve, reject) => {
            const req = https.request(nodeRequestOptions, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                const responseBody = Buffer.concat(chunks);
                const responseHeaders = new Headers();
                for (const [key, value] of Object.entries(res.headers)) {
                  if (value) {
                    responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
                  }
                }
                resolve(new Response(responseBody, {
                  status: res.statusCode,
                  statusText: res.statusMessage,
                  headers: responseHeaders,
                }));
              });
            });
            req.on('error', reject);
            if (newInit.body) {
              req.write(newInit.body);
            }
            req.end();
          });
        }
      }

      const fetchImpl = customFetch ?? fetch;
      return fetchImpl(input, newInit);
    };
  }
```

**Step 5: Update createModel to use custom fetch**

Replace the existing `createModel` method:

```typescript
  private createModel() {
    const fetchFn = (this.interceptors.length > 0 || !this.tlsRejectUnauthorized || this.customFetch)
      ? this.createCustomFetch()
      : undefined;

    const provider = createOpenAICompatible({
      name: 'custom',
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      ...(fetchFn ? { fetch: fetchFn } : {}),
    });
    return provider(this.modelId);
  }
```

**Step 6: Update chatStream to support timeout**

Replace the existing `chatStream` method with timeout-aware version:

```typescript
  chatStream(messages: Message[]): Observable<StreamEvent> {
    return new Observable((observer) => {
      const model = this.createModel();
      const tools = this.useTools ? this.getTools() : {};

      const hasTimeout = this.timeout.firstToken || this.timeout.chunk || this.timeout.total;

      if (hasTimeout) {
        const firstTokenAbort = new AbortController();
        const chunkAbort = new AbortController();
        const overallAbort = new AbortController();

        let firstTokenTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let chunkTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let firstTokenReceived = false;

        const clearFirstTokenTimeout = () => {
          if (firstTokenTimeoutId) {
            clearTimeout(firstTokenTimeoutId);
            firstTokenTimeoutId = null;
          }
        };

        const resetChunkTimeout = () => {
          if (chunkTimeoutId) {
            clearTimeout(chunkTimeoutId);
          }
          if (this.timeout.chunk) {
            chunkTimeoutId = setTimeout(() => {
              chunkAbort.abort(`Timeout: no data received over ${this.timeout.chunk}ms`);
              overallAbort.abort();
            }, this.timeout.chunk);
          }
        };

        if (this.timeout.firstToken) {
          firstTokenTimeoutId = setTimeout(() => {
            firstTokenAbort.abort(`Timeout: no response received after ${this.timeout.firstToken}ms`);
            overallAbort.abort();
          }, this.timeout.firstToken);
        }

        if (this.timeout.total) {
          setTimeout(() => {
            overallAbort.abort(`Total timeout exceeded: ${this.timeout.total}ms`);
          }, this.timeout.total);
        }

        const result = streamText({
          model,
          messages: this.toModelMessages(messages) as Parameters<typeof streamText>[0]['messages'] & {},
          tools:
            this.useTools && Object.keys(tools).length > 0
              ? (tools as unknown as Parameters<typeof streamText>[0]['tools'])
              : undefined,
          maxRetries: 0,
          abortSignal: overallAbort.signal,
        });

        (async () => {
          try {
            for await (const event of result.fullStream) {
              if (observer.closed) break;

              if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearFirstTokenTimeout();
              }
              resetChunkTimeout();

              if (event.type === 'text-delta') {
                observer.next({ type: 'text', content: event.text });
              } else if (event.type === 'tool-call') {
                observer.next({
                  type: 'tool_call_start',
                  id: event.toolCallId,
                  name: event.toolName,
                });
                observer.next({
                  type: 'tool_call_delta',
                  id: event.toolCallId,
                  arguments: JSON.stringify(event.input),
                });
              } else if (event.type === 'tool-result') {
                const output =
                  typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
                observer.next({ type: 'tool_call_end', id: event.toolCallId, result: output });
              } else if (event.type === 'finish') {
                observer.next({
                  type: 'done',
                  response: {
                    content: null,
                    finishReason: event.finishReason as LLMResponse['finishReason'],
                    toolCalls: [],
                  },
                });
              }
            }
            clearFirstTokenTimeout();
            if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
            observer.complete();
          } catch (error) {
            clearFirstTokenTimeout();
            if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
            observer.error(error);
          }
        })();

        return () => {
          clearFirstTokenTimeout();
          if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
          overallAbort.abort();
        };
      }

      // No timeout - original behavior
      const result = streamText({
        model,
        messages: this.toModelMessages(messages) as Parameters<typeof streamText>[0]['messages'] & {},
        tools:
          this.useTools && Object.keys(tools).length > 0
            ? (tools as unknown as Parameters<typeof streamText>[0]['tools'])
            : undefined,
        maxRetries: 0,
      });

      (async () => {
        try {
          for await (const event of result.fullStream) {
            if (observer.closed) break;

            if (event.type === 'text-delta') {
              observer.next({ type: 'text', content: event.text });
            } else if (event.type === 'tool-call') {
              observer.next({
                type: 'tool_call_start',
                id: event.toolCallId,
                name: event.toolName,
              });
              observer.next({
                type: 'tool_call_delta',
                id: event.toolCallId,
                arguments: JSON.stringify(event.input),
              });
            } else if (event.type === 'tool-result') {
              const output =
                typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
              observer.next({ type: 'tool_call_end', id: event.toolCallId, result: output });
            } else if (event.type === 'finish') {
              observer.next({
                type: 'done',
                response: {
                  content: null,
                  finishReason: event.finishReason as LLMResponse['finishReason'],
                  toolCalls: [],
                },
              });
            }
          }
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      })();

      return () => {
        // cleanup
      };
    });
  }
```

**Step 7: Run tests**

Run: `pnpm vitest run tests/adapters/ai-interceptor.test.ts`
Expected: PASS

**Step 8: Run existing tests to verify no regression**

Run: `pnpm test:run`
Expected: All existing tests pass (inferhub tests will still reference old InferhubAdapter, that's OK for now)

**Step 9: Commit**

```bash
git add src/adapters/ai.ts
git commit -m "feat: add interceptor, timeout, and TLS support to AIAdapter"
```

---

### Task 4: Update config schema to support interceptors and remove inferhub-specific fields

**Files:**
- Modify: `src/config/schema.ts`

**Step 1: Update ModelConfigSchema**

Replace the existing `ModelConfigSchema`:

```typescript
export const ModelConfigSchema = z.object({
  model: z.string().default('gpt-4-turbo'),
  provider: z.string().default('openai-compatible'),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  timeout: z.object({
    total: z.number().optional(),
    firstToken: z.number().optional(),
    chunk: z.number().optional(),
  }).optional(),
  tlsRejectUnauthorized: z.boolean().optional(),
});
```

Note: Removed `token`, `appId`, `sessionId`, `enableOcHeartbeat`, `enableToolStream` (inferhub-specific). Added `timeout` and `tlsRejectUnauthorized` (generic). Changed `provider` from enum to string to allow custom provider names.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: May have errors in factory.ts due to removed fields, that's expected - will fix in Task 5

**Step 3: Commit**

```bash
git add src/config/schema.ts
git commit -m "refactor: update ModelConfigSchema - add timeout/tls, remove inferhub fields"
```

---

### Task 5: Update AgentFactory to remove InferhubAdapter dependency

**Files:**
- Modify: `src/agent/factory.ts`

**Step 1: Remove InferhubAdapter import and simplify factory**

Replace the entire file content with:

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
import type { Middleware } from '../middleware/index.js';
import { allTools } from '../tools/index.js';

export interface AgentFactoryOptions {
  adapter?: LLMAdapter;
  history?: HistoryManager;
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  middleware?: Middleware[];
  registerBuiltinTools?: boolean;
  interceptors?: RequestInterceptor[];
}

export class AgentFactory {
  private config: AgentForgeConfig | AgentConfig;
  private options: AgentFactoryOptions;
  private log = createLogger('agent-factory');

  constructor(config: AgentForgeConfig | AgentConfig, options: AgentFactoryOptions = {}) {
    this.config = config;
    this.options = {
      registerBuiltinTools: true,
      ...options,
    };
  }

  create(): Agent {
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

    const adapter = this.options.adapter ?? this.createAdapter(modelConfig);
    const history = this.options.history ?? this.createHistory();
    const registry = this.options.registry ?? this.createRegistry(agentConfig);
    const pluginManager = this.options.pluginManager ?? new PluginManager();

    const agent = new Agent(adapter, history, registry, {
      ...agentConfig,
      pluginManager,
      middleware: this.options.middleware,
    });

    this.log.info('Agent created successfully', { name: agentConfig.name });
    return agent;
  }

  private createAdapter(config: ModelConfig): LLMAdapter {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey && !config.baseURL) {
      this.log.warn(
        'No API key provided for LLM adapter. Set OPENAI_API_KEY environment variable or provide it in config.'
      );
    }

    return new AIAdapter({
      model: config.model,
      apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout,
      tlsRejectUnauthorized: config.tlsRejectUnauthorized,
      interceptors: this.options.interceptors,
    });
  }

  private createHistory(): HistoryManager {
    return new InMemoryHistory();
  }

  private createRegistry(_config: AgentConfig): ToolRegistry {
    const registry = new ToolRegistry();

    if (this.options.registerBuiltinTools) {
      registry.register(allTools);
      this.log.debug('Registered all built-in tools', { count: allTools.length });
    }

    return registry;
  }

  static create(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Agent {
    const factory = new AgentFactory(config, options);
    return factory.create();
  }

  static fromConfig(config: AgentForgeConfig | AgentConfig, options?: AgentFactoryOptions): Agent {
    return this.create(config, options);
  }
}

export function createAgent(
  config: AgentForgeConfig | AgentConfig,
  options?: AgentFactoryOptions
): Agent {
  return AgentFactory.create(config, options);
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run factory tests**

Run: `pnpm vitest run tests/agent/factory.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/agent/factory.ts
git commit -m "refactor: remove InferhubAdapter from factory, use interceptors"
```

---

### Task 6: Update src/index.ts exports

**Files:**
- Modify: `src/index.ts`

**Step 1: Remove InferhubAdapter/InferhubAuth exports, add new type exports**

Remove these lines:
```typescript
export { InferhubAdapter } from './adapters/inferhub.js';
export type { InferhubAdapterConfig } from './adapters/inferhub.js';
export { InferhubAuth } from './adapters/inferhub-auth.js';
export type { InferhubAuthConfig, AuthToken } from './adapters/inferhub-auth.js';
```

Add `RequestInterceptor`, `RequestContext`, `TimeoutConfig` to the types export line:
```typescript
export type {
  Message,
  Tool,
  ToolCall,
  ToolParameters,
  ToolResult,
  LLMResponse,
  StreamEvent,
  LLMAdapter,
  HistoryManager,
  TaskStatus,
  TaskState,
  Schemas,
  RequestInterceptor,
  RequestContext,
  TimeoutConfig,
} from './types.js';
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: May have errors in inferhub test files that still import removed exports - that's expected

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: remove inferhub exports, add interceptor type exports"
```

---

### Task 7: Create Inferhub example using interceptor pattern

**Files:**
- Create: `examples/inferhub-with-interceptors.ts`

**Step 1: Write the example**

```typescript
/**
 * Inferhub adapter example using the RequestInterceptor pattern.
 * This demonstrates how to connect to any OpenAI Compatible service
 * with custom authentication, headers, and body injection.
 */
import { AIAdapter, createAgent, type RequestInterceptor } from '../src/index.js';

const inferhubInterceptor: RequestInterceptor = {
  beforeRequest(ctx) {
    ctx.headers['app-id'] = 'CodeAgent2.0';
    ctx.headers['x-auth-token'] = ctx.headers['authorization']?.replace('Bearer ', '') || '';
    ctx.headers['oc-heartbeat'] = '1';
    ctx.headers['x-session-id'] = crypto.randomUUID();
    ctx.headers['x-snap-traceid'] = crypto.randomUUID();
    delete ctx.headers['authorization'];

    ctx.body['tool_stream'] = true;
    ctx.body['oc-heartbeat'] = '1';

    return ctx;
  },
};

const adapter = new AIAdapter({
  model: 'deepseek-v3',
  apiKey: process.env.X_AUTH_TOKEN || process.env.INFERHUB_AUTH_TOKEN || '',
  baseURL: process.env.INFERHUB_BASE_URL || 'https://ms-beta.devmate.huawei.com/codeAgent',
  interceptors: [inferhubInterceptor],
  timeout: {
    firstToken: 300000,
    chunk: 300000,
  },
  tlsRejectUnauthorized: false,
});

const agent = createAgent(
  { name: 'inferhub-agent', model: 'deepseek-v3' },
  { adapter }
);

agent.runStream('Hello, how are you?').subscribe({
  next: (event) => {
    if (event.type === 'text') {
      process.stdout.write(event.content);
    }
  },
  complete: () => console.log('\nDone!'),
  error: (err) => console.error('Error:', err),
});
```

**Step 2: Run typecheck on example**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add examples/inferhub-with-interceptors.ts
git commit -m "docs: add inferhub interceptor example"
```

---

### Task 8: Remove InferhubAdapter and InferhubAuth source files

**Files:**
- Delete: `src/adapters/inferhub.ts`
- Delete: `src/adapters/inferhub-auth.ts`
- Delete: `tests/inferhub-adapter.test.ts`
- Delete: `tests/adapters/inferhub-auth.test.ts`
- Delete: `src/examples/inferhub-demo.ts`
- Delete: `src/examples/inferhub-simple.ts`
- Delete: `examples/INFERHUB_DEMO.md`
- Delete: `examples/inferhub-config.md`
- Delete: `INFERHUB_IMPLEMENTATION.md`
- Delete: `docs/plans/2026-04-11-inferhub-integration.md`

**Step 1: Delete the files**

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no remaining references)

**Step 3: Run all tests**

Run: `pnpm test:run`
Expected: All tests pass (inferhub tests removed, other tests unaffected)

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove InferhubAdapter/InferhubAuth, inferhub examples and docs"
```

---

### Task 9: Remove demo:inferhub script from package.json

**Files:**
- Modify: `package.json`

**Step 1: Remove the script line**

Remove: `"demo:inferhub": "tsx src/examples/inferhub-demo.ts"`

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: remove demo:inferhub script"
```

---

### Task 10: Final verification

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS with 0 errors

**Step 2: Run all tests**

Run: `pnpm test:run`
Expected: All tests pass

**Step 3: Run lint**

Run: `pnpm lint`
Expected: No errors

**Step 4: Run build**

Run: `pnpm build`
Expected: Build succeeds
