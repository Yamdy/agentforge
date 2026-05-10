Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the OpenTelemetry Bridge that connects the framework's internal Span/Tracer abstraction to the OTel ecosystem.

**OTelBridge class:** Implements the Tracer interface from `@agentforge/observability`. Delegates to `@opentelemetry/api`:
- `startSpan()` → creates a real OTel Span
- Span attributes set via OTel's `setAttribute()`
- Span events recorded via OTel's `addEvent()`
- Parent-child relationships via OTel context propagation

**Span hierarchy mapping:**
```
agent_run (OTel INTERNAL span)
  ├── process_input (OTel INTERNAL span)
  ├── build_context (OTel INTERNAL span)
  ├── model_step (OTel INTERNAL span, per iteration)
  │   ├── prepare_step
  │   ├── invoke_llm
  │   ├── process_step_output
  │   ├── execute_tools
  │   │   └── tool_call (per tool)
  │   └── evaluate_iteration
  └── process_output (OTel INTERNAL span)
```

**EventBus integration:** Hook `stage.after` emits EventBus events with span context (traceId, spanId) for correlation between observability and event-driven subsystems.

**Configuration:** Bridge accepts OTel TracerProvider and optional exporter (OTLP HTTP, Console). Falls back to No-Op when unconfigured.

## Acceptance criteria

- [ ] OTelBridge creates real OTel spans for every pipeline stage
- [ ] Span hierarchy correctly nests under the four-region context model
- [ ] Span attributes (model, tokens, tool name, duration) visible in OTel backend
- [ ] Context propagation: traceId propagates from parent to sub-agents
- [ ] Falls back to No-Op when no OTel provider configured
- [ ] Test: full pipeline with TestExporter, verify span tree matches hierarchy

## Blocked by

- Issue 04 (Observability Core)
- Plan A (Foundation — PipelineContext refactor)

## User stories covered

22, 24, 26
