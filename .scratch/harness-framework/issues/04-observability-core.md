Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the observability abstraction layer and integrate it into the Pipeline Runner so every pipeline stage automatically produces a span.

**Span interface:** `startSpan(name, attributes)`, `endSpan()`, `addEvent(name, attributes)`, `setAttribute(key, value)`, `spanContext()` returning traceId/spanId. Spans support parent-child nesting.

**Tracer interface:** `startSpan(name, options)` returns a Span. `withSpan(span, fn)` runs a function with the span as active.

**No-Op implementation:** All methods are empty functions. Used when no observability backend is configured. Near-zero overhead.

**TestExporter:** In-memory span collector for testing. Captures all created spans with their attributes, events, and hierarchy.

**Pipeline Runner integration:** Before executing each stage, Pipeline Runner calls `tracer.startSpan(stageName)`. After the stage completes (or errors), it calls `span.end()`. The current span is set in PipelineContext so Processors can access it.

## Acceptance criteria

- [ ] Span interface supports parent-child nesting (child spans reference parent)
- [ ] No-Op implementation has zero measurable overhead (all methods return immediately)
- [ ] TestExporter collects spans in memory with full hierarchy
- [ ] Pipeline Runner creates a span for each stage automatically
- [ ] Processors can access the current span from PipelineContext and add attributes/events
- [ ] Test: run a 3-stage pipeline, verify TestExporter captured 3 child spans under 1 root span

## Blocked by

- Issue 02 (Minimal Pipeline + Agent Loop)

## User stories covered

21, 25
