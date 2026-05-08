Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the OpenTelemetry Bridge that connects the framework's internal observability abstraction to the OTel ecosystem, enabling production-grade distributed tracing.

**OTelBridge class:** Implements the Tracer interface from `@harness/observability`. Delegates to `@opentelemetry/api`:
- `startSpan()` → creates a real OTel Span
- Span attributes are set via OTel's `setAttribute()`
- Span events are recorded via OTel's `addEvent()`
- Parent-child relationships are maintained via OTel context propagation

**Span hierarchy mapping:**
```
agent_run (OTel INTERNAL span)
  ├── build_context (OTel INTERNAL span)
  ├── model_step (OTel INTERNAL span)
  │   └── model_generation (OTel CLIENT span)
  ├── process_step_output (OTel INTERNAL span)
  └── tool_execution (OTel CLIENT span)
      ├── before_tool (OTel INTERNAL span)
      ├── execute_tool (OTel INTERNAL span)
      └── after_tool (OTel INTERNAL span)
```

**Configuration:** Bridge accepts OTel TracerProvider and optional exporter (OTLP HTTP, Console, etc.). When no exporter is configured, falls back to No-Op.

**Context propagation:** Support injecting/extracting trace context for distributed tracing across agent boundaries.

## Acceptance criteria

- [ ] OTelBridge creates real OTel spans for every pipeline stage
- [ ] Span hierarchy correctly nests child spans under parents
- [ ] Span attributes (model, tokens, tool name, duration) are visible in OTel backend
- [ ] Context propagation works: traceId propagates from parent to sub-agents
- [ ] Falls back to No-Op when no OTel provider is configured
- [ ] Test: run full pipeline with TestExporter, verify complete span tree matches expected hierarchy

## Blocked by

- Issue 04 (Observability Core)
- Issue 06 (Full Pipeline Stages)

## User stories covered

22, 24, 26
