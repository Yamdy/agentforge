Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the plugin system with full lifecycle management, resource declarations, Hook registration, and EventBus subscription.

**HarnessAPI (enhanced):**
- `registerProcessor(processor)` — registers a Processor at its declared stage
- `registerTool(tool)` — registers a Tool into the ToolRegistry
- `registerCommand(name, handler)` — registers a slash command
- `registerHook(hook: Hook)` — registers a Hook at a HookPoint with priority
- `subscribe(type, handler)` — subscribes to EventBus events, returns unsubscribe function
- `registerResource(declaration: ResourceDeclaration)` — declares an external resource (MCP server, database, etc.) with start/stop lifecycle
- `registerProvider(name, factory)` — registers a custom model provider into the Gateway chain

**Resource declaration:**
```typescript
interface ResourceDeclaration {
  id: string;
  type: string;  // 'mcp-server', 'database', 'http-client', etc.
  config: Record<string, unknown>;
  start: () => Promise<unknown>;
  stop: (instance: unknown) => Promise<void>;
}
```

**Plugin lifecycle:**
1. **resolve** — Find the plugin module (file path, npm package, directory)
2. **load** — Dynamic import the module, extract factory function
3. **initialize** — Call `initializeAll()` which runs all registered resource `start()` functions
4. **activate** — Registered Processors/Hooks/Tools become active in the pipeline
5. **shutdown** — Call `shutdown()` which runs all resource `stop()` functions and cleans up subscriptions

**PluginManager interface:**
```typescript
interface PluginManager {
  loadPlugin(spec: string | PluginFactory): Promise<void>;
  initializeAll(): Promise<void>;
  shutdown(): Promise<void>;
  getErrors(): PluginError[];
}
```

## Acceptance criteria

- [ ] Plugin factory function receives enhanced HarnessAPI with registerHook, subscribe, registerResource, registerProvider
- [ ] Plugins can register Processors at any pipeline stage
- [ ] Plugins can register Hooks at any HookPoint
- [ ] Plugins can subscribe to EventBus events and receive them
- [ ] Plugins can declare resources with start/stop lifecycle
- [ ] `initializeAll()` starts all declared resources
- [ ] `shutdown()` stops all resources and cleans up subscriptions
- [ ] Plugin initialization errors are caught and reported without crashing the framework
- [ ] Test plugin loads, registers Processor + Hook + Tool + Resource, all work in pipeline

## Blocked by

- Plan A (Foundation — SDK types, EventBus, HookRunner)

## User stories covered

17, 18, 19
