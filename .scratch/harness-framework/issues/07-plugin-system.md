Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the plugin system that allows extensions to register Processors, Tools, Commands, and Providers through a type-safe factory function.

**HarnessAPI implementation:** The object passed to plugin factory functions. Methods:
- `registerProcessor(stage, processor)` — adds a Processor to a pipeline stage
- `registerTool(tool)` — adds a Tool to the ToolRegistry
- `registerCommand(name, handler)` — registers a slash command
- `registerProvider(providerConfig)` — registers a custom LLM provider
- `onEvent(eventType, handler)` — subscribes to lifecycle events (agent_start, agent_end, turn_start, turn_end, tool_execution_start, tool_execution_end, error)

**Plugin loader:** Load plugins from:
1. Explicit file paths (relative or absolute to .ts/.js files)
2. npm packages (import and call default export)
3. Project directories (`.harness/plugins/*/index.ts`)
4. Global directories (`~/.harness/plugins/*/index.ts`)

**Plugin lifecycle:**
1. **resolve** — Find the plugin module, check compatibility
2. **load** — Dynamic import the module
3. **initialize** — Call the factory function with HarnessAPI
4. **activate** — Registered Processors/Tools become active in the pipeline

**Test plugin:** A fixture plugin that registers a Processor (logs each stage) and a Tool (returns a fixed value). Used for integration testing.

## Acceptance criteria

- [ ] Plugin factory function `(harness: HarnessAPI) => PluginRegistration` is correctly typed
- [ ] Plugins can register Processors at any pipeline stage
- [ ] Plugins can register Tools into the ToolRegistry
- [ ] Plugin loader discovers plugins from file paths, npm packages, and directories
- [ ] Plugin initialization errors are caught and reported without crashing the framework
- [ ] Test plugin loads successfully and its registered Processor/Tool work in a full pipeline run

## Blocked by

- Issue 06 (Full Pipeline Stages)

## User stories covered

17, 18, 19
