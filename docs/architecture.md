# Architecture

AgentForge is built around a **Processor Pipeline** model where the agent lifecycle is a linear sequence of stages. Each stage is simultaneously an extension point (Processor), an observability span, and a hook interception point.

## Pipeline Stages

The agent lifecycle consists of 10 stages divided into three phases:

```
Pre-Loop:
  processInput ──> buildContext

Agentic Loop (repeats until stop):
  prepareStep ──> gateLLM ──> invokeLLM ──> processStepOutput ──> gateTool ──> executeTools ──> evaluateIteration

Post-Loop:
  processOutput
```

### Pre-Loop Stages

| Stage | Description | Type |
|-------|-------------|------|
| `processInput` | Resolves Dynamic config, creates session, sets up initial context | Substantive |
| `buildContext` | Assembles system prompt, tool declarations, and prompt fragments | Substantive |

### Loop Stages

| Stage | Description | Type |
|-------|-------------|------|
| `prepareStep` | Resets per-iteration state, increments step counter | Extension point |
| `gateLLM` | Pre-LLM gate for rate limiting, cost caps, token budgets | Extension point |
| `invokeLLM` | Calls the LLM via Vercel AI SDK streamText() | Substantive |
| `processStepOutput` | Post-LLM processing of response and tool calls | Extension point |
| `gateTool` | Pre-tool gate for permission checks | Extension point |
| `executeTools` | Executes pending tool calls with before/after hooks | Substantive |
| `evaluateIteration` | Determines loop continuation (stop/continue/retry) | Substantive |

### Post-Loop Stages

| Stage | Description | Type |
|-------|-------------|------|
| `processOutput` | Final processing of the completed response | Extension point |

## Seven Core Modules

| Module | Source | Responsibility |
|--------|--------|---------------|
| **PipelineRunner** | `core/pipeline.ts` | Executes stages sequentially, manages hooks and spans |
| **ContextBuilder** | `core/context-builder.ts` | Assembles PipelineContext from config, tools, and fragments |
| **LLMInvoker** | `core/llm-invoker.ts` | Single-step LLM invocation via Vercel AI SDK |
| **ToolRegistry** | `core/tool-registry.ts` | Tool registration, schema conversion, lookup |
| **EventSystem** | `core/event-system.ts` + `event-bus.ts` | Pub/sub with event replay |
| **HookManager** | `core/hook-manager.ts` | Before/after interception at fixed points |
| **CheckpointStore** | `core/checkpoint-store.ts` | Pipeline state persistence for suspend/resume |

## Three-Form Architecture

AgentForge's architecture maps to three orthogonal forms of injecting behavior:

### Form 1: Agent Loop (the core while-loop)

The fundamental agent pattern: while loop + LLM call + tool execution.

| Capability | Implementation |
|-----------|---------------|
| While loop | `LoopOrchestrator.runLoop()` / `streamLoop()` |
| LLM call | `LLMInvoker.invoke()` / `stream()` |
| Tools | `ToolRegistry` + `executeTools` processor |
| Context assembly | `ContextBuilder.assemble()` |

### Form 2: Harness (observe, control, intervene)

The control layer that wraps the agent loop without affecting its correctness.

| Capability | Implementation |
|-----------|---------------|
| Observe | `EventSystem` + span attributes + events |
| Control | `StateMachine` + token cap + step limit |
| Intervene | `HookManager` + compat rules + abort |

### Form 3: Runtime (lifecycle infrastructure)

The operational layer for running agents in production.

| Capability | Implementation |
|-----------|---------------|
| EventBus | `EventSystem` (dispatch + replay) |
| LifecycleState | `StateMachine` (pending/running/completed/paused/cancelled/error) |
| Hooks | `HookManager` (persistent hook registry) |

## AOP Three Methods

| Method | Mechanism | Code |
|--------|-----------|------|
| **Callback/Hook** | Fixed-position interception | `HookManager`, tool before/after hooks |
| **Flow as Data** | Configurable pipeline stages | `LoopOrchestrator` stage arrays + `PipelineStageConfig` |
| **Side Observing** | Non-intrusive event emission | `EventSystem` (emit + replay) |

## Pipeline Context

Every stage receives a `PipelineContext` with four regions:

```
PipelineContext
  +-- request      (immutable: input message, sessionId)
  +-- agent        (config: model, systemPrompt, toolDeclarations, promptFragments)
  +-- iteration    (per-step: step number, response, loopDirective, span)
  +-- session      (cross-iteration: messageHistory, tokenUsage, custom plugin data)
```

**Important rules:**
- `request` is immutable after creation
- `agent.promptFragments` is append-only (always spread existing: `[...ctx.agent.promptFragments, new]`)
- `iteration` is reset at the start of each loop iteration
- `session` persists across iterations

## State Machine

Agent lifecycle follows a strict state machine:

```
pending --> running --> completed
   |          |----> paused    (suspend)
   |          |----> cancelled
   |          |----> error
   |
   +----> (terminal states can be reset to pending for multiple run() calls)
```

## Model Resolution

Models are resolved through a chain of gateways:

1. Parse model string: `"provider/modelId"` -> `{ provider, modelId }`
2. `ModelFactory` tries registered gateways in order
3. Built-in gateway handles: `openai`, `anthropic`, `google`, `deepseek`
4. Custom gateways via `OpenAICompatibleGateway` for any OpenAI-compatible API

## Dependency Graph

```
sdk (zero deps)
  <-- tools
  <-- observability
  <-- core (depends on sdk, observability, tools)
      <-- plugins (depends on sdk, core)
          <-- server (depends on sdk, core, plugins)
```
