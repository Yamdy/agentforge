# Self-built Observability Abstraction + OTel Bridge (not OTel-native)

We define our own lightweight Span, Tracer, and Metrics interfaces in `@harness/observability`, with an OTel Bridge as one possible backend. Processors and tools depend only on our abstraction, never on `@opentelemetry/api` directly.

**Considered options:**
- OTel-native: Use `@opentelemetry/api` directly in the framework. Maximum ecosystem compatibility (every OTel backend works out of the box). However, this deeply couples ALL Processors to the OTel API — even a simple "log each step" Processor would need to import `@opentelemetry/api`. It also makes testing harder (need real OTel provider in tests).
- Pure event stream: No span abstraction at all, just emit events. Users decide how to handle them. Maximum flexibility but no structure — every consumer must rebuild span hierarchy, timing, and attributes from raw events.
- Self-built abstraction + OTel Bridge (chosen): Processors call `context.span.startChild('my-operation')` without knowing what's behind it. The OTel Bridge translates to real OTel spans. When no backend is configured, No-Op provides zero overhead.

This approach was validated by Mastra, which successfully uses the same pattern (ObservabilityExporter + ObservabilityBridge) to support 10+ backends (LangSmith, Datadog, Arize, Sentry, etc.) while keeping Processor code backend-agnostic.

**Consequences:** We maintain a parallel span abstraction alongside OTel. The bridge must stay current with OTel spec changes. Adding a new backend requires a new bridge implementation, not just configuration. This is acceptable because the bridge interface is narrow and the number of backends is finite.
