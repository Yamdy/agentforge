# Kitchen-Sink Integration: Config + MCP + Async Sub-Agents

Extend `examples/kitchen-sink.ts` with Region 5 that exercises Issues 15/16/17 with real LLM calls.

## Region 5: Config + MCP + Async Sub-Agents

### 1. Config (Issue 16)

- Write a temp `.agentforge/config.jsonc` file with JSONC comments containing `modelProfiles` (systemPromptSuffix for deepseek) and `tools` config
- `ConfigLoader.load()` merges from global → project → session layers
- `matchProfile` + `applyProfile` applied to demonstrate per-model prompt customization
- `resolveDynamic` used for dynamic system prompt fragment based on runtime context

### 2. MCP (Issue 15)

- Use `@modelcontextprotocol/server-filesystem` as real MCP server over stdio transport
- `mcpPlugin` configured to start the server, pointing at a temp directory with pre-written files
- Server auto-discovers `read_file`, `list_directory`, `write_file`, etc.
- Agent receives a query that requires reading files via MCP tools, calls them through real LLM

### 3. Async Sub-Agents (Issue 17)

- `ConcurrencyController` with 1 slot (max 2 concurrent tasks)
- `TaskManagerImpl` launches 3 async translation tasks (same prompt, different target languages)
- Each task config specifies `model: 'deepseek/deepseek-v4-flash'` (no fallback to bare `'default'`)
- `on_complete` callbacks collect results, printed after all tasks finish
- Demonstrate `list()` filtering and `cancel()` on one task

### Prerequisites

- `@modelcontextprotocol/server-filesystem` added as devDependency to root `package.json`
- `DEEPSEEK_API_KEY` environment variable set (existing kitchen-sink already requires this)

### Verification

Run `npx tsx examples/kitchen-sink.ts` and confirm:
- Config layer merge output and ModelProfile application
- MCP server starts, tools discovered, LLM calls MCP tool successfully
- Async tasks run with concurrency control, results collected via on_complete
