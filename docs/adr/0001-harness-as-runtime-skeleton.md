# Harness as Runtime Skeleton (not batteries-included, not minimal core)

We define Harness as the **runtime skeleton** wrapping the LLM — it provides the Agent Loop lifecycle management (sessions, tool execution, permissions, compression) but does not bake specific functionality into the core. This sits between the two extremes seen in reference frameworks: DeepAgents (batteries-included with a fixed middleware stack) and Pi-mono (minimal core with everything as an extension). We chose the middle ground because the Harness concept demands that core infrastructure (pipeline stages, context, observability) be built into the framework, while specific capabilities (memory, compression, skills, MCP) should be pluggable via Processors. The runtime skeleton approach also maps directly to the "Agent = Model + Harness" equation — the skeleton IS the Harness, and everything else is configured on top.

**Considered options:**
- Batteries-included (DeepAgents): Would have faster time-to-first-demo but makes it hard to swap out built-in behavior. The fixed middleware stack (FilesystemMiddleware, SubAgentMiddleware) cannot be removed without breaking core functionality.
- Minimal core + pure extension (Pi-mono): Maximum flexibility but shifts too much burden to users. Core infrastructure like observability spans and pipeline stages should NOT be optional.
- Runtime skeleton (chosen): Core provides the lifecycle, extension points, and observability. Capabilities come as official plugins.

**Consequences:** The framework's value proposition is in the pipeline architecture and unified extension+observability model, not in any specific built-in capability. This means the first impression depends on the quality of the plugin ecosystem, not the core alone.
