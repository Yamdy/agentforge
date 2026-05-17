# ADR-0008: Cross-Framework Insights — Dynamic Config, Gateway Routing, Tool Eviction, Model Profiles

## Status

Accepted

## Context

After analyzing five agent systems (OpenCode, oh-my-openagent, Mastra, DeepAgents, AgentScope), we identified patterns that are generalizable to any agent framework, not specific to coding agents. These patterns address per-request customization, model routing extensibility, context overflow prevention, and per-model behavior adaptation.

## Decision

### 1. Dynamic Config Resolution (from Mastra)

`Dynamic<T> = T | ((ctx: ResolveContext) => T | Promise<T>)` — AgentConfig fields accept static values or functions resolved per-request. Resolution happens at `processInput` stage; subsequent stages see frozen static values.

**Why:** Framework users need per-request customization without subclassing. Mastra applies this to model, tools, instructions, memory, and scorers.

### 2. Gateway-Based Model Routing (from Mastra)

Replace the hardcoded `PROVIDER_MAP` with a pluggable `ModelGateway` chain:

```typescript
interface ModelGateway {
  name: string;
  canResolve(modelString: string): boolean;
  resolve(modelString: string): Promise<LanguageModel>;
}
```

Built-in gateways: `ProviderGateway` (OpenAI/Anthropic/Google), `CustomGateway` (user-registered providers). Resolution tries gateways in order, first match wins. Users can add gateways for load balancing, cost optimization, or custom routing.

**Why:** Hardcoded provider map can't handle custom providers, gateways, or routing strategies without code modification.

### 3. Middleware Wrap Pattern (from DeepAgents)

Add `tool.wrap` and `llm.wrap` HookPoints that see both request and response in a single handler, unlike the separate `before`/`after` pairs. Wrap hooks can override results, modify args, and handle errors.

**Why:** Separate before/after hooks can't correlate request and response in one scope. Wrap enables result eviction, error recovery, and response transformation.

### 4. Tool Result Eviction (from DeepAgents)

When tool output exceeds a token threshold, automatically offload to storage and replace with truncated preview + reference. Implemented as a built-in `tool.wrap` Hook.

**Why:** Large tool outputs saturate the context window. DeepAgents evicts to filesystem; we make the eviction handler pluggable.

### 5. Model Profiles (from DeepAgents HarnessProfile)

Per-model behavior customization registered by model pattern:

```typescript
interface ModelProfile {
  modelPattern: string | RegExp;
  systemPromptSuffix?: string;
  toolOverrides?: { [toolName: string]: { description?: string; exclude?: boolean } };
  extraPromptFragments?: PromptFragment[];
}
```

Applied at `buildContext` stage when the current model matches a profile. Replaces hardcoded if-else on model names.

**Why:** Different models have different capabilities and quirks. A framework shouldn't hardcode model-specific behavior; it should provide a profile mechanism for users to declare per-model adaptations.

### 6. Tool Group Self-Management (from AgentScope)

Dynamic tool activation/deactivation through `AgentState.toolGroups`. Framework provides a built-in `manage_tools` tool for agents to toggle groups at runtime. Optional — users who don't register groups get all tools active (current behavior).

**Why:** Agents with many tools can benefit from adaptive capability management — activating only relevant tools for the current task reduces prompt noise and token usage.

### 7. Dual-Mode Memory Trigger (from AgentScope)

Memory access can be `automatic` (framework-controlled load/store), `agent-controlled` (exposes retrieve/store as tools), or `both`. Config option on MemoryProcessor.

**Why:** Some agents benefit from transparent memory; others need explicit control over what gets stored and retrieved. Framework shouldn't impose one strategy.

## Consequences

**Positive:**
- Framework users get per-request customization without API complexity
- Model routing is extensible for any provider or routing strategy
- Tool eviction prevents context overflow without user intervention
- Model profiles enable multi-model support without framework code changes

**Negative:**
- `Dynamic<T>` adds type complexity to AgentConfig — resolution must happen before PipelineRunner
- Gateway chain adds indirection to model resolution — debugging requires tracing through gateways
- Model profiles introduce another config layer to manage

## Considered Options

- **Static config only (current)**: No per-request customization. Rejected — framework users need it.
- **Subclassing for customization**: Users extend Agent class. Rejected — Mastra proves function-based resolution is cleaner.
- **Single provider map (current)**: Can't add custom routing. Rejected — not extensible.
