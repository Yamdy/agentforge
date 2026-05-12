Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the MCP plugin using ResourceDeclaration for server lifecycle and ToolRegistry for tool registration.

**MCP server config:**
```typescript
interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
```

**Implementation approach:**
- MCP servers declared as `ResourceDeclaration` — `start()` spawns the process, `stop()` kills it
- Plugin manages lifecycle via `HarnessAPI.registerResource()`
- On resource start, discover tools via MCP protocol
- Convert MCP tool definitions to framework Tool interface
- Register via `HarnessAPI.registerTool()`
- Listen for MCP tool list change notifications for dynamic discovery

**Skill coordination:** Skill Plugin can reference MCP servers by name. MCP Plugin checks if a skill-requested server is already running, shares the connection if so, starts new one if not.

**Transport support:** `stdio` (child process), `sse` (Server-Sent Events), `http` (Streamable HTTP).

## Acceptance criteria

- [x] MCP plugin starts servers via registerResource lifecycle
- [x] MCP tool definitions converted to framework Tool interface
- [x] Discovered tools registered and callable by agent
- [x] MCP server stops cleanly on plugin shutdown
- [x] Dynamic tool discovery detects server-side changes
- [x] Graceful handling of server disconnections
- [x] Test: connect to test MCP server, discover tools, agent uses them

## Blocked by

- Issue 07 (Plugin System — registerResource)
- Issue 05 (Tool System)

## User stories covered

46, 47, 48
