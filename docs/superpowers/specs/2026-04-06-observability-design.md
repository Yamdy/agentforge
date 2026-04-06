# Observability Integration Design

## Overview

可观测性集成，采用 OpenTelemetry + GenAI 语义约定，参考 Mastra 的双向桥接设计，保持 Primo Agent 的简洁性。

## Tech Stack

- **Language:** TypeScript (ESM)
- **Tracing:** 自定义 Span/Tracer（可扩展支持 OpenTelemetry）
- **GenAI Semantic Conventions:** Standard attributes for AI/LLM operations

## Core Abstractions

### 1. Span Status

```typescript
export const SpanStatusCodeSchema = z.enum(['UNSET', 'OK', 'ERROR']);
export type SpanStatusCode = z.infer<typeof SpanStatusCodeSchema>;

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}
```

### 2. GenAI Attributes (语义约定)

```typescript
// Agent attributes
export const GEN_AI_AGENT_NAME = 'gen_ai.agent.name';
export const GEN_AI_AGENT_ID = 'gen_ai.agent.id';

// Request attributes
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
export const GEN_AI_REQUEST_TEMPERATURE = 'gen_ai.request.temperature';
export const GEN_AI_REQUEST_MAX_TOKENS = 'gen_ai.request.max_tokens';
export const GEN_AI_REQUEST_TOP_P = 'gen_ai.request.top_p';

// Response attributes
export const GEN_AI_RESPONSE_ID = 'gen_ai.response.id';
export const GEN_AI_RESPONSE_FINISH_REASONS = 'gen_ai.response.finish_reasons';

// Usage attributes
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';

// Tool attributes
export const GEN_AI_TOOL_NAME = 'gen_ai.tool.name';
export const GEN_AI_TOOL_DESCRIPTION = 'gen_ai.tool.description';

// Operation attributes
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
export const GEN_AI_PROVIDER_NAME = 'gen_ai.provider.name';
```

### 3. Span

```typescript
export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  attributes: Record<string, string | number | boolean>;
  status: SpanStatus;
  startTime: Date;
  endTime?: Date;
  events: SpanEvent[];

  end(status?: SpanStatus): void;
  recordException(error: Error): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
  setAttribute(key: string, value: string | number | boolean): void;
}

export interface SpanEvent {
  name: string;
  time: Date;
  attributes?: Record<string, string | number | boolean>;
}
```

### 4. Span Exporter

```typescript
export interface SpanExporter {
  export(spans: Span[]): Promise<void>;
  shutdown(): Promise<void>;
}
```

### 5. Tracer

```typescript
export interface ObservabilityConfig {
  exporter?: SpanExporter;
  serviceName?: string;
  serviceVersion?: string;
}

export function setupObservability(config: ObservabilityConfig): void;
export function getTracer(): TracerImpl;
export function setTracer(tracer: TracerImpl): void;

export const tracer = {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): Span;
  endSpan(span: Span): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  getCurrentSpan(): Span | undefined;
};
```

## File Structure

```
src/observability/
├── index.ts                 # 主导出
├── types.ts                 # 类型定义 + GenAI attributes
├── span.ts                  # Span 基类
├── tracer.ts                # Tracer 实现
└── exporters/
    └── console.ts           # 控制台导出器
```

## Core Components

| Component         | File                                     | Description                            |
| ----------------- | ---------------------------------------- | -------------------------------------- |
| `SpanImpl`        | `src/observability/span.ts`              | Span 实现                              |
| `TracerImpl`      | `src/observability/tracer.ts`            | Tracer 实现，管理当前 span，缓冲，导出 |
| `ConsoleExporter` | `src/observability/exporters/console.ts` | 控制台导出器                           |

## Usage Examples

### 基本使用

```typescript
import {
  setupObservability,
  tracer,
  ConsoleExporter,
  GEN_AI_AGENT_NAME,
  GEN_AI_REQUEST_MODEL,
} from 'primo-agent/observability';

setupObservability({
  exporter: new ConsoleExporter(),
});

const span = tracer.startSpan('agent.run', {
  attributes: {
    [GEN_AI_AGENT_NAME]: 'my-agent',
    [GEN_AI_REQUEST_MODEL]: 'gpt-4',
  },
});

try {
  // ... 执行逻辑
  span.end({ code: 'OK' });
} catch (error) {
  span.recordException(error as Error);
  span.end({ code: 'ERROR' });
}
```

### 嵌套 Span

```typescript
const parentSpan = tracer.startSpan('parent');
const childSpan = tracer.startSpan('child');

childSpan.end();
parentSpan.end();

await tracer.flush();
```

## Data Flow

```
tracer.startSpan()
      ↓
  创建 Span
      ↓
  设置 CurrentSpan
      ↓
  执行业务逻辑 → span.setAttribute()
      ↓
  span.end()
      ↓
  加入 Buffer
      ↓
  tracer.flush()
      ↓
  SpanExporter.export()
      ↓
  Console / OTel / ...
```

## Key Files Reference

- Mastra: `D:\code\mastra\observability\otel-exporter\src\tracing.ts`
- AgentScope: `D:\code\agentscope\src\agentscope\tracing\_trace.py`
