# Architecture Upgrade Design

Date: 2026-05-10
Status: Draft
Scope: Deep refactor of Issue 1-6 + interface spec for Issue 7-17

## Background

agentforge is a general-purpose agent development framework. Informed by analysis of five agent systems — OpenCode (coding agent runtime), oh-my-openagent (batteries-included plugin), Mastra (full-stack TypeScript framework), DeepAgents (Python middleware-first agent), AgentScope (Python multi-agent framework) — we identify patterns that are generalizable to any agent:

- Hook system for cross-cutting concerns (from OpenCode)
- Event bus for decoupled subsystem communication (from oh-my-openagent BackgroundManager)
- Runtime safety: circuit breaker, model fallback, concurrency control, stagnation detection
- Dynamic prompt assembly at runtime
- Session persistence via event sourcing
- Dynamic config resolution — fields accept `T | ((ctx) => T)` for per-request customization (from Mastra)
- Gateway-based model routing — pluggable resolver chain instead of hardcoded provider map (from Mastra)
- Middleware wrap pattern — single hook that sees both request and response (from DeepAgents)
- Tool result eviction — automatic offloading of large outputs (from DeepAgents)
- Model profile — per-model behavior customization (from DeepAgents HarnessProfile)
- Tool group self-management — agents dynamically activate/deactivate tools (from AgentScope)
- Dual-mode memory trigger — automatic vs agent-controlled (from AgentScope)

These patterns require three structural upgrades plus targeted enhancements to the existing codebase.

## Structural Upgrade 1: Typed PipelineContext

### Problem

Current `PipelineContext.pipeline` is `PipelineState` — effectively `Record<string, unknown>` with a few optional fields. Processors hang arbitrary keys with no type guarantee. Implicit contracts between Processors (e.g., `invokeLLM` writes `textStream`, `PipelineRunner` reads it) are untyped.

### Design

Split `PipelineContext` into four typed regions:

```typescript
interface PipelineContext {
  request: RequestContext;
  agent: AgentState;
  iteration: IterationState;
  session: SessionState;
}

interface RequestContext {
  input: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

interface AgentState {
  config: AgentConfig;
  systemPrompt?: string;
  toolDeclarations: ToolDeclaration[];
  promptFragments: PromptFragment[];
}

interface IterationState {
  step: number;
  textStream?: AsyncIterable<string>;
  usagePromise?: Promise<TokenUsage>;
  response?: string;
  tokenUsage?: TokenUsage;
  toolCalls?: ToolCallRecord[];
  stopLoop: boolean;
  retryFrom?: PipelineStage;
}

interface SessionState {
  messageHistory: MessageRecord[];
  totalTokenUsage: TokenUsage;
  custom: Record<string, unknown>;
}

interface PromptFragment {
  role: 'system' | 'context' | 'instruction';
  content: string;
  priority: number;
  source: string;
}

interface ToolDeclaration {
  name: string;
  description: string;
}

interface ToolCallRecord {
  name: string;
  args: unknown;
  result?: unknown;
  error?: Error;
}

interface MessageRecord {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  tokenUsage?: TokenUsage;
}
```

Key changes from current design:
- `pipeline._stopLoop` → `iteration.stopLoop`
- `pipeline._retryFrom` → `iteration.retryFrom`
- `pipeline._span` → accessed via Hook, not stored in context
- `session` gets explicit typed fields plus `custom` for plugin extension
- `AgentState.promptFragments` enables dynamic prompt assembly
- `IterationState.toolCalls` enables circuit breaker and stagnation detection

Framework positioning: all types are interfaces, not closed types. Plugin authors extend `SessionState.custom` for domain-specific state. The framework never assumes what kind of agent is running.

## Structural Upgrade 2: Hook Pipeline

### Problem

Current `Processor` interface mixes two concerns: logic control (change context, abort) and cross-cutting side effects (logging, telemetry, permission checks). Adding a logger requires implementing the full Processor interface. No priority ordering between Processors at the same stage.

### Design

Add a lightweight Hook system alongside Processors:

```typescript
type HookPoint =
  | 'agent.start'
  | 'agent.end'
  | 'stage.before'
  | 'stage.after'
  | 'llm.before'
  | 'llm.after'
  | 'tool.before'
  | 'tool.after'
  | 'iteration.end'
  | 'error';

interface Hook {
  point: HookPoint;
  handler: (input: HookInput, output: HookOutput) => void | Promise<void>;
  priority?: number;  // lower runs first, default 100
}

interface HookInput {
  readonly context: PipelineContext;
  readonly stage?: PipelineStage;
  readonly toolName?: string;
  readonly error?: Error;
}

interface HookOutput {
  mutate(context: Partial<PipelineContext>): void;
}
```

**Processor vs Hook separation:**

| | Processor | Hook |
|---|---|---|
| Control flow | Can return AbortSignal, change iteration routing | Cannot abort, only observe/modify |
| Registration | At specific PipelineStage | At specific HookPoint |
| Use for | Business logic (build prompt, invoke LLM, route) | Cross-cutting (logging, telemetry, permission, context injection) |
| Priority | Determined by registration order | Explicit `priority` field |

Hooks run at their designated point. Multiple hooks at the same point execute in priority order. Hooks receive a `mutate()` function for shallow-merging changes into context — they never replace the entire context.

## Structural Upgrade 3: EventBus

### Problem

Current `PluginManager` uses `Map<string, handler[]>` for events — insufficient for subsystem communication. Background tasks, session persistence, stagnation detection all need to react to agent lifecycle events without tight coupling.

### Design

```typescript
type AgentEvent =
  | { type: 'agent:start'; sessionId: string }
  | { type: 'agent:end'; sessionId: string; response: string }
  | { type: 'iteration:start'; sessionId: string; step: number }
  | { type: 'iteration:end'; sessionId: string; step: number; tokenUsage?: TokenUsage }
  | { type: 'llm:call'; sessionId: string; model: string; step: number }
  | { type: 'llm:result'; sessionId: string; usage: TokenUsage }
  | { type: 'tool:call'; sessionId: string; tool: string; args: unknown }
  | { type: 'tool:result'; sessionId: string; tool: string; result: unknown }
  | { type: 'tool:error'; sessionId: string; tool: string; error: Error }
  | { type: 'error'; sessionId: string; error: Error; fatal: boolean }
  | { type: 'idle'; sessionId: string }
  | { type: 'task:start'; taskId: string; parentSessionId: string }
  | { type: 'task:end'; taskId: string; parentSessionId: string; result: unknown }
  | { type: 'task:error'; taskId: string; error: Error };

interface EventBus {
  emit(event: AgentEvent): void;
  on<T extends AgentEvent['type']>(
    type: T,
    handler: (event: Extract<AgentEvent, { type: T }>) => void,
  ): () => void;
  once<T extends AgentEvent['type']>(
    type: T,
    handler: (event: Extract<AgentEvent, { type: T }>) => void,
  ): () => void;
}
```

**EventBus vs Hook:**

- **Hook**: synchronous/asynchronous interception on the execution path. Can modify data. Use for "check permission before tool execution".
- **EventBus**: async broadcast, decouples sender and receiver. Use for "background task completed, notify parent agent", "session persistence writes a record", "stagnation detector monitors iterations".

Framework emits events at each lifecycle point. Plugins and internal subsystems subscribe to events they care about. EventBus is the backbone for session persistence, background tasks, and monitoring.

## Runtime Safety

### Model Fallback Chain

Enhance `LLMInvoker` to support ordered fallback models:

```typescript
interface FallbackEntry {
  model: string;    // 'provider/model-id'
  priority: number; // 0 = highest, tried first
}

interface LLMInvokerOptions {
  model: string | FallbackEntry[];
  system?: string;
  retryOptions?: RetryOptions;
  tracer?: Tracer;
}
```

Behavior:
- Single string: unchanged (backward compatible)
- `FallbackEntry[]`: sorted by priority, try next on failure
- Each entry still uses `streamWithRetry` for transient retries
- Emits `llm:call` / `llm:result` / `error` events via EventBus
- Models resolved lazily — fallback chain is not all resolved at construction time

### Circuit Breaker

Processor registered at `evaluateIteration` stage:

```typescript
interface CircuitBreakerConfig {
  maxConsecutiveToolCalls: number;        // default 5
  maxTotalToolCalls: number;              // default 50
  maxIterationsWithoutProgress: number;   // default 3
}
```

Tracked via EventBus `tool:call` events and Hook `iteration.end`. Returns `AbortSignal` when triggered. Does not terminate the agent — the agentic loop catches it and decides next action.

### Concurrency Controller

Interface for Sub-Agent management:

```typescript
interface ConcurrencySlot {
  key: string;
  maxConcurrent: number;
}

interface ConcurrencyController {
  acquire(slot: ConcurrencySlot): Promise<() => void>;
  getActiveCount(key: string): number;
}
```

Framework provides built-in implementation. PluginManager and future TaskManager depend on it.

### Stagnation Detection

Subscribes to `iteration:end` events via EventBus:

```typescript
interface StagnationDetectorConfig {
  maxIdleIterations: number;  // default 3
  comparisonFn?: (prev: PipelineContext, curr: PipelineContext) => boolean;
}
```

Emits `idle` event when triggered. Upper layers (e.g., continuation Processor) can inject a continuation prompt.

## Plugin System Enhancement

### New HarnessAPI

```typescript
interface HarnessAPI {
  // Existing
  registerProcessor(processor: Processor): void;
  registerTool(tool: ToolDefinition): void;
  registerCommand(name: string, handler: (args: string) => Promise<void>): void;

  // New
  registerHook(hook: Hook): void;
  subscribe<T extends AgentEvent['type']>(
    type: T,
    handler: (event: Extract<AgentEvent, { type: T }>) => void,
  ): () => void;
  registerResource(resource: ResourceDeclaration): void;
  registerProvider(name: string, factory: ProviderFactory): void;
}
```

### Resource Declaration

Plugins declare external resources they need. Framework manages lifecycle:

```typescript
interface ResourceDeclaration {
  id: string;
  type: string;
  config: Record<string, unknown>;
  start: () => Promise<unknown>;
  stop: (instance: unknown) => Promise<void>;
}

interface ResourceHandle<T = unknown> {
  instance: T;
  status: 'starting' | 'ready' | 'stopping' | 'stopped';
}
```

Flow: plugin calls `api.registerResource(declaration)` → Agent startup calls `PluginManager.initializeAll()` which runs all `start()` → plugins access resource instances → Agent shutdown calls `PluginManager.shutdown()` which runs all `stop()`.

### Plugin Lifecycle

```typescript
interface PluginManager {
  loadPlugin(spec: string | PluginFactory): Promise<void>;
  initializeAll(): Promise<void>;
  shutdown(): Promise<void>;
  getErrors(): PluginError[];
}
```

## Intelligent Execution Layer

### Dynamic Prompt Assembly

Framework provides assembly mechanism, not prompt content:

1. Built-in `buildContext` Processor creates base fragment from `AgentConfig.systemPrompt`
2. Plugins inject fragments via Hook `stage.before` on `buildContext`
3. Built-in `prepareStep` Processor sorts fragments by priority, groups by role, assembles final system prompt
4. Hook `llm.before` allows last-mile modification

Framework consumers only care about "what to inject", not "how to assemble".

### Intent Routing Framework

Framework provides routing fields on context, not routing logic:

```typescript
interface RouteRule {
  match: (input: string, context: PipelineContext) => boolean | Promise<boolean>;
  target: {
    processor?: Processor;
    tools?: string[];
    config?: Partial<AgentConfig>;
  };
}
```

Users implement routing as a `processInput` Processor. Framework provides `PipelineContext` fields for tool whitelisting and config override.

### Context Injection

Via Hook `stage.before` on `buildContext` — plugins inject additional context as `PromptFragment` entries.

## Session Persistence

### Core Types

```typescript
interface SessionRecord {
  sessionId: string;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'completed' | 'suspended' | 'error';
  model?: string;
  tokenUsage: TokenUsage;
}

interface SessionEvent {
  seq: number;
  timestamp: string;
  type: AgentEvent['type'];
  payload: AgentEvent;
}
```

### Storage Interface

```typescript
interface SessionStorage {
  append(sessionId: string, event: SessionEvent): Promise<void>;
  read(sessionId: string): AsyncIterable<SessionEvent>;
  list(filter?: { parentSessionId?: string; status?: string }): Promise<SessionRecord[]>;
  updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void>;
}
```

Default implementation: filesystem JSONL. Interface allows swapping to database or remote storage.

### Session Manager

```typescript
interface SessionManager {
  start(input: string): Promise<SessionRecord>;
  restore(sessionId: string): Promise<PipelineContext>;
  suspend(sessionId: string, reason: string): Promise<void>;
  resume(sessionId: string, input?: string): Promise<string>;
  list(filter?: { parentSessionId?: string }): Promise<SessionRecord[]>;
}
```

Session persistence subscribes to EventBus and appends events to JSONL. Decoupled from agent execution — persistence failure does not affect agent runs.

Restore flow: stream all events from JSONL → replay agent:start through iteration/tool/llm events → reconstruct `SessionState` → caller passes reconstructed context to `Agent.run()`.

## Issue 7-17 Interface Specifications

### Issue 10: Sync Sub-Agents

```typescript
interface SubAgentConfig {
  name: string;
  model?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxIterations?: number;
  contextPolicy: 'isolated' | 'inherit' | 'summary-only';
}

interface SubAgentResult {
  response: string;
  tokenUsage: TokenUsage;
  sessionId: string;
}

function createSubAgentTool(config: SubAgentConfig): ToolDefinition;
```

Sub-agents emit `task:start` / `task:end` events via EventBus. Parent session records associations.

### Issue 17: Async Sub-Agents

```typescript
interface AsyncTaskConfig extends SubAgentConfig {
  concurrencySlot?: ConcurrencySlot;
  fallbackModels?: FallbackEntry[];
}

interface AsyncTaskHandle {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: SubAgentResult;
  error?: Error;
  cancel(): void;
  on_complete(handler: (result: SubAgentResult) => void): void;
}

interface TaskManager {
  launch(config: AsyncTaskConfig, prompt: string): Promise<AsyncTaskHandle>;
  get(taskId: string): AsyncTaskHandle | undefined;
  cancel(taskId: string): void;
  list(filter?: { parentSessionId?: string }): AsyncTaskHandle[];
}
```

TaskManager depends on EventBus and ConcurrencyController.

### Issue 11: Memory Plugin

```typescript
interface MemoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface MemoryBackend {
  store(sessionId: string, entry: MemoryEntry): Promise<void>;
  retrieve(sessionId: string, query?: { limit?: number; since?: string }): Promise<MemoryEntry[]>;
  search(query: string, options?: { limit?: number }): Promise<MemoryEntry[]>;
}
```

MemoryProcessor registered at `buildContext` stage, loads history from backend into promptFragments.

### Issue 12: Compression Plugin

```typescript
type CompressionPhase =
  | { type: 'truncate'; maxLength: number }
  | { type: 'summarize'; model: string; maxTokens: number }
  | { type: 'prune'; keepRecent: number };

interface CompressionConfig {
  maxContextTokens: number;
  phases: CompressionPhase[];
}
```

CompressionProcessor registered at `prepareStep` stage. Checks total token count, applies phases in order when over threshold.

### Issue 13: Permission Plugin

```typescript
interface PermissionRule {
  tool: string;
  action: 'allow' | 'deny' | 'ask';
  pattern?: string;
}

type PermissionMode = 'interactive' | 'plan-only' | 'full-auto';
```

PermissionProcessor registered as Hook `tool.before`. Checks rules, triggers HITL suspend for `ask` actions in interactive mode.

### Issue 14: Skill Plugin

```typescript
interface SkillDefinition {
  name: string;
  description: string;
  content: string;
  resources?: ResourceDeclaration[];
  tools?: ToolDefinition[];
}
```

SkillProcessor at `buildContext` stage. Discovers `.agentforge/skills/*/SKILL.md`, injects promptFragment and associated resources on demand.

### Issue 15: MCP Plugin

```typescript
interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
```

MCP plugin uses `registerResource` for server lifecycle, `registerTool` for MCP-provided tools. Coordinates with Skill Plugin: skill declares needed MCP server → MCP plugin starts it → skill injects tools.

### Issue 16: Configuration System

```typescript
interface HarnessConfig {
  agents?: Record<string, Partial<AgentConfig>>;
  tools?: { enabled?: string[]; disabled?: string[] };
  plugins?: string[];
  session?: { storage?: 'file' | 'memory'; path?: string };
  hooks?: Record<string, unknown>;
}
```

Layered merge: `~/.agentforge/config.jsonc` > `.agentforge/config.jsonc` > env `AGENTFORGE_CONFIG`. Validated via Zod schema.

## Updated AgentConfig

```typescript
interface AgentConfig {
  model: string;
  fallbackModels?: FallbackEntry[];
  systemPrompt?: string;
  maxIterations?: number;
  tools?: Tool[];
  // New
  circuitBreaker?: CircuitBreakerConfig;
  stagnationDetection?: StagnationDetectorConfig;
  session?: { storage?: SessionStorage; path?: string };
}
```

## Supplementary: Cross-Framework Insights

The following enhancements are derived from Mastra, DeepAgents, and AgentScope analysis, applied to agentforge as a general-purpose framework.

### Dynamic Config Resolution (from Mastra)

Mastra's `DynamicArgument<T, TRequestContext>` pattern lets every config field accept a static value OR a function resolved per-request. This is critical for a framework because users need per-request customization without subclassing.

**Apply to AgentConfig**:

```typescript
type Dynamic<T> = T | ((ctx: ResolveContext) => T | Promise<T>);

interface ResolveContext {
  input: string;
  sessionId: string;
  metadata: Record<string, unknown>;
}

interface AgentConfig {
  model: Dynamic<string | FallbackEntry[]>;
  systemPrompt?: Dynamic<string>;
  tools?: Dynamic<Tool[]>;
  maxIterations?: Dynamic<number>;
  // ... other fields
}
```

Resolution happens at `processInput` stage — the built-in Processor evaluates all `Dynamic` fields and freezes the resolved config into `PipelineContext.agent.config`. Subsequent stages see static values only.

### Gateway-Based Model Routing (from Mastra)

Replace the hardcoded `PROVIDER_MAP` with a pluggable Gateway chain:

```typescript
interface ModelGateway {
  name: string;
  canResolve(modelString: string): boolean;
  resolve(modelString: string): Promise<LanguageModel>;
}
```

Built-in gateways:
- `ProviderGateway` — current `PROVIDER_MAP` logic, resolves `openai/*`, `anthropic/*`, `google/*`
- `CustomGateway` — resolves models registered via `registerProvider()`

Users can add gateways for custom routing (e.g., load balancer, model router, cost optimizer). Resolution tries gateways in order, first match wins.

### Middleware Wrap Pattern (from DeepAgents)

Current Hook design has separate `llm.before` and `llm.after` points. DeepAgents shows that a single `wrap` hook is more powerful — it can see both request and response, modify both, and handle errors in one place.

**Enhancement**: Add `tool.wrap` and `llm.wrap` hook points:

```typescript
type HookPoint =
  // ... existing points
  | 'tool.wrap'    // wraps entire tool execution: see args + result/error
  | 'llm.wrap';    // wraps entire LLM call: see prompt + response/error

interface WrapHookInput {
  readonly context: PipelineContext;
  readonly stage?: PipelineStage;
  readonly toolName?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly error?: Error;
}

interface WrapHookOutput {
  mutate(context: Partial<PipelineContext>): void;
  overrideResult?(result: unknown): void;   // replace tool output
  overrideArgs?(args: unknown): void;        // modify tool args
}
```

This enables patterns like:
- **Tool result eviction** (from DeepAgents): `tool.wrap` hook checks output size, offloads large results, replaces with preview
- **Response transformation**: `llm.wrap` hook post-processes LLM output
- **Error recovery**: `llm.wrap` hook catches errors and provides fallback responses

The existing `llm.before` / `llm.after` / `tool.before` / `tool.after` remain for simpler cases. `wrap` hooks run instead of the before/after pair when registered.

### Tool Result Eviction (from DeepAgents)

When tool output exceeds a token threshold, automatically offload the full content and replace with a truncated preview + reference:

```typescript
interface EvictionConfig {
  maxTokens: number;           // threshold, default 20000
  evictionHandler: (content: unknown, context: PipelineContext) => Promise<string>;
  // returns a reference string (e.g., file path, storage key)
}

interface EvictionResult {
  preview: string;             // truncated preview
  reference: string;           // how to retrieve full content
  evicted: boolean;
}
```

Implemented as a built-in `tool.wrap` Hook. Framework provides a default `FileEvictionHandler` that writes to a temp file. Users can swap for database, object storage, etc.

### Model Profile (from DeepAgents HarnessProfile)

Per-model behavior customization, separate from per-request config:

```typescript
interface ModelProfile {
  modelPattern: string | RegExp;      // matches model string (e.g., 'anthropic/*')
  systemPromptSuffix?: string;        // appended to system prompt
  toolOverrides?: {                   // per-tool adjustments
    [toolName: string]: {
      description?: string;           // override tool description
      exclude?: boolean;              // hide tool from this model
    };
  };
  extraPromptFragments?: PromptFragment[];  // model-specific context
}
```

Profiles are registered via `HarnessAPI` or config file. The `buildContext` Processor checks profiles matching the current model and applies adjustments. This replaces hardcoded if-else on model names.

Example use case: a framework user building a coding agent registers a profile for Claude models that adds "prefer AST-aware edits" instruction, and a profile for GPT models that adds "use apply_patch format" instruction.

### Tool Group Self-Management (from AgentScope)

Allow dynamic tool activation/deactivation at runtime through `AgentState`:

```typescript
interface AgentState {
  // ... existing fields
  activeTools: string[];              // currently active tool names
  toolGroups: Record<string, {        // tool groups
    tools: string[];
    active: boolean;
  }>;
}
```

Framework provides a built-in `manage_tools` tool that the agent can call to activate/deactivate groups. The `prepareStep` Processor filters `toolDeclarations` to only include tools in active groups.

This is optional — users who don't register tool groups get all tools always active (current behavior).

### Dual-Mode Memory Trigger (from AgentScope)

Memory access can be either automatic (framework-controlled) or agent-controlled:

```typescript
type MemoryTriggerMode =
  | { type: 'automatic'; onLoad: 'always' | 'on-session-start' }
  | { type: 'agent-controlled' }  // registers retrieve/store as tools
  | { type: 'both' };             // auto-load + agent can override
```

This is a config option on `MemoryProcessor`. Framework doesn't impose one strategy — users choose based on their agent's needs.

## Package Responsibilities After Refactor

| Package | Responsibility |
|---|---|
| `@agentforge/sdk` | All type definitions (interfaces only, zero runtime) |
| `@agentforge/observability` | Span, Tracer, NoOp implementations, TestExporter |
| `@agentforge/core` | Agent, PipelineRunner, LLMInvoker, ToolRegistry, PluginManager, EventBus, ConcurrencyController, SessionManager, HookRunner, ModelGateway, ConcurrencyController |
| `@agentforge/tools` | Built-in tools (echoTool, manageTools, createSubAgentTool factory) |
| `@agentforge/plugins` | Official Processors: CircuitBreakerProcessor, StagnationDetector, MemoryProcessor, CompressionProcessor, PermissionProcessor, SkillProcessor, MCPProcessor, ToolEvictionHook, ModelProfileProcessor |
