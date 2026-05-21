// @primo-ai/observability — Span, Tracer, Metrics abstractions

export { NoOpTracer, NoOpSpan } from './noop.js';
export { TracerImpl, SpanImpl, NoOpMetrics, type SpanData, type OnSpanEndCallback } from './tracer.js';
export { InMemoryMetrics, type HistogramStats, type MetricsSnapshot } from './metrics.js';
export { TestExporter } from './exporter.js';
export { OTelBridge, type OTelBridgeOptions, type EventBusLike } from './otel-bridge.js';
export { TraceCollector, formatTraceJson, formatTraceConsole, formatTraceOtlp, type Trace, type TraceNode, type OtlpOptions } from './trace-collector.js';
export { SafeOtlpSpanExporter, createOtlpTracerProvider, type OtlpExporterOptions, type OtlpExporterConfig } from './otel-exporter.js';
export { OtelMetricsBridge, type OtelMetricsBridgeOptions } from './otel-metrics-bridge.js';
