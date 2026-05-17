# @agentforge/observability

Span, Tracer, and Metrics abstractions with an OpenTelemetry bridge.

## Overview

Provides the observability layer for AgentForge. All pipeline stages emit spans with attributes, and the framework exposes metrics for token usage, tool calls, and gate decisions.

## Quick Example

```typescript
import { OTelBridge } from '@agentforge/observability';
import { EventBus } from '@agentforge/core';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

const bus = new EventBus();
const tracer = new OTelBridge({ tracerProvider: provider, eventBus: bus });

// Use with an Agent
const agent = new Agent({ model: 'deepseek/deepseek-v4-flash' }, { tracer });
```

## Key Exports

| Export | Description |
|--------|-------------|
| `TracerImpl` | Default tracer implementation with span lifecycle |
| `SpanImpl` | Span implementation with attributes and events |
| `NoOpTracer` | No-op tracer for when observability is disabled |
| `NoOpSpan` | No-op span that discards all data |
| `OTelBridge` | Bridge connecting AgentForge spans to OpenTelemetry |
| `InMemoryMetrics` | In-memory metrics collector (counter, gauge, histogram) |
| `NoOpMetrics` | No-op metrics implementation |
| `TestExporter` | Test utility for capturing spans |
| `TraceCollector` | Collects and formats traces as JSON, console, or OTLP |
| `formatTraceJson` | Formats traces as JSON |
| `formatTraceConsole` | Formats traces for console output |
| `formatTraceOtlp` | Formats traces as OTLP for export |

## Span Types

The SDK defines standard span types via `SpanType`:

| Span Type | Description |
|-----------|-------------|
| `agent_run` | Full agent execution |
| `model_step` | Single LLM invocation |
| `tool_call` | Tool execution |
| `processor_run` | Pipeline processor execution |
| `llm.stream` | LLM streaming span |
| `tool.execute` | Tool execution with hooks |
| `harness.gate` | Gate decision (allow/deny) |
| `harness.cost-cap` | Cost cap check |
| `harness.token-budget` | Token budget check |
| `session.lifecycle` | Session state transitions |
| `context.build` | Context assembly |
| `loop.iteration` | Agentic loop iteration |

## Metrics

```typescript
import { InMemoryMetrics } from '@agentforge/observability';

const metrics = new InMemoryMetrics();
metrics.increment('llm.calls', 1, { model: 'deepseek' });
metrics.gauge('tokens.used', 150, { type: 'input' });
metrics.histogram('tool.duration', 42, { tool: 'getWeather' });

const snapshot = metrics.snapshot();
```

## Dependencies

- `@agentforge/sdk` -- Span, Tracer, Metrics interfaces
