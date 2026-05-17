# Unified Extension Point + Observability Span Model

Each pipeline stage is simultaneously an **extension point** (where Processors register) and an **observability span** (automatically traced). We chose to unify these into a single mechanism rather than maintaining two separate systems (one for extensions, one for tracing).

**Considered options:**
- Separate systems (traditional): Extension hooks and tracing are independent. An extension author must remember to add tracing manually. The framework has two registration mechanisms. This is how most frameworks work — hooks for extensibility, OTel for observability — and they drift apart over time.
- Unified model (chosen): The Pipeline Runner wraps every Processor execution in a span automatically. There is no way to extend the pipeline without also being observed. Processors access the current span via Context to add custom attributes.

This decision is driven by the first principle: **reasoning quality = strength of observable fact constraints**. If extension points and observability are separate, there will always be "extended but unobserved" execution paths. The unified model guarantees that every point where the agent's behavior can be modified is also a point where the modification is recorded. This is essential for the Harness Engineering feedback loop — you can't fix what you can't see.

**Consequences:** The framework is deeply coupled to its observability abstraction. Changing the span/tracer interfaces is a breaking change for all Processors. This is acceptable because these interfaces are small and stable. Processors that don't need observability simply ignore the span in Context (No-Op overhead is near-zero).
