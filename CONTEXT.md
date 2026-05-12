# Domain Glossary

## Core Abstractions

### Harness
All code, configuration, and execution logic wrapped around the AI model. Model provides raw reasoning capability; Harness provides everything that makes this capability reliable, safe, and useful. The analogy: Model = CPU, Context Window = RAM, Harness = Operating System, Agent = Application.

### Agent
Agent = Model + Harness. Not just the model, but the entire runtime environment.

### Truth Gap
The fundamental gap between a model's internal reasoning (static training data + self-referential context window) and externally observable, verifiable ground truth. Hallucination and drift are not model bugs but inevitable behavior of closed reasoning systems without external fact constraints.

### Fact Injection
The core action of Harness engineering: at each key reasoning node, find and inject the minimum verifiable external fact. Quality ceiling of reasoning = strength of observable fact constraints.

## Three Core Loops

### Execution Loop (Plan → Execute → Verify)
The structured pipeline for organizing work: Planner decomposes goals, Generator implements incrementally, Evaluator verifies independently (no shared internal state with Generator).

### Knowledge Loop (Context Engineering + Cross-session Memory)
Managing information across sessions: structured handoff files, environment initialization scripts, progressive disclosure (AGENTS.md as index, not manual), proactive context reset, sub-agent context isolation, doc gardening.

### Evolution Loop (Ralph Wiggum Feedback)
Agent makes error → human analyzes root cause → add rule/tool/lint → Agent constrained → never makes same error again. Harness itself must also be iteratively simplified as model capabilities grow.

## Three Vertical Layers

### Control Harness
Permissions, environment isolation, behavioral constraints, rate limiting. Answers "can it do this, and to what extent?"

### Evaluation Harness
Automated testing, scoring, acceptance criteria, linting, self-verification loops. Answers "did it do it correctly?"

### Agent Harness
Model calls, tools/skills/MCP, task decomposition, sub-agent orchestration, compression, memory, context management. Answers "doing the work."

## Key Mechanisms

### Sprint Contract
Written agreement between Generator and Evaluator on the definition of "done" for each sprint. A document, not a mental model.

### Progressive Disclosure
AGENTS.md ~100 lines as directory index pointing to deeper structured knowledge. Agent reads small stable entry first, deepens on demand.

### Context Rot Defense
Compression, tool output truncation, progressive disclosure — preventing model from losing coherence in overly long contexts.

## Resolved Design Decisions

- **Language**: TypeScript
- **Execution model**: Processor Pipeline
- **Extension + Observability**: Unified model — each pipeline stage is both extension point and span
- **State model**: Four-region PipelineContext — `request` (immutable), `agent` (config + prompt), `iteration` (step state), `session` (cross-iteration) — replacing the former untyped `pipeline: Record<string, unknown>`
- **Plugin system**: Code factory function — `(harness: HarnessAPI) => PluginRegistration`
- **Observability backend**: Self-built lightweight abstraction (Span/Tracer/Metrics) + OTel Bridge
- **Sub-agents**: Dual-mode — sync (tool-like, blocking) + async (background task, event notification)
- **Tool execution**: AgentForge-controlled agentic loop — `invokeLLM` does single-step `streamText()` (no `maxSteps`, no execute on tools); `PipelineRunner` consumes `fullStream` extracting text/tool-calls/reasoning; `executeTools` processor executes pending tool calls via `ToolRegistry.executeTool()`; `evaluateIteration` loops on tool results. AI SDK provides schemas only via `toAiSdkToolSchemas()`.
- **Package structure**: 5-package monorepo — core, observability, plugins, tools, sdk
- **LLM Provider**: Pluggable GatewayChain + dedicated providers — `resolveModel()` delegates to `GatewayChain` (custom gateways → `BuiltInGateway`); native `@ai-sdk/deepseek` provider handles reasoning_content; `LLMInvoker` wraps single-step `streamText()` owning retry + token + reasoning extraction
- **Memory**: Processor plugin (not core) — official MemoryProcessor in plugins package, storage backends injectable
- **Compression**: Hybrid two-phase — micro-compression (truncate tool output) first, then LLM summarization if needed
- **Streaming**: Unified single path — `run()` and `stream()` share the same pipeline; `PipelineRunner.run()` collects textStream into response, `PipelineRunner.stream()` yields `StreamEvent` chunks; LLMInvoker always produces streaming output, consumption mode differs at PipelineRunner level
- **Permission**: Processor implementation — beforeTool Processor in executeTools sub-pipeline, three modes (interactive/plan-only/full-auto)
- **HITL**: Suspend/resume — Processor calls context.suspend(reason), state persisted, harness.resume(sessionId, input) to continue
- **Config**: JSONC + multi-level merging (global ~/.agentforge/ > project .agentforge/ > session-level), validated via Zod
- **Session**: JSONL file storage with tree branching (parentId), human-readable, no database dependency
- **MCP**: Plugin implementation — MCP client as a Plugin providing tool registration and lifecycle management
- **Skill**: agentskills.io standard — SKILL.md files, progressive disclosure via SkillProcessor in buildContext stage
- **Hook system**: Lightweight interception alongside Processors — Hooks observe/modify context without control flow; Processors handle business logic with abort capability; Hooks have explicit priority ordering
- **EventBus**: Decoupled broadcast system — lifecycle events emitted at each pipeline point; plugins and subsystems subscribe to relevant events; backbone for session persistence, background tasks, and monitoring
- **Dynamic config**: `Dynamic<T> = T | ((ctx) => T)` — AgentConfig fields accept functions resolved per-request at `processInput` stage
- **Model routing**: Gateway chain — pluggable `ModelGateway` implementations via `GatewayChain`; `BuiltInGateway` wraps 4 native providers (openai, anthropic, google, deepseek); `OpenAICompatibleGateway` connects custom endpoints via `GatewayConfig`; first-match-wins resolution; `registerProvider()` backward compatible
- **Model profile**: Per-model behavior customization — `ModelProfile` with systemPromptSuffix, toolOverrides, extraPromptFragments; registered per model pattern
- **Runtime safety**: Built-in circuit breaker (consecutive tool call limit, total tool call limit, stagnation detection), model fallback chains (ordered retry across providers), concurrency controller (per-key slot management)
- **Tool management**: Dynamic tool group activation/deactivation; tool result eviction for large outputs
- **Processor modularity**: 8 built-in processors extracted from Agent into `core/processors/` — each stage is a standalone module; factory functions for dependency-injected processors (`invokeLLM`, `buildContext`, `prepareStep`), const exports for pure/no-op processors; Agent is pure orchestration
- **Provider compatibility**: `ProviderCapabilities` detection per model string + `CompatRule` engine with preemptive (message rewrite before LLM call) and reactive (history fix on API error) rules; `providerOptions` passthrough from `AgentConfig` to `streamText()`; dedicated `@ai-sdk/deepseek` provider for native reasoning_content handling

## Pipeline Architecture

### Pipeline Stage
Each stage is simultaneously an **extension point** (Processor interface), an **observability span** (auto-traced), and a **Hook point** (cross-cutting interception). One registration solves extensibility, observability, and cross-cutting concerns.

### Pipeline Context — Four Regions

```
PipelineContext
├── request       — immutable input data (user message, session ID, metadata)
├── agent         — agent configuration (config, systemPrompt, toolDeclarations, promptFragments)
├── iteration     — current step state (step number, fullStream, response, pendingToolCalls, reasoningContent, loopDirective, span)
└── session       — cross-iteration state (messageHistory, totalTokenUsage, custom plugin data)
```

### Agent Lifecycle Pipeline
```
processInput → buildContext → [Agentic Loop:
  prepareStep → invokeLLM → processStepOutput → executeTools → evaluateIteration
] → processOutput
```

- `processInput`: Input validation/transformation, Dynamic config resolution
- `buildContext`: System prompt construction from PromptFragments, tool declarations, memory loading, ModelProfile application
- `prepareStep`: Message history preparation/compression, tool availability filtering (tool groups)
- `invokeLLM`: Single-step `streamText()` call with compat rules preprocessing + providerOptions passthrough
- `processStepOutput`: Appends assistant message (text + toolCalls + reasoningContent) to history
- `executeTools`: Executes pending tool calls via `ToolRegistry.executeTool()`, appends tool result messages to history
- `evaluateIteration`: Token accumulation; loops on tool results (`continue`), stops otherwise; token overflow guard
- `processOutput`: Final output post-processing, result recording, session persistence

### Hook Points

| HookPoint | When | Use for |
|-----------|------|---------|
| `agent.start` | Before pipeline begins | Initialization, telemetry |
| `agent.end` | After pipeline completes | Cleanup, metrics |
| `stage.before` | Before any stage executes | Context injection |
| `stage.after` | After any stage completes | Post-processing |
| `llm.before` | Before LLM call | Prompt modification |
| `llm.after` | After LLM response | Response transformation |
| `llm.wrap` | Wraps entire LLM call | Error recovery, caching |
| `tool.before` | Before tool execution | Permission checks |
| `tool.after` | After tool execution | Logging, eviction |
| `tool.wrap` | Wraps entire tool execution | Result eviction, timing |
| `iteration.end` | After each agentic loop iteration | Progress tracking |
| `error` | On any error | Error reporting |

### Event Bus Events

Lifecycle events emitted at each pipeline point, consumed by session persistence, background tasks, stagnation detection, and monitoring subsystems.
