# Tool Result Eviction Design

Date: 2026-05-11

## Problem

Large tool outputs consume context window space. When a tool returns megabytes of data (file reads, API responses, database queries), the LLM's context fills up, degrading reasoning quality or causing failures. Current mitigation is `ToolRegistry.truncateOutput()` which discards data beyond a hard limit with no recovery path.

## Solution

Two-part design: a generic `tool.wrap` Hook system in PluginManager, plus an `evictionPlugin` that offloads large outputs to pluggable storage and replaces them with a preview + reference.

## Part 1: Generic `tool.wrap` Hook

### PluginManager.invokeWrapHook()

New async method that chains hook return values:

```typescript
async invokeWrapHook(point: HookPoint, data: unknown): Promise<unknown> {
  const hooks = this.hooks.get(point) ?? [];
  let current = data;
  for (const hook of this.getSortedHooks(point)) {
    const result = await hook.handler(current);
    if (result !== undefined) current = result;
  }
  return current;
}
```

- Hooks sorted by priority (lower = runs first), cached at registration time
- `await` handles both sync and async handlers
- Return `undefined` = pass-through (no modification)
- Return non-undefined = replaces current data, feeds into next hook

### ToolWrapContext

Typed context passed to `tool.wrap` hooks:

```typescript
interface ToolWrapContext {
  toolName: string;
  args: unknown;
  result: unknown;
  sessionId: string;
}
```

### ToolRegistry integration

No constructor changes. Instead, `ToolRegistry.executionContext` (already exists) is expanded at runtime to include `pluginManager` and `sessionId`:

```typescript
// agent.ts — before toAiSdkTools() call
registry.executionContext = {
  span: stageSpan,
  sessionId: ctx.request.sessionId,
  pluginManager: this.pluginManager,
};
```

Inside `toAiSdkTools()` execute wrapper, after tool execution succeeds:

```typescript
const ctx = this.executionContext;
if (ctx?.pluginManager) {
  const wrapped = await ctx.pluginManager.invokeWrapHook('tool.wrap', {
    toolName: tool.name,
    args,
    result: toolResult,
    sessionId: ctx.sessionId ?? '',
  });
  if (wrapped && typeof wrapped === 'object' && 'result' in wrapped) {
    toolResult = (wrapped as ToolWrapContext).result;
  }
}
```

### Agent integration

`Agent` constructor creates an internal `PluginManager` instance. The `use(pluginFactory)` method delegates to `pluginManager.initializePlugin(factory)`. The invokeLLM processor sets `executionContext.pluginManager` before calling `toAiSdkTools()`.

### Circular dependency avoidance

`PluginManager` holds `ToolRegistry` (constructor injection). `ToolRegistry` does NOT hold `PluginManager` — it receives it at runtime via `executionContext`, set by `Agent` during pipeline execution.

## Part 2: evictionPlugin

### EvictionStorage interface

```typescript
interface EvictionStorage {
  store(sessionId: string, key: string, content: unknown): Promise<string>;
  retrieve(sessionId: string, reference: string): Promise<unknown>;
}
```

### InMemoryEvictionStorage

Default implementation using a `Map<string, unknown>`. Key format: `${sessionId}:${toolName}:${timestamp}`.

### EvictedResult

```typescript
interface EvictedResult {
  preview: string;
  reference: string;
  evicted: true;
}
```

### evictionPlugin options

```typescript
interface EvictionPluginOptions {
  maxSize: number;           // character threshold
  storage: EvictionStorage;
  previewLength?: number;    // default 500
}
```

### Plugin registration

Registers a `tool.wrap` hook via `api.registerHook()`. The hook:

1. Receives `ToolWrapContext`
2. Serializes `result` to string (JSON.stringify for objects)
3. Checks length against `maxSize`
4. If over: `store()` → returns `{ ...ctx, result: { preview, reference, evicted: true } }`
5. If under: returns `undefined` (pass-through)

## File locations

- `packages/sdk/src/index.ts` — add `ToolWrapContext`, `EvictionStorage`, `EvictedResult` types
- `packages/core/src/plugin-manager.ts` — add `invokeWrapHook()`, cache sorted hooks
- `packages/core/src/tool-registry.ts` — call wrap hook in execute wrapper
- `packages/core/src/agent.ts` — create PluginManager, set executionContext
- `packages/plugins/src/eviction/eviction-storage.ts` — interface + InMemoryEvictionStorage
- `packages/plugins/src/eviction/eviction-plugin.ts` — evictionPlugin factory
- `packages/plugins/src/eviction/index.ts` — exports
- `packages/plugins/__tests__/eviction.test.ts` — tests

## Red team review findings addressed

1. invokeWrapHook is async — handles Promise-returning handlers correctly
2. sessionId passed via ToolExecutionContext, available in toAiSdkTools() closure
3. No circular dependency — ToolRegistry gets pluginManager at runtime, not construction
4. Agent creates PluginManager and wires it into executionContext
5. ToolWrapContext typed — wrap hook receives structured data
6. Hook sorting cached at registration time
