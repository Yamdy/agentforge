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
- **State model**: Single Context object passed through pipeline
- **Plugin system**: Code factory function — `(harness: HarnessAPI) => PluginHooks`
- **Observability backend**: Self-built lightweight abstraction (Span/Tracer/Metrics) + OTel Bridge
- **Sub-agents**: Dual-mode — sync (tool-like, blocking) + async (background task, event notification)
- **Tool execution**: Leverage AI SDK built-in multi-step loop — ToolRegistry generates AI SDK-compatible tools via `toAiSdkTools()` adapter, `streamText` + `maxSteps` handles detection/execution/looping; before/after hooks as execute wrapper callbacks, not separate sub-pipeline
- **Package structure**: 5-package monorepo — core, observability, plugins, tools, sdk
- **LLM Provider**: Bundled SDK Map — built-in dynamic import for OpenAI/Anthropic/Google via `@ai-sdk/*` packages (zero config), `registerProvider()` for custom/test providers (priority override), async `resolveModel()` with SDK instance caching
- **Memory**: Processor plugin (not core) — official MemoryProcessor in plugins package, storage backends injectable
- **Compression**: Hybrid two-phase — micro-compression (truncate tool output) first, then LLM summarization if needed
- **Streaming**: AsyncGenerator — pipeline stages pass streaming data via AsyncGenerator, natural backpressure
- **Permission**: Processor implementation — beforeTool Processor in executeTools sub-pipeline, three modes (interactive/plan-only/full-auto)
- **HITL**: Suspend/resume — Processor calls context.suspend(reason), state persisted, harness.resume(sessionId, input) to continue
- **Config**: JSONC + multi-level merging (global ~/.harness/ > project .harness/ > session-level), validated via Zod
- **Session**: JSONL file storage with tree branching (parentId), human-readable, no database dependency
- **MCP**: Plugin implementation — MCP client as a Plugin providing tool registration and lifecycle management
- **Skill**: agentskills.io standard — SKILL.md files, progressive disclosure via SkillProcessor in buildContext stage

## Pipeline Architecture

### Pipeline Stage
Each stage is simultaneously an **extension point** (Processor interface) and an **observability span** (auto-traced). One registration solves both extensibility and observability.

### Agent Lifecycle Pipeline
```
processInput → buildContext → [Agentic Loop:
  prepareStep → invokeLLM → processStepOutput → executeTools → evaluateIteration
] → processOutput
```

- `processInput`: Initial input validation/transformation/enrichment
- `buildContext`: System prompt construction, AGENTS.md injection, memory loading, tool declaration, progressive skill disclosure
- `prepareStep`: Message history preparation/compression, tool availability filtering
- `invokeLLM`: LLM streaming call + output stream interception/transformation
- `processStepOutput`: Output validation (guardrail) + fact injection point
- `executeTools`: Tool dispatch (parallel/sequential) + per-tool sub-pipeline (beforeTool → execute → afterTool)
- `evaluateIteration`: Iteration decision (continue/stop/redirect), context overflow detection, compression trigger
- `processOutput`: Final output post-processing, result recording, fact verification trigger
