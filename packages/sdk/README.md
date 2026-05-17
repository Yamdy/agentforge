# @primo-ai/sdk

Pure type definitions for the AgentForge framework. Zero dependencies.

## Overview

This package contains all shared types used across the AgentForge monorepo. It has no runtime code and zero dependencies -- it exists solely to provide TypeScript interfaces and type aliases.

## Key Types

### Pipeline

| Type | Description |
|------|-------------|
| `PipelineStage` | Union of all 13 stage names |
| `StageName` | `PipelineStage` plus arbitrary plugin-defined strings |
| `Processor` | `{ stage, execute(context) => Promise<ProcessorResult> }` |
| `ProcessorResult` | `PipelineContext \| AbortSignal \| SuspensionSignal` |
| `PipelineContext` | Container with `request`, `agent`, `iteration`, `session` regions |
| `LoopDirective` | `{ action: 'continue' \| 'stop' \| 'retry' }` |

### Context Regions

| Type | Description |
|------|-------------|
| `RequestRegion` | Immutable input: `input`, `sessionId` |
| `AgentRegion` | Config: `config`, `systemPrompt`, `toolDeclarations`, `promptFragments` |
| `IterationRegion` | Per-step: `step`, `response`, `loopDirective`, `pendingToolCalls` |
| `SessionRegion` | Cross-iteration: `messageHistory`, `totalTokenUsage`, `custom` |

### Tools

| Type | Description |
|------|-------------|
| `Tool<TInput, TOutput>` | Tool definition with `name`, `description`, `inputSchema`, `execute()` |
| `ToolCall` | LLM-requested tool invocation: `id`, `name`, `args` |
| `ToolResult` | Tool execution result: `toolCallId`, `name`, `output` |

### Observability

| Type | Description |
|------|-------------|
| `Span` | Observability span with `startChild()`, `setAttribute()`, `end()` |
| `Tracer` | Span factory: `startSpan(name)` |
| `Metrics` | Counter/gauge/histogram interface |
| `TokenUsage` | `{ input: number; output: number }` |

### Plugin System

| Type | Description |
|------|-------------|
| `HarnessAPI` | Plugin harness: register processors, tools, hooks, resources |
| `PluginRegistration` | Plugin return type: processors, tools, commands |
| `Hook<TInput, TOutput>` | Before/after hook with point, handler, priority |
| `HookPoint` | `agent.start`, `llm.before`, `tool.after`, etc. |
| `ResourceDeclaration` | Lifecycle resource: `start()`, `stop()` |

### Configuration

| Type | Description |
|------|-------------|
| `AgentConfig` | Agent configuration: `model`, `systemPrompt`, `tools`, `maxIterations` |
| `Dynamic<T>` | `T \| ((ctx) => T)` -- static or per-request resolved value |
| `HarnessConfig` | Top-level config: agents, plugins, session, model profiles |
| `ModelProfile` | Per-model behavior customization |
| `ModelGateway` | Pluggable model resolver interface |
| `GatewayConfig` | Serializable gateway configuration |

### Session

| Type | Description |
|------|-------------|
| `SessionRecord` | Session metadata: `sessionId`, `status`, `tokenUsage` |
| `SessionEvent` | Sequential event: `seq`, `type`, `payload` |
| `SessionStorage` | Storage interface: `append()`, `read()`, `list()` |
| `SessionManager` | High-level session management: `start()`, `suspend()`, `resume()` |

### A2A Protocol

| Type | Description |
|------|-------------|
| `A2ATask` | Task with `id`, `contextId`, `status`, `history`, `artifacts` |
| `A2AMessage` | Message with `role`, `parts` (text/data/file) |
| `A2AAgentCard` | Agent metadata: `name`, `skills`, `capabilities` |
| `JsonRpcRequest` | JSON-RPC 2.0 request |
| `JsonRpcResponse` | JSON-RPC 2.0 response |

### Client SDK

| Export | Description |
|--------|-------------|
| `AgentForgeClient` | HTTP client for connecting to AgentForge servers |
| `parseSSE` | Parse server-sent events |
