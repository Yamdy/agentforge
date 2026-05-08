# Harness Agent Framework PRD

## Problem Statement

现有的 AI Agent 开发框架存在三个核心痛点：

1. **可观测性缺失**：开发者无法透明地追踪 Agent 执行全链路——LLM 调用、工具执行、上下文变换、子 Agent 调度等关键环节对开发者是黑盒。调试困难的根本原因是推理链上缺乏可观测事实的锚点（Truth Gap），导致幻觉和漂移无法被及时发现和纠正。

2. **扩展点不足**：现有框架要么提供固定的钩子（before/after LLM call），要么要求深度侵入框架内部。开发者无法在执行生命周期的每个关键节点注入自定义逻辑（权限检查、事实注入、输出验证、上下文变换等），导致 Harness Engineering 的核心方法论——"每次 Agent 犯错就添加一条约束"——无法被系统化地实践。

3. **缺乏 Harness 范式支持**：业界已经形成 Harness Engineering 的方法论共识（Truth Gap、Fact Injection、三个核心循环、三个垂直分层），但没有一个框架将这些概念作为第一级抽象原生支持。

## Solution

构建一个 TypeScript Agent 开发框架，以 **Processor Pipeline** 为核心执行模型，实现以下三大目标：

- **全链路透明可观测**：每个 Pipeline 阶段同时是一个可观测性 Span，自动产生 trace。开发者可以通过 OTel Bridge 对接任意后端（Jaeger、Datadog、LangSmith 等）。
- **全点位可扩展可插拔**：8 个 Agent 生命周期阶段 + 工具子 pipeline 的每个节点都是 Processor 扩展点。插件通过代码工厂函数注册，可注入自定义 Processor、Tool、Command 等。
- **原生 Harness 范式**：框架的设计直接映射 Harness Engineering 的三个核心循环（Execution Loop、Knowledge Loop、Evolution Loop）和三个垂直分层（Control Harness、Evaluation Harness、Agent Harness）。

核心设计原理：**推理质量上限 = 可观测事实对推理的约束强度**。框架通过 Pipeline 的 `processStepOutput` 阶段提供事实注入点，让开发者在每个关键推理节点注入外部可验证事实。

## User Stories

### 核心框架

1. As a framework user, I want to create an Agent with a single function call that configures model, tools, and processors, so that I can quickly build working agents.
2. As a framework user, I want my Agent to execute through a well-defined Processor Pipeline (processInput → buildContext → [Agentic Loop: prepareStep → invokeLLM → processStepOutput → executeTools → evaluateIteration] → processOutput), so that every execution stage is transparent and extensible.
3. As a framework user, I want each Pipeline stage to automatically produce an observability span with structured attributes, so that I can trace the entire execution lifecycle without writing any tracing code.
4. As a framework user, I want to register custom Processors at any Pipeline stage, so that I can inject domain-specific logic (validation, transformation, fact injection) at precisely the right point.
5. As a framework user, I want Processors to be able to abort execution via a TripWire mechanism, so that I can implement guardrails that stop the agent when conditions are violated.
6. As a framework user, I want a single Context object that flows through the entire Pipeline carrying request state, iteration state, pipeline state, session state, and agent config, so that Processors can share state without ad-hoc mechanisms.
7. As a framework user, I want the Pipeline to support suspend/resume, so that a Processor can pause execution to wait for human input and the session can be restored later.
8. As a framework user, I want streaming output delivered via AsyncGenerator, so that I can consume partial results in real-time with natural backpressure support.

### LLM Provider

9. As a framework user, I want to specify models via string identifiers (e.g., 'openai/gpt-5', 'anthropic/claude-sonnet-4-6') powered by Vercel AI SDK, so that I can use any provider without writing adapter code.
10. As a framework user, I want token usage and cost tracking to be automatic, so that I can monitor spending without manual accounting.
11. As a framework user, I want automatic retry with exponential backoff for transient LLM API errors, so that my agents are resilient to temporary provider issues.

### Tool System

12. As a framework user, I want to define tools with Zod input/output schemas, so that tool arguments are validated at the type level and at runtime.
13. As a framework user, I want tools to declare `requireApproval`, so that dangerous operations automatically trigger human-in-the-loop.
14. As a framework user, I want tools to have custom `renderCall` and `renderResult` functions, so that tool execution can be displayed in a UI with meaningful formatting.
15. As a framework user, I want the Agent to execute multiple tool calls in parallel by default, so that independent operations complete faster.
16. As a framework user, I want to control tool execution mode (parallel vs sequential) per-tool or globally, so that I can handle dependencies between tool calls.

### Plugin System

17. As a framework user, I want to write plugins as TypeScript modules exporting a factory function `(harness: HarnessAPI) => PluginHooks`, so that I can extend the framework with type-safe, composable modules.
18. As a framework user, I want plugins to register Processors, Tools, Commands, Providers, and Hooks through the HarnessAPI, so that all extension capabilities are accessible from a single entry point.
19. As a framework user, I want plugins to be loadable from npm packages, local files, or project directories, so that I can distribute and reuse extensions.
20. As a framework user, I want a clear plugin lifecycle (load → initialize → activate → deactivate), so that plugins can manage resources properly.

### Observability

21. As a framework user, I want a lightweight Span/Tracer/Metrics abstraction built into the framework, so that my Processors and tools don't need to depend on any specific observability library.
22. As a framework user, I want an OTel Bridge that connects the framework's observability to OpenTelemetry, so that I can use any OTel-compatible backend (Jaeger, Zipkin, Datadog, etc.).
23. As a framework user, I want each Pipeline stage span to include relevant attributes (model name, token usage, tool name, execution duration, etc.), so that traces are information-rich without manual annotation.
24. As a framework user, I want to access the current Span from within a Processor's execute context, so that I can add custom attributes and events to the trace.
25. As a framework user, I want a No-Op observability implementation that is used when no backend is configured, so that there is zero overhead when observability is not needed.
26. As a framework user, I want to configure observability sampling strategies (always, never, ratio-based), so that I can control tracing overhead in production.

### Sub-Agents

27. As a framework user, I want to define sync sub-agents that execute as tools in the main agent's pipeline, so that I can delegate focused tasks with context isolation.
28. As a framework user, I want to define async sub-agents that run in the background and notify the main agent when complete, so that I can parallelize long-running work.
29. As a framework user, I want sub-agents to have isolated context windows, so that their internal reasoning does not pollute the parent agent's context.
30. As a framework user, I want sub-agents to return summaries to the parent agent, not raw internal state, so that fact injection principles are maintained.

### Memory

31. As a framework user, I want a MemoryProcessor plugin that loads conversation history into the buildContext stage, so that agents have persistent memory across turns.
32. As a framework user, I want to choose between memory storage backends (in-memory, SQLite, Redis), so that I can match persistence to my deployment needs.
33. As a framework user, I want working memory (short-term, structured key-value state) that persists across iterations within a session, so that the agent can maintain task focus.
34. As a framework user, I want long-term memory (semantic recall via vector search), so that agents can retrieve relevant knowledge from past interactions.

### Context Compression

35. As a framework user, I want automatic micro-compression (tool output truncation, redundant message removal) when context approaches the window limit, so that compression happens cheaply without LLM calls.
36. As a framework user, I want LLM-based summarization compression as a fallback when micro-compression is insufficient, so that the agent can always continue operating.
37. As a framework user, I want compression events to be observable (span attributes recording before/after token counts, compression strategy used), so that I can monitor and tune compression behavior.

### Permission & Safety

38. As a framework user, I want a PermissionProcessor that checks tool calls against a ruleset in the beforeTool stage, so that I can enforce safety boundaries without modifying tools.
39. As a framework user, I want three permission modes (interactive confirmation, plan-only/read-only, full-auto), so that I can match the safety level to the risk of the operation.
40. As a framework user, I want permission rules based on glob patterns matching tool names and file paths, so that I can express fine-grained access control.
41. As a framework user, I want permission checks to produce observable spans recording the decision (allow/deny) and reason, so that I can audit all safety decisions.

### Skills

42. As a framework user, I want to define Skills as SKILL.md files following the agentskills.io standard, so that I can reuse skills across different agent frameworks.
43. As a framework user, I want a SkillProcessor that injects skill names and descriptions into the buildContext stage (progressive disclosure), so that the agent knows what skills are available without consuming context for full instructions.
44. As a framework user, I want the agent to read full skill instructions on-demand via a built-in `read_skill` tool, so that context is only consumed when a skill is actually needed.
45. As a framework user, I want skills to be discoverable from multiple sources (global, project, plugin directories) with later sources overriding earlier ones, so that project-specific skills take precedence.

### MCP Integration

46. As a framework user, I want an MCP plugin that connects to MCP servers and registers their tools into the framework's ToolRegistry, so that I can extend agent capabilities via the Model Context Protocol.
47. As a framework user, I want the MCP plugin to support stdio, SSE, and HTTP transport, so that I can connect to any MCP server implementation.
48. As a framework user, I want MCP tool discovery to be dynamic, so that tools added to an MCP server at runtime become available to the agent without restart.

### Configuration

49. As a framework user, I want to configure the framework via JSONC files with multi-level merging (global ~/.harness/ > project .harness/ > session-level), so that I can have sensible defaults with per-project overrides.
50. As a framework user, I want configuration validated via Zod schemas, so that misconfiguration is caught at startup with clear error messages.
51. As a framework user, I want HarnessProfile configuration that maps provider/model pairs to runtime behavior (system prompt suffix, tool exclusion, middleware), so that the same agent adapts its behavior per model.

### Session Management

52. As a framework user, I want sessions persisted as JSONL files with one entry per line, so that session data is human-readable and easily parseable.
53. As a framework user, I want session branching via parentId references, so that I can explore multiple paths from the same conversation point without duplicating history.
54. As a framework user, I want to restore a suspended session and continue execution, so that long-running agent tasks can survive interruptions.

### Evaluation Harness

55. As a framework user, I want a Scorer interface that can evaluate agent outputs against expected behavior, so that I can automate quality assurance.
56. As a framework user, I want evaluation datasets that define input/output pairs, so that I can run systematic regression tests.
57. As a framework user, I want evaluation results to be observable (spans recording score, reasoning, expected vs actual), so that evaluation is integrated into the same tracing system.

## Implementation Decisions

### Package Structure

5-package TypeScript monorepo:

- **@harness/core**: Agent Loop, Processor Pipeline, Pipeline Runner, Context, Tool Registry, Agent definition, Sub-agent orchestration. The deepest module — encapsulates the entire execution lifecycle behind a simple `agent.run(input)` interface.
- **@harness/observability**: Span, Tracer, Metrics abstractions, Span types enum (AGENT_RUN, MODEL_STEP, TOOL_CALL, PROCESSOR_RUN, etc.), No-Op implementation, OTel Bridge. Deep module — consumers only see `context.span.startChild(name)` and never the OTel plumbing.
- **@harness/plugins**: Built-in Processors — MemoryProcessor, CompressionProcessor, PermissionProcessor, SkillProcessor, GuardrailProcessor. Each is independently testable with a mock Pipeline.
- **@harness/tools**: Built-in tools — file operations, shell execution, search (glob/grep), web fetch, sub-agent tool, skill reader. Each tool implements the rich Tool interface with Zod schemas.
- **@harness/sdk**: HarnessAPI type definition, PluginHooks interface, Processor interface, Tool interface, Context type, public re-exports. This is the package that plugin authors depend on — it contains only types and interfaces, no runtime code.

### Processor Pipeline Architecture

The core execution model is a Processor Pipeline where each stage is simultaneously an extension point and an observability span. The Pipeline Runner orchestrates stage execution:

**Pipeline Stage interface** (conceptual shape):
```
Processor {
  stage: 'processInput' | 'buildContext' | 'prepareStep' | 'invokeLLM' | 'processStepOutput' | 'executeTools' | 'evaluateIteration' | 'processOutput'
  execute(context: PipelineContext): Promise<PipelineContext | AbortSignal>
}
```

Multiple Processors can be registered per stage. They execute in registration order. Each Processor execution is automatically wrapped in a Span. A Processor can return an AbortSignal to stop the pipeline (TripWire).

**Tool Sub-Pipeline**: The `executeTools` stage contains an inner pipeline for each tool call:
```
beforeTool → execute → afterTool
```
This inner pipeline also follows the unified model — each step is both extensible and observable.

### Context Object

A single `PipelineContext` object flows through the entire pipeline. It contains:

- `request`: User input, session ID, parent span context
- `iteration`: Current step number, LLM response, tool calls, accumulated text
- `pipeline`: Mutable state bag (`Record<string, unknown>`) for inter-processor communication, token usage accumulator
- `session`: Conversation history, working memory, branch info
- `config`: Agent config (model ID, tool list, system prompt), merged from all config layers
- `span`: Current observability span reference
- `tools`: Available tool registry for this step

Context is frozen after each stage to prevent mutation outside the designated Processor.

### Plugin System

Plugins are TypeScript modules exporting a default function:
```
(harness: HarnessAPI) => PluginRegistration | Promise<PluginRegistration>
```

HarnessAPI provides:
- `registerProcessor(stage, processor)`: Register a Processor at a specific pipeline stage
- `registerTool(tool)`: Register a Tool into the ToolRegistry
- `registerCommand(name, handler)`: Register a slash command
- `registerProvider(providerConfig)`: Register a custom LLM provider
- `onEvent(eventType, handler)`: Subscribe to lifecycle events

Plugin discovery paths:
1. `~/.harness/plugins/` (global)
2. `.harness/plugins/` (project)
3. npm packages with `@harness/plugin-*` prefix
4. Explicit paths in configuration

### Observability Architecture

Three-layer design:

1. **Abstraction layer** (in `@harness/observability`): Defines `Span`, `Tracer`, `Metrics` interfaces. Pipeline Runner calls `tracer.startSpan(stageName)` at each stage. No dependency on any specific backend.

2. **No-Op layer**: Default implementation when no backend is configured. All methods are empty functions with near-zero overhead.

3. **Bridge layer**: `OTelBridge` implements the abstraction by delegating to `@opentelemetry/api`. Users configure the bridge with their preferred OTel exporter (OTLP, Console, etc.). Additional bridges can be built for LangSmith, Datadog, etc.

Span hierarchy mirrors pipeline nesting:
```
agent_run (root)
  ├── build_context
  ├── agentic_loop_iteration (1)
  │   ├── prepare_step
  │   ├── model_step
  │   │   └── model_generation
  │   ├── process_step_output
  │   └── tool_execution (get_weather)
  │       ├── before_tool
  │       ├── execute_tool
  │       └── after_tool
  ├── agentic_loop_iteration (2)
  │   └── ...
  └── process_output
```

### Sub-Agent Architecture

Two modes:

**Sync sub-agents**: Defined as tools. The main agent calls the sub-agent via a `task` tool. The sub-agent runs its own Pipeline with an isolated Context. Only the final summary is returned to the parent. The parent's `executeTools` span contains a nested `agent_run` span for the sub-agent.

**Async sub-agents**: Registered as background tasks. The main agent submits work and receives a task ID. Status is checked via events. When the async agent completes, an event is emitted that the main agent (or a coordinator) can consume.

Both modes enforce context isolation — the sub-agent's internal messages and state never leak into the parent's context window.

### Memory System (Plugin)

MemoryProcessor operates at two pipeline stages:
- `buildContext`: Loads relevant memories into the context (conversation history from session store, working memory values, semantic recall results)
- `processOutput`: Records new information to memory (conversation turn, extracted facts, working memory updates)

Storage backend is injectable via plugin configuration. Official backends: InMemory, SQLite, Redis.

### Compression System (Plugin)

CompressionProcessor operates at `evaluateIteration`:
1. Estimate current token usage
2. If approaching threshold: run micro-compression (truncate long tool outputs, remove duplicate messages, trim old system reminders)
3. If still over threshold: invoke LLM to summarize old messages, replace originals with summary
4. Record compression metrics in span attributes (before_tokens, after_tokens, strategy_used)

### Permission System (Plugin)

PermissionProcessor operates at `beforeTool` in the executeTools sub-pipeline:
1. Check tool call against ruleset (glob patterns on tool name + file path)
2. If mode is `interactive`: emit permission request event, suspend pipeline until response
3. If mode is `plan-only`: deny all write/execute tools
4. If mode is `full-auto`: allow everything
5. Record decision in span attributes

### Skill System (Plugin)

SkillProcessor operates at `buildContext`:
1. Scan skill directories for SKILL.md files
2. Parse YAML frontmatter (name, description)
3. Inject skill summaries into system prompt (progressive disclosure)
4. Register `read_skill` tool that loads full skill content on demand

Skill sources merged in order: global → project → plugin, later overrides earlier.

### LLM Integration

Based on Vercel AI SDK. The `invokeLLM` stage:
1. Construct AI SDK `streamText` call from Context (model, messages, tools)
2. Process stream chunks through registered Processors
3. Parse tool call requests from stream
4. Return AsyncGenerator of chunks + final response metadata

Model string parsing: `'provider/model-name'` format (e.g., `'openai/gpt-5'`, `'anthropic/claude-sonnet-4-6'`).

### Session Persistence

JSONL format, one entry per line. Each entry:
- `id`: Unique entry ID
- `parentId`: Parent entry ID (for branching)
- `role`: user/assistant/tool/system
- `content`: Message content
- `metadata`: Token usage, model info, tool results, timestamps
- `timestamp`: ISO 8601

Session branching: Creating a branch just means appending an entry with a different parentId pointing to the same parent. No file duplication.

### Configuration Merging

Three layers merged in priority order:
1. **Global** (`~/.harness/config.jsonc`): User defaults
2. **Project** (`.harness/config.jsonc`): Project-specific overrides
3. **Session** (runtime): Per-invocation parameters

Merge is additive for arrays (processors, tools), override for scalars (model, system prompt). All validated via Zod at startup.

HarnessProfile is a special config section keyed by `'provider'` or `'provider:model'` that overrides runtime behavior for specific models.

### Suspend/Resume Mechanism

When a Processor calls `context.suspend(reason)`:
1. Pipeline serializes current Context to session store
2. Pipeline stops executing and returns a SuspendedResult
3. External caller invokes `harness.resume(sessionId, input)`
4. Pipeline deserializes Context, injects the new input, resumes from the suspended stage

This enables HITL workflows: PermissionProcessor suspends for approval, user responds, pipeline resumes.

## Testing Decisions

### What makes a good test

Tests should verify **external behavior** of modules, not implementation details. A good test:
- Calls the module's public interface
- Asserts on observable outputs (return values, emitted events, state changes)
- Does not inspect internal variables, private methods, or execution order
- Uses real collaborators where possible, mocks only external dependencies (LLM APIs, file system)

### Modules to test

**@harness/core (highest priority)**:
- Processor Pipeline: verify stage execution order, Processor composition, abort/tripwire, context freezing
- Agent Loop: verify iteration cycling, tool dispatch (parallel/sequential), max iteration limit
- Tool Registry: verify registration, schema validation, execution with valid/invalid args
- Sub-agent: verify context isolation, summary-only return, async notification

**@harness/observability (high priority)**:
- Span lifecycle: verify start/end/attribute/event recording
- OTel Bridge: verify span hierarchy correctly maps to OTel parent-child
- No-Op: verify zero overhead (all methods return immediately)
- Sampling: verify sampling strategies filter spans correctly

**@harness/plugins (medium priority)**:
- MemoryProcessor: verify load/save cycle with different backends
- CompressionProcessor: verify micro-compression truncation, LLM summarization fallback
- PermissionProcessor: verify allow/deny decisions per mode and ruleset
- SkillProcessor: verify progressive disclosure and on-demand loading

**@harness/tools (medium priority)**:
- Each built-in tool: verify execute with valid/invalid inputs, schema enforcement
- Tool rendering: verify renderCall/renderResult output format

**@harness/sdk (low priority — mostly types)**:
- Verify exported types match implementation
- Verify plugin factory function signature

### Testing patterns

- **Processor tests**: Create a minimal Pipeline with one stage, register the Processor under test, run with a mock Context, assert on Context mutations and any returned AbortSignal
- **Integration tests**: Run a full Agent Loop with a mock LLM provider (no real API calls) that returns canned responses, verify end-to-end behavior
- **Observability tests**: Use a TestExporter that collects all spans in memory, run a pipeline, assert on span hierarchy and attributes
- **Plugin tests**: Load plugin from test fixture, verify it registers expected Processors/Tools, run those registrations in a test Pipeline

## Out of Scope

- **UI/CLI**: This PRD covers the framework core only. A CLI tool, TUI, or web UI are separate projects that consume the framework.
- **Desktop/Mobile apps**: No Electron, Tauri, or mobile app.
- **Server/HTTP layer**: No built-in HTTP server or SSE endpoint. The framework is embeddable; serving is the consumer's responsibility.
- **Specific LLM provider integrations beyond Vercel AI SDK**: We rely on the SDK's provider ecosystem. Custom providers for uncovered APIs can be plugins.
- **Vector database implementation**: The memory plugin defines the interface; specific vector store backends are separate packages.
- **Training/fine-tuning**: No model training capabilities.
- **Multi-tenant/SaaS**: No user management, authentication, or multi-tenancy.
- **Specific deployment targets**: No Cloudflare Workers, Vercel Edge, or Docker-specific packaging.
- **A2A (Agent-to-Agent) protocol support**: Can be added as a plugin but is not in the initial scope.
- **Autopilot/Cron scheduling**: Background task scheduling is out of scope for the initial framework.

## Further Notes

### Design Philosophy

The framework is designed around a single first principle: **reasoning quality ceiling = strength of observable fact constraints on reasoning**. Every architectural choice serves this principle:

- The unified Processor+Span model ensures that every point where the agent's reasoning can be intercepted is also a point where the reasoning is observed. There is no "extended but unobserved" path.
- The `processStepOutput` pipeline stage is the designated fact injection point — where external verification results, lint outputs, test results, and other ground truths are injected back into the agent's context.
- The three vertical layers (Control, Evaluation, Agent Harness) map to three categories of Processors: PermissionProcessor (Control), GuardrailProcessor + ScorerProcessor (Evaluation), and all other Processors (Agent).

### Reference Frameworks

This design synthesizes patterns from seven reference frameworks:
- **Mastra**: Processor pipeline, observability architecture (30+ span types), OTel bridge
- **OpenCode**: Plugin SDK with comprehensive hooks, Effect-based DI, Bus event system
- **Pi-mono**: Minimal core + maximum extensibility philosophy, event-driven extension API
- **DeepAgents**: Middleware stack, HarnessProfile per provider/model, backend protocol
- **CrewAI**: Global hook system, EventBus with scope nesting, Flow orchestration
- **AgentScope**: Metaclass AOP hooks, onion-model middleware, OTel integration
- **OpenHarness**: Plugin manifest system, multi-agent coordination, permission modes
