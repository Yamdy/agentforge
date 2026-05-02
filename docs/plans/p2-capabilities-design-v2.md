# AgentForge 能力扩展设计（修正版 v2）

> 设计时间：2026-04-28
> 设计原则：扩展现有架构，不创建平行系统
> 状态：待审查

---

## 一、核心问题：定位错误

### 原设计的错误

原设计（p2-capabilities-design.md）创建了三个"能力模块"：
- `HttpCapability` - 接收 `agent` 实例，包裹 Agent
- `ObservabilityCapability` - 包装已有的 `Tracer`/`Metrics` 接口
- `RemoteCapability` - 重复已有的 A2A 子系统

**问题**：这与 AgentForge 的 DI 模式矛盾。

### AgentForge 的 DI 模式

```
AgentContext（会话级）
├── llm: LLMAdapter
├── tools: ToolRegistry
├── memory: Memory
├── tracer?: Tracer          ← 可选，通过 DI 注入
├── metrics?: Metrics        ← 可选，通过 DI 注入
├── quota?: QuotaController  ← 可选，通过 DI 注入
└── ...

Agent Loop 通过 ctx.tracer?.startSpan() 调用
不需要额外的包装层
```

**正确的做法**：能力应该是 `AgentContext` 上的可选字段，由 `createAgent()` 在构建 Context 时注入，Agent Loop 在运行时通过 `ctx.xxx?.method()` 调用。

---

## 二、正确架构

```
Agent（核心）                      AgentForge 框架
├── createAgent(config)            核心 API
├── Agent.run()                    Promise<string>
├── AgentContext                   DI 注入点（tracer?, metrics?, quota?, ...）
└── Plugin 系统                    InterceptorPlugin + ObserverPlugin

Server 包 (@agentforge/server)    让 Agent 可被 HTTP 调用
├── createAgentForgeServer()       已设计（Phase 0）
├── HonoAdapter                    本设计的增量
└── ExpressAdapter                 本设计的增量

Client 包 (@agentforge/client)    让外部应用调用 Agent
├── AgentForgeClient               本设计
└── React hooks (useAgentForge)   本设计

Observability 实现                让 Agent 可被追踪
├── OtelTracer                     实现已有 Tracer 接口
├── PrometheusMetricsCollector    实现已有 Metrics 接口
└── createAgentTracer()            Agent Loop 追踪操作符

A2A 子系统                         让 Agent 可被远程调用
├── A2AClient                     已有设计
└── A2AServer                      已有设计
```

**关键区别**：不是"创建能力模块包裹 Agent"，而是"已有框架体系中的接口实现 + 独立 Server/Client 包 + Observability 接口的具体实现"。

---

## 三、各模块正确实现位置

### 3.1 HTTP 能力 → 扩展 `@agentforge/server`

**不是**：创建新的 `capabilities/http` 包
**而是**：扩展已有的 `@agentforge/server` 包，添加 Hono/Express 适配器

```typescript
// packages/server/src/server.ts

import type { HttpAdapter } from './adapters/interfaces.js';

export interface ServerOptions {
  /** HTTP 框架适配器 */
  adapter?: 'node-http' | 'hono' | 'express';
  
  /** 端口 */
  port?: number;
  
  /** 配置目录 */
  configDir: string;
  
  // ... 其他选项
}

export function createAgentForgeServer(options: ServerOptions) {
  const adapter = createAdapter(options.adapter ?? 'node-http');
  
  return {
    start: () => adapter.start(options.port ?? 3000),
    stop: () => adapter.stop(),
    // ...
  };
}
```

**新增文件**：
```
packages/server/src/
├── adapters/
│   ├── interfaces.ts        # HttpAdapter 接口
│   ├── node-http.ts         # 已有实现
│   ├── hono.ts              # 新增：Hono 适配器
│   └── express.ts           # 新增：Express 适配器
```

### 3.2 可观测性 → 实现已有接口

**不是**：创建新的 `capabilities/observability` 包
**而是**：在 `src/observability/` 下实现已有的 `Tracer`/`Metrics` 接口

```typescript
// src/observability/otel-tracer.ts

import type { Tracer, Span, SpanOptions } from '../core/interfaces.js';

/**
 * OpenTelemetry Tracer 实现
 *
 * 实现 AgentForge 已有的 Tracer 接口
 * 通过 ContextBuilder.withTracer(otelTracer) 注入
 */
export class OtelTracer implements Tracer {
  readonly name = 'opentelemetry';
  
  startSpan(name: string, options?: SpanOptions): Span {
    // ... OTel 实现
  }
  
  // ... 其他方法
}

// src/observability/prometheus-metrics.ts

import type { Metrics } from '../core/interfaces.js';

/**
 * Prometheus Metrics 实现
 *
 * 实现 AgentForge 已有的 Metrics 接口
 * 通过 ContextBuilder.withMetrics(prometheusMetrics) 注入
 */
export class PrometheusMetricsCollector implements Metrics {
  // ... 实现
}
```

**使用方式**：
```typescript
import { createAgent, ContextBuilder } from 'agentforge';
import { OtelTracer, PrometheusMetricsCollector } from 'agentforge/observability';

// 方式 1：通过 createAgent 配置
const agent = createAgent({
  name: 'my-agent',
  model: { provider: 'openai', model: 'gpt-4o' },
  observability: {
    tracer: new OtelTracer({ serviceName: 'my-agent' }),
    metrics: new PrometheusMetricsCollector(),
  },
});

// 方式 2：通过 ContextBuilder（L3 API）
const ctx = new ContextBuilder()
  .withTracer(new OtelTracer({ serviceName: 'my-agent' }))
  .withMetrics(new PrometheusMetricsCollector())
  .build();
```

**新增文件**：
```
src/observability/
├── otel-tracer.ts           # OtelTracer 实现 Tracer 接口
├── prometheus-metrics.ts    # PrometheusMetricsCollector 实现 Metrics 接口
├── agent-tracer.ts          # createAgentTracer() 操作符
└── index.ts                 # 导出
```

### 3.3 远程调用 → 使用已有 A2A 子系统

**不是**：创建新的 `capabilities/remote` 包
**而是**：使用已有的 `src/a2a/` 子系统

```typescript
// 已有设计，不需要新增

import { createA2AServer, createA2AClient } from 'agentforge/a2a';

// 让 Agent 可被远程调用
const a2aServer = createA2AServer(agent, { port: 3001 });

// 调用远程 Agent
const a2aClient = createA2AClient('http://localhost:3001');
const result = await a2aClient.call(agentCard, 'Hello');
```

### 3.4 客户端 SDK → 独立包

**正确**：这是一个独立的客户端包，让外部应用调用 Agent

```typescript
// packages/client-js/src/client.ts

export class AgentForgeClient {
  constructor(options: { baseUrl: string; apiKey?: string }) {}
  
  async chat(sessionId: string, message: string): Promise<ApiResponse> {}
  chatStream(sessionId: string, message: string): AsyncGenerator<SseEvent> {}
  // ...
}
```

**新增文件**：
```
packages/client-js/
├── src/
│   ├── client.ts
│   ├── types.ts
│   └── index.ts
└── package.json
```

---

## 四、正确 vs 错误对比

| 模块 | 错误设计 | 正确设计 |
|------|---------|---------|
| **HTTP** | `capabilities/http` 包 + `HttpCapability` 接口 | 扩展 `@agentforge/server` + `HonoAdapter` |
| **OTel** | `capabilities/observability` 包 + `ObservabilityCapability` 接口 | `src/observability/otel-tracer.ts` 实现已有 `Tracer` 接口 |
| **远程调用** | `capabilities/remote` 包 + `RemoteCapability` 接口 | 使用已有 `src/a2a/` 子系统 |
| **客户端** | 作为"能力模块"的一部分 | 独立的 `@agentforge/client` 包 |

---

## 五、Phase 1 详细设计：Tracer 接口扩展

### 5.1 已有 Tracer 接口（当前）

```typescript
// src/core/interfaces.ts（当前）

export interface Tracer {
  startSpan(name: string, options?: { attributes?: Record<string, unknown>; parent?: string }): string;
  endSpan(spanId: string, options?: { code?: string }): void;
  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void;
  recordException(spanId: string, error: Error): void;
}
```

**特点**：
- `startSpan` 返回 `string`（span ID）
- 所有方法都接收 `spanId` 字符串
- 无状态管理（span 生命周期由调用方管理）

### 5.2 扩展后的 Tracer 接口（目标）

```typescript
// src/core/interfaces.ts（扩展后）

export interface Tracer {
  /** 追踪器名称 */
  readonly name: string;

  /** 开始一个新的 Span */
  startSpan(name: string, options?: SpanOptions): Span;

  /** 获取当前活跃 Span */
  getActiveSpan(): Span | undefined;

  /** 记录事件（关联到当前 Span） */
  recordEvent(name: string, attributes?: Record<string, unknown>): void;

  /** 记录异常（关联到当前 Span） */
  recordException(error: Error, attributes?: Record<string, unknown>): void;

  /** 关闭追踪器（清理资源） */
  shutdown(): Promise<void>;
}

export interface Span {
  /** Span ID */
  readonly spanId: string;

  /** Trace ID */
  readonly traceId: string;

  /** 设置属性 */
  setAttribute(key: string, value: unknown): void;

  /** 添加事件 */
  addEvent(name: string, attributes?: Record<string, unknown>): void;

  /** 记录异常 */
  recordException(error: Error): void;

  /** 设置状态 */
  setStatus(status: SpanStatus): void;

  /** 结束 Span */
  end(): void;
}

export type SpanStatus = 'ok' | 'error' | 'unset';

export interface SpanOptions {
  /** 父 Span */
  parent?: Span;
  /** Span 属性 */
  attributes?: Record<string, unknown>;
  /** Span 类型 */
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
}
```

### 5.3 迁移策略

**问题**：`startSpan` 返回类型从 `string` 改为 `Span`，会影响所有已有调用点。

**方案 A：渐进式迁移（推荐）**

```typescript
// 步骤 1：添加 Span 接口，但不修改 Tracer
export interface Span { ... }

// 步骤 2：添加新的 TracerV2 接口
export interface TracerV2 {
  startSpan(name: string, options?: SpanOptions): Span;
  // ...
}

// 步骤 3：OtelTracer 实现 TracerV2
export class OtelTracer implements TracerV2 { ... }

// 步骤 4：更新 AgentContext 类型，支持两种 Tracer
export interface AgentContext {
  tracer?: Tracer | TracerV2;
  // ...
}

// 步骤 5：Agent Loop 中检测并适配
if (ctx.tracer && 'startSpan' in ctx.tracer) {
  // 新接口
  const span = ctx.tracer.startSpan('name');
} else if (ctx.tracer) {
  // 旧接口
  const spanId = ctx.tracer.startSpan('name');
}

// 步骤 6：逐步迁移所有调用点
// 步骤 7：废弃旧接口
```

**方案 B：直接迁移（如果调用点少）**

```typescript
// 直接修改 Tracer 接口
// 更新所有调用点
// 一次性完成
```

**建议**：先统计已有 `Tracer` 的调用点数量，再决定用哪种方案。

### 5.4 已有调用点清单

**源代码中的 Tracer 类型引用**（6 个文件）：
- `src/core/interfaces.ts` - 接口定义
- `src/core/context.ts` - AgentContext 类型
- `src/core/index.ts` - 导出
- `src/api/context-builder.ts` - ContextBuilder.withTracer()
- `src/plugins/plugin.ts` - PluginContext 类型
- `src/index.ts` - 统一导出

**测试中的 Mock 实现**（3 个文件）：
- `tests/plugins/plugins.test.ts` - mockTracer
- `tests/operators/presets.test.ts` - createMockTracer()
- `tests/operators/notify.test.ts` - createMockTracer()

**实际调用点**：0 个（源代码中没有 `tracer.startSpan()` 调用）

**结论**：迁移范围可控。只需更新接口定义和类型引用，不需要修改业务逻辑。

---

## 六、实施计划

### Phase 1: OTel Tracer 实现（1 周）

```
src/observability/
├── otel-tracer.ts           # 实现 Tracer 接口
├── prometheus-metrics.ts    # 实现 Metrics 接口
├── agent-tracer.ts          # createAgentTracer() 操作符
└── index.ts
```

**接口扩展**：
- 扩展 `src/core/interfaces.ts` 中的 `Tracer` 接口（添加 `recordEvent`、`recordException`、`shutdown`）
- 扩展 `AgentConfig` 添加 `observability` 配置选项

### Phase 2: Hono 适配器（1 周）

```
packages/server/src/
├── adapters/
│   ├── interfaces.ts        # HttpAdapter 接口
│   ├── hono.ts              # Hono 适配器
│   └── express.ts           # Express 适配器
```

**接口设计**：
- `createAgentForgeServer({ adapter: 'hono' })`

### Phase 3: 客户端 SDK（3 天）

```
packages/client-js/
├── src/
│   ├── client.ts
│   ├── types.ts
│   └── index.ts
└── package.json
```

### Phase 4: Express 适配器（3 天）

扩展 Phase 2 的适配器接口。

---

## 六、设计原则总结

1. **扩展现有，不创建平行**：新功能应该扩展已有的接口和包，而不是创建新的"能力模块"
2. **DI 注入，不包裹 Agent**：能力通过 `AgentContext` 注入，不是包裹 `agent` 实例
3. **接口实现，不是新接口**：`OtelTracer` 实现 `Tracer` 接口，不是创建 `ObservabilityCapability` 接口
4. **独立包，不是能力模块**：Client SDK 是独立的 `@agentforge/client` 包，不是"能力模块"

---

*设计完成时间：2026-04-28*
*核心原则：扩展现有架构，不创建平行系统*
