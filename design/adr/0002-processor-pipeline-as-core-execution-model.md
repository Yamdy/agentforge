# Processor Pipeline as Core Execution Model

We chose a **Processor Pipeline** as the core execution model over event-driven or middleware-stack alternatives. In this model, the Agent Loop is decomposed into 8 explicit stages (processInput → buildContext → [Agentic Loop: prepareStep → invokeLLM → processStepOutput → executeTools → evaluateIteration] → processOutput), and each stage is an ordered chain of Processors. Processors execute in registration order, can modify the shared Context, and can abort the pipeline via TripWire.

**Considered options:**
- Event-driven (Pi-mono, OpenCode): Extensions subscribe to events on a bus. Fully decoupled but execution order is nondeterministic, making it hard to guarantee that observability runs after business logic. Debugging event chains across 25+ event types is notoriously difficult.
- Middleware stack (DeepAgents): Middleware wraps the entire LLM call and can modify system prompt, filter tools, and transform messages. Powerful but the middleware stack is opaque — you can't see which middleware changed what without deep logging. The fixed base stack also means some middleware cannot be removed.
- Processor Pipeline (chosen, inspired by Mastra): Extensions register at specific stages, execute in deterministic order, and each execution is automatically a span. This gives us both precise control over extension points AND natural observability.

**Consequences:** Pipeline stages must be defined upfront — adding a new stage is a breaking change. This is acceptable because the 8 stages cover the full Agent Loop lifecycle and new extension needs should fit within existing stages. The trade-off is less flexibility than pure event-driven but much better debuggability and traceability.
