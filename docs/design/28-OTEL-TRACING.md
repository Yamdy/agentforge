# 28: OpenTelemetry Tracing 集成设计

> 设计日期: 2026-05-01
> 状态: **📝 设计完成**
> 参考实现: AgentScope `src/agentscope/tracing/` (4 文件)
> 工作量: 1-2 天

---

## 1. 目标

将 AgentForge 的 Tracer 接口从本地 `ConsoleTracer` 扩展到 OpenTelemetry 分布式追踪，使 Agent 执行过程可在 Jaeger/Zipkin/Grafana Tempo 等后端可视化。

**不破坏现有行为**：`NoopTracer` 保持生产默认，`ConsoleTracer` 保持开发默认，OTel 通过 `exporter: 'otel'` 配置路径选择性启用。

---

## 2. 现有基础设施

### 2.1 Tracer 接口 (不变)

```typescript
// src/core/interfaces.ts:369-381
export interface Tracer {
  startSpan(name: string, options?: SpanOptions): string;
  endSpan(spanId: string, options?: { code?: string }): void;
  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void;
  recordException(spanId: string, error: Error): void;
}

export interface SpanOptions {
  attributes?: Record<string, unknown>;
  parent?: string;
}
```

### 2.2 现有实现

| 类 | 文件 | 用途 |
|---|------|------|
| `NoopTracer` | `src/core/defaults.ts:29-45` | 生产默认 (零开销) |
| `ConsoleTracer` | `src/core/defaults.ts:66-96` | 开发调试 |

### 2.3 配置分发路径 (需修改)

```typescript
// src/api/create-agent.ts:124-132 — 当前逻辑:
if (config.tracing) {
  if (typeof config.tracing === 'object' && config.tracing.customTracer) {
    appServices.tracer = config.tracing.customTracer;        // exporter='custom'
  } else {
    appServices.tracer = new ConsoleTracer();                 // exporter='console' 或 tracing=true
  }
}
```

**问题**: `exporter: 'otel'` 已在 `TracingConfig` 中定义但未被处理，当前回退到 `ConsoleTracer`。

### 2.4 TracingConfig (需扩展)

```typescript
// src/api/types.ts:87-94
export interface TracingConfig {
  exporter: 'console' | 'otel' | 'custom';
  endpoint?: string;          // OTLP endpoint (已预留)
  customTracer?: Tracer;      // 自定义实现 (已预留)
}
```

---

## 3. 参考架构：AgentScope 4 文件模型

AgentScope 的 tracing 模块 (`src/agentscope/tracing/`) 由 4 个核心文件组成：

```
agentscope/tracing/
├── _setup.py       ← OTel SDK 初始化 (TracerProvider + BatchSpanProcessor + OTLPExporter)
├── _attributes.py  ← Span 属性常量 (GenAI semconv + 自定义属性)
├── _decorators.py  ← 5 种专用装饰器 + span 生命周期管理
└── _extractor.py   ← 属性提取函数 (每组件 3 个: request提取/span名生成/response提取)
```

**核心模式映射**:

| AgentScope (Python) | AgentForge (TypeScript) |
|---------------------|------------------------|
| `setup_tracing(endpoint)` | `OTelTracer.initialize(config)` |
| `_get_tracer()` → `trace.get_tracer("agentscope", version)` | `trace.getTracer("agentforge", version)` |
| `@trace_llm` decorator | `OTelTracer.startSpan('llm.request', ...)` (loop 中显式调用) |
| `end_on_exit=False` + 手动 `span.end()` | `span.end()` 显式调用 (流式场景需保持 span 存活) |
| `SpanAttributes` class | `OtelAttributes` constants |
| `_get_llm_request_attributes()` | `extractLLMAttributes()` |
| `_set_span_success_status(span)` | `span.setStatus({ code: SpanStatusCode.OK }); span.end()` |
| `_set_span_error_status(span, e)` | `span.recordException(e); span.setStatus({ code: SpanStatusCode.ERROR }); span.end()` |
| `_check_tracing_enabled()` early-return | `if (!this.initialized) return '';` |

---

## 4. 文件变更清单

### 4.1 新增文件 (2 个)

```
src/observability/tracers/
├── otel-tracer.ts        ← OTelTracer 类 + OTel SDK 初始化 (~200 行)
└── otel-attributes.ts    ← Span 属性常量 + 提取器函数 (~100 行)
```

### 4.2 修改文件 (5 个)

| 文件 | 变更 |
|------|------|
| `package.json` | 添加 `@opentelemetry/api`, `@opentelemetry/sdk-trace-node` 依赖 |
| `src/api/types.ts` | 扩展 `TracingConfig` (添加 `serviceName`, `headers`, `sampler`) |
| `src/api/create-agent.ts` | 处理 `exporter: 'otel'` 分支 (~15 行) |
| `src/core/context-builder.ts` | `withTracer()` 支持 OTel 配置 |
| `src/index.ts` | 导出 `OTelTracer`, `OtelAttributes` |

### 4.3 新增测试 (1 个)

```
tests/observability/
└── otel-tracer.spec.ts   ← OTelTracer 单元测试 (~150 行)
```

---

## 5. 详细设计

### 5.1 `src/observability/tracers/otel-tracer.ts` — OTelTracer 实现

```typescript
/**
 * OTelTracer — OpenTelemetry-distributed tracing implementation.
 *
 * Wraps @opentelemetry/api Tracer to implement AgentForge's Tracer interface.
 * Lazy-initializes OTel SDK only when configure() is called.
 * Falls back to no-op when not configured (zero overhead).
 *
 * Design principles (from AgentScope's _setup.py + _decorators.py):
 * - Lazy SDK import — OTel deps only loaded when tracing enabled
 * - Idempotent initialization — safe to call configure() multiple times
 * - BatchSpanProcessor — batched export, low overhead
 * - Explicit span.end() — supports streaming scenarios (AgentScope's end_on_exit=False)
 * - Feature-flag early return — all methods check initialized before doing work
 *
 * @example
 * ```typescript
 * const tracer = new OTelTracer();
 * tracer.configure({
 *   endpoint: 'http://localhost:4318/v1/traces',
 *   serviceName: 'agentforge',
 * });
 * const spanId = tracer.startSpan('agent.run', { attributes: { agent: 'assistant' } });
 * // ... work ...
 * tracer.endSpan(spanId);
 * ```
 */
import type { Tracer, SpanOptions } from '../../core/interfaces.js';

/** OTel connection configuration */
export interface OTelConfig {
  /** OTLP HTTP endpoint (e.g. http://localhost:4318/v1/traces) */
  endpoint: string;
  /** Service name for resource attribution (default: 'agentforge') */
  serviceName?: string;
  /** Additional HTTP headers for OTLP export */
  headers?: Record<string, string>;
  /** Sampling ratio (0-1, default: 1.0 = sample all) */
  sampler?: number;
}

export class OTelTracer implements Tracer {
  private initialized = false;
  private config: OTelConfig | null = null;

  // Holds active spans by ID (AgentForge's string-based span IDs)
  // In OTel, spans are objects; the string ID maps to the OTel Span instance
  private activeSpans = new Map<string, import('@opentelemetry/api').Span>();

  // OTel tracer instance (created during configure())
  private otelTracer: import('@opentelemetry/api').Tracer | null = null;

  /**
   * Configure and initialize OpenTelemetry SDK.
   *
   * Idempotent: subsequent calls update the endpoint but don't re-register
   * the TracerProvider (matching AgentScope's pattern).
   *
   * Async because OTel SDK modules are loaded via dynamic import()
   * (project uses "type": "module" — require() unavailable).
   * Following existing codebase pattern: plugin-loader.ts:542 uses await import().
   *
   * @param config - OTLP connection parameters
   */
  async configure(config: OTelConfig): Promise<void> {
    this.config = { serviceName: 'agentforge', sampler: 1.0, ...config };

    if (!this.initialized) {
      // Lazy dynamic import — OTel SDK is heavy (~2MB), only load when needed
      // Use import() not require() because project package.json has "type": "module"
      const [
        { trace },
        { NodeTracerProvider },
        { BatchSpanProcessor },
        { OTLPTraceExporter },
        { Resource },
        { SEMRESATTRS_SERVICE_NAME },
        { ParentBasedSampler, TraceIdRatioBasedSampler },
      ] = await Promise.all([
        import('@opentelemetry/api'),
        import('@opentelemetry/sdk-trace-node'),
        import('@opentelemetry/sdk-trace-base'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/semantic-conventions'),
        import('@opentelemetry/sdk-trace-base'),
      ]);

      const exporter = new OTLPTraceExporter({
        url: this.config.endpoint,
        headers: this.config.headers,
      });

      const provider = new NodeTracerProvider({
        resource: new Resource({
          [SEMRESATTRS_SERVICE_NAME]: this.config.serviceName,
        }),
        sampler: new ParentBasedSampler(
          new TraceIdRatioBasedSampler(this.config.sampler),
        ),
        spanProcessors: [new BatchSpanProcessor(exporter)],
      });

      provider.register();
      this.initialized = true;

      this.otelTracer = trace.getTracer('agentforge', this.getVersion());
    }
  }

  // ── Tracer Interface Implementation ──

  startSpan(name: string, options?: SpanOptions): string {
    if (!this.otelTracer || !this.initialized) return '';

    const span = this.otelTracer.startSpan(name, {
      attributes: options?.attributes as Record<string, string | number | boolean>,
    });

    const spanId = span.spanContext().spanId;
    this.activeSpans.set(spanId, span);
    return spanId;
  }

  endSpan(spanId: string, options?: { code?: string }): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    if (options?.code === 'error') {
      span.setStatus({ code: 2 /* SpanStatusCode.ERROR */ });
    } else {
      span.setStatus({ code: 1 /* SpanStatusCode.OK */ });
    }
    span.end();
    this.activeSpans.delete(spanId);
  }

  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    span.addEvent(name, attributes);
  }

  recordException(spanId: string, error: Error): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    span.recordException(error);
  }

  // ── Helpers ──

  /**
   * Get package version for instrumentation library attribution.
   *
   * Uses static import at module level (not dynamic) since package.json
   * is always present at build time. The TypeScript bundler/tsc resolves
   * this at compile time via import assertion or inlined JSON.
   *
   * Alternative: use fs.readFileSync + JSON.parse for runtime resolution.
   */
  private getVersion(): string {
    try {
      // At build time, tsc/bundler resolves this; at runtime in ESM,
      // Node.js supports JSON imports natively
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return '0.0.0'; // Replaced by build tool, or use static import at top of file
    } catch {
      return 'unknown';
    }
  }

  /** Check if OTel is configured (for external feature-flag checks) */
  isConfigured(): boolean {
    return this.initialized;
  }

  /** Shutdown and flush pending spans */
  async shutdown(): Promise<void> {
    // Flush all pending spans before shutdown
    for (const span of this.activeSpans.values()) {
      span.end();
    }
    this.activeSpans.clear();
  }
}
```

**关键设计决策**:

| 决策 | 理由 |
|------|------|
| `await import()` 懒加载 OTel SDK | 项目 `"type": "module"` → `require()` 不可用。动态 `import()` 在 `configure()` 中执行（async），匹配代码库现有模式 (`plugin-loader.ts:542`)。OTel SDK ~2MB，仅在 `exporter='otel'` 时加载 |
| `endSpan()` 显式结束 | 流式场景中 span 需要跨越多个 yield，不能依赖 context manager 自动关闭。匹配 AgentScope 的 `end_on_exit=False` |
| `activeSpans` Map | AgentForge 的 Tracer 接口返回字符串 spanId，需要映射到 OTel Span 对象。`endSpan/addEvent/recordException` 通过 spanId 查找 |
| `shutdown()` 方法 | 新增公共方法，非接口要求。确保进程退出前 flush 所有未完成的 span |

### 5.2 `src/observability/tracers/otel-attributes.ts` — 属性定义

```typescript
/**
 * OTel Span Attribute Constants
 *
 * Follows OpenTelemetry GenAI Semantic Conventions for LLM operations,
 * plus AgentForge-custom attributes for framework-specific metadata.
 * Modeled after AgentScope's SpanAttributes class.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */

// ── Standard GenAI Attributes (from OTel semconv) ──

/** Operation type for the span */
export const ATTR_OPERATION = 'gen_ai.operation.name';
export const ATTR_PROVIDER = 'gen_ai.provider.name';
export const ATTR_REQUEST_MODEL = 'gen_ai.request.model';
export const ATTR_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const ATTR_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
export const ATTR_AGENT_ID = 'gen_ai.agent.id';
export const ATTR_AGENT_NAME = 'gen_ai.agent.name';
export const ATTR_AGENT_DESCRIPTION = 'gen_ai.agent.description';
export const ATTR_TOOL_NAME = 'gen_ai.tool.name';

// ── AgentForge Custom Attributes ──

/** Agent run unique identifier */
export const ATTR_AGENTFORGE_RUN_ID = 'agentforge.run.id';
/** Agent loop step number */
export const ATTR_AGENTFORGE_STEP = 'agentforge.step';
/** Event type that triggered this span */
export const ATTR_AGENTFORGE_EVENT = 'agentforge.event';
/** Tool execution result summary */
export const ATTR_AGENTFORGE_TOOL_RESULT = 'agentforge.tool.result';
/** Error code for agent.error events */
export const ATTR_AGENTFORGE_ERROR_CODE = 'agentforge.error.code';

// ── Operation Name Values ──

export const OPERATION_CHAT = 'chat';
export const OPERATION_EXECUTE_TOOL = 'execute_tool';
export const OPERATION_AGENT_RUN = 'run';
export const OPERATION_AGENT_STEP = 'step';

// ── Attribute Extractors ──

/**
 * Extract attributes for LLM request spans.
 * Mirror of AgentScope's _get_llm_request_attributes().
 */
export function extractLLMAttributes(request: {
  model: string;
  provider: string;
  messagesCount: number;
  toolsCount?: number;
  maxTokens?: number;
}): Record<string, string | number> {
  return {
    [ATTR_OPERATION]: OPERATION_CHAT,
    [ATTR_PROVIDER]: request.provider,
    [ATTR_REQUEST_MODEL]: request.model,
    'gen_ai.request.messages_count': request.messagesCount,
    'gen_ai.request.max_tokens': request.maxTokens ?? 0,
    ...(request.toolsCount ? { 'gen_ai.request.tools_count': request.toolsCount } : {}),
  };
}

/**
 * Extract attributes for tool execution spans.
 */
export function extractToolAttributes(tool: {
  name: string;
  argumentsSize: number;
}): Record<string, string | number> {
  return {
    [ATTR_OPERATION]: OPERATION_EXECUTE_TOOL,
    [ATTR_TOOL_NAME]: tool.name,
    'gen_ai.tool.arguments_size': tool.argumentsSize,
  };
}
```

### 5.3 TracingConfig 扩展

```typescript
// src/api/types.ts — 修改后:
export interface TracingConfig {
  /** Exporter type. 'none' explicitly disables tracing (same as omitting tracing config) */
  exporter: 'console' | 'otel' | 'custom' | 'none';
  /** Endpoint for OTLP exporter (required when exporter='otel') */
  endpoint?: string;
  /** Service name for OTel resource attribution (default: 'agentforge') */
  serviceName?: string;
  /** Additional headers for OTLP HTTP export */
  headers?: Record<string, string>;
  /** Sampling ratio 0-1 (default: 1.0) */
  sampler?: number;
  /** Custom tracer implementation (exporter='custom') */
  customTracer?: Tracer;
}
```

### 5.4 `create-agent.ts` 分发逻辑修改

```typescript
// src/api/create-agent.ts — 替换第 124-132 行:
if (config.tracing) {
  if (typeof config.tracing === 'object' && config.tracing.customTracer) {
    // exporter === 'custom'
    appServices.tracer = config.tracing.customTracer;
  } else if (typeof config.tracing === 'object' && config.tracing.exporter === 'none') {
    // exporter === 'none' — explicitly disable, keep NoopTracer (default)
    // NoopTracer already set above; nothing to do
  } else if (typeof config.tracing === 'object' && config.tracing.exporter === 'otel') {
    // exporter === 'otel' — 新增分支
    const { OTelTracer } = await import('../observability/tracers/otel-tracer.js');
    const otelTracer = new OTelTracer();
    await otelTracer.configure({   // ★ configure() 是 async (动态 import OTel SDK)
      endpoint: config.tracing.endpoint!,
      serviceName: config.tracing.serviceName,
      headers: config.tracing.headers,
      sampler: config.tracing.sampler,
    });
    appServices.tracer = otelTracer;     // ★ OTelTracer implements Tracer
  } else if (config.tracing === true || config.tracing.exporter === 'console') {
    appServices.tracer = new ConsoleTracer();
  }
}
```

### 5.5 Trace 注入点

AgentScope 用 Python decorator 在每个框架方法入口自动埋点。AgentForge 使用命令式 `while(true)` 循环，埋点位置在 loop 中显式调用。

**建议埋点层级**（通过 Hook 系统实现, 不修改 loop 核心逻辑）:

```
span "agent.run" (root)
  ├── span "agent.step.1" (child)
  │   ├── span "llm.request" (child: llm.request 事件)
  │   └── span "tool.read" (child: tool.call 事件)
  ├── span "agent.step.2" (child)
  │   └── span "llm.request" (child)
  └── span "agent.complete" (child: agent.complete 事件)
```

**实现方式**: 通过新增 `ObservabilityPlugin` 注册 LifecycleHook — Hook 系统已实现 (15 个 cut-point)，可直接使用:

```typescript
// ObservabilityPlugin — 使用现有 HookName + (input, output) 签名
// Hook 系统: src/core/hooks.ts, HookName 常量已定义以下 cut-point
//   'step.begin' | 'step.end' | 'llm.request.before' | 'llm.response.after'
//   | 'tool.execute.before' | 'tool.execute.after' | 'session.start' | 'session.end'

import { HookName } from '../../core/hooks.js';
import { ATTR_AGENTFORGE_STEP } from './otel-attributes.js';

// LifecycleHook 签名: (input: HookPayload, output: HookPayload) => void | Promise<void>
const hooks = [
  {
    name: HookName['step.begin'],
    fn: (input: { state: AgentLoopState }, _output: Record<string, never>) => {
      const tracer = /* access tracer from plugin context */;
      const spanId = tracer.startSpan('agent.step', {
        attributes: { [ATTR_AGENTFORGE_STEP]: input.state.step },
      });
      // Store spanId in plugin-scoped state (e.g., WeakMap keyed by sessionId)
    },
  },
  {
    name: HookName['step.end'],
    fn: (_input, _output) => {
      const tracer = /* access tracer */;
      const spanId = /* retrieve from plugin state */;
      tracer.endSpan(spanId);
    },
  },
  {
    name: HookName['llm.response.after'],
    fn: (_input, output: { response: { usage?: { inputTokens: number; outputTokens: number } } }) => {
      const tracer = /* access tracer */;
      // Add token usage as span event
    },
  },
];
```

**注意**: `ObservabilityPlugin` 独立于 `OTelTracer` 实现，属于后续可观测性增强任务。初始版本只需 `OTelTracer` 可用即可。

---

## 6. 测试策略

### 6.1 单元测试 (`tests/observability/otel-tracer.spec.ts`)

```typescript
describe('OTelTracer', () => {
  it('should return empty spanId when not configured', () => {
    const tracer = new OTelTracer();
    expect(tracer.startSpan('test')).toBe('');
  });

  it('should be idempotent on configure()', () => {
    const tracer = new OTelTracer();
    tracer.configure({ endpoint: 'http://localhost:4318/v1/traces' });
    tracer.configure({ endpoint: 'http://localhost:9999/v1/traces' });
    // 不应抛错或双重注册
  });

  it('should manage span lifecycle (configured)', () => {
    const tracer = new OTelTracer();
    tracer.configure({ endpoint: 'http://localhost:4318/v1/traces' });

    const spanId = tracer.startSpan('test.span', {
      attributes: { key: 'value' },
    });
    expect(spanId).not.toBe('');

    tracer.addEvent(spanId, 'event.name', { detail: true });
    tracer.endSpan(spanId);
    // 验证 span 已从 activeSpans 移除
  });

  it('should handle recordException', () => {
    const tracer = new OTelTracer();
    tracer.configure({ endpoint: 'http://localhost:4318/v1/traces' });
    const spanId = tracer.startSpan('test.error');
    tracer.recordException(spanId, new Error('test error'));
    tracer.endSpan(spanId, { code: 'error' });
  });

  it('should no-op for unknown spanId', () => {
    const tracer = new OTelTracer();
    tracer.configure({ endpoint: 'http://localhost:4318/v1/traces' });
    // 不应抛错
    tracer.endSpan('nonexistent');
    tracer.addEvent('nonexistent', 'event.name');
  });

  it('should shutdown cleanly', async () => {
    const tracer = new OTelTracer();
    tracer.configure({ endpoint: 'http://localhost:4318/v1/traces' });
    tracer.startSpan('test.1');
    tracer.startSpan('test.2');
    await tracer.shutdown();
    // 所有 span 应已结束
  });
});
```

### 6.2 集成测试

- 验证 `createAgent({ tracing: { exporter: 'otel', endpoint: '...' } })` 正确创建 `OTelTracer`
- 验证 `tracing: true` 仍返回 `ConsoleTracer`
- 验证 `tracing: undefined` 仍返回 `NoopTracer`

---

## 7. 实施步骤

| 步骤 | 文件 | 操作 | 预估 |
|------|------|------|------|
| 1 | `package.json` | 添加 OTel 依赖 | 5min |
| 2 | `src/observability/tracers/otel-attributes.ts` | 新建属性常量 | 15min |
| 3 | `src/observability/tracers/otel-tracer.ts` | 新建 OTelTracer 类 | 1h |
| 4 | `src/api/types.ts` | 扩展 TracingConfig | 10min |
| 5 | `src/api/create-agent.ts` | 处理 exporter='otel' 分支 | 15min |
| 6 | `src/index.ts` | 导出新类型 | 5min |
| 7 | `tests/observability/otel-tracer.spec.ts` | 单元测试 | 30min |
| 8 | - | `npm run build && npm test` 验证 | 10min |

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| OTel SDK 体积大 (~2MB) | `await import()` 懒加载，仅在 `exporter='otel'` 时导入。`configure()` 改为 async，`create-agent.ts` 已 async 兼容 |
| TypeScript `dynamic import()` 类型 | 使用 `import type` 声明 OTel 类型接口，运行时 `import()` 仅用于获取值 |
| `verbatimModuleSyntax` + side-effect imports | OTel 的 `provider.register()` 是 side-effect；动态 `import()` 不触发 verbatimModuleSyntax 检查 |
| 配置 `endpoint` 为空时无提示 | `configure()` 中验证 `config.endpoint` 非空，否则抛错 |
| `getVersion()` 在 ESM 中无法 require package.json | 使用构建工具内联或静态 JSON import（Node.js ≥18 原生支持 JSON imports）

---

## 9. 后续增强 (不在此设计范围)

- **ObservabilityPlugin**: 通过 LifecycleHook 自动在 loop 中创建/结束 span
- **Span 层级管理**: parent spanId 传播（当前 Tracer 接口的 `SpanOptions.parent` 字段已预留）
- **Metrics 集成**: OTel Metrics API 对齐 `Metrics` 接口
- **Logging 集成**: OTel Logs API 与 span events 关联
