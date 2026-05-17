# ADR-0007: Four-Region PipelineContext, Hook Pipeline, and EventBus

## Status

Accepted

## Context

The original `PipelineContext` used a `pipeline: Record<string, unknown>` field for all mutable state. Processors hung arbitrary keys with no type guarantee. Implicit contracts between Processors (e.g., `invokeLLM` writes `textStream`, `PipelineRunner` reads it) were untyped. The same `Processor` interface was used for both business logic (abort, route) and cross-cutting concerns (logging, telemetry), mixing two fundamentally different responsibilities. The `PluginManager` used `Map<string, handler[]>` for events, insufficient for subsystem communication.

Analysis of OpenCode (Hook system), oh-my-openagent (BackgroundManager event-driven lifecycle), Mastra (Processor pipeline), DeepAgents (middleware-first pattern), and AgentScope (metaclass-driven hooks) revealed patterns applicable to any agent framework.

## Decision

### 1. Four-Region PipelineContext

Replace `pipeline: Record<string, unknown>` with four typed regions:

- **`request`** — immutable input data (user message, session ID, metadata)
- **`agent`** — agent configuration state (config, systemPrompt, toolDeclarations, promptFragments)
- **`iteration`** — current step state (step number, textStream, response, toolCalls, stopLoop, retryFrom)
- **`session`** — cross-iteration state (messageHistory, totalTokenUsage, `custom: Record<string, unknown>` for plugin extension)

Each region has explicit typed fields. The `session.custom` field is the designated extension point for plugins — no implicit key hanging.

### 2. Hook Pipeline alongside Processors

Add a lightweight Hook system for cross-cutting concerns that don't need control flow:

- **Processor**: Can return AbortSignal, change iteration routing. For business logic.
- **Hook**: Cannot abort, only observe/modify via `mutate()`. For logging, telemetry, permission, context injection. Has explicit `priority` ordering.

HookPoints include `agent.start/end`, `stage.before/after`, `llm.before/after/wrap`, `tool.before/after/wrap`, `iteration.end`, `error`. The `wrap` variants (from DeepAgents) let a single Hook see both request and response.

### 3. EventBus for Decoupled Communication

A typed publish-subscribe system with `on()`, `once()`, `emit()`, and unsubscribe functions. Events cover agent lifecycle (start/end), iterations, LLM calls, tool calls, errors, idle detection, and task management.

EventBus decouples producers (pipeline execution) from consumers (session persistence, background tasks, stagnation detection). Hook vs EventBus: Hooks run on the execution path and can modify data; EventBus is async broadcast for decoupled subsystems.

## Consequences

**Positive:**
- Typed context eliminates implicit contracts between Processors
- Hook/Processor separation keeps business logic clean from cross-cutting noise
- EventBus enables session persistence and background tasks without tight coupling
- `session.custom` provides explicit, namespaced plugin extension

**Negative:**
- Migration cost: all existing tests and core modules must adopt new context shape
- Three extension mechanisms (Processor, Hook, EventBus) increase API surface area
- Wrap hooks add complexity to the Hook pipeline (must decide when to use wrap vs before/after)

## Considered Options

- **Keep untyped pipeline field**: No type safety, implicit contracts persist. Rejected.
- **Add typing only, no Hook/EventBus**: Doesn't solve cross-cutting concern mixing. Rejected.
- **Effect-TS based (like OpenCode)**: Too heavy for our framework scope. Rejected — we use plain async/await.
