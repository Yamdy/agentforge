Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement the MCP (Model Context Protocol) plugin that connects to MCP servers and dynamically discovers and registers their tools into the framework's ToolRegistry.

**MCP Plugin implementation:**
- Plugin that accepts MCP server configurations (transport type, connection params)
- Connects to MCP servers at plugin initialization
- Discovers available tools via MCP protocol
- Converts MCP tool definitions to the framework's Tool interface (Zod schema mapping)
- Registers converted tools into the ToolRegistry via HarnessAPI

**Transport support:**
- `stdio` — spawn a child process, communicate via stdin/stdout
- `sse` — connect via Server-Sent Events (HTTP GET for events, POST for requests)
- `http` — connect via HTTP (Streamable HTTP transport)

**Dynamic tool discovery:** Listen for MCP tool list change notifications. When new tools are added to an MCP server at runtime, automatically register them in the ToolRegistry. When tools are removed, unregister them.

**Error handling:** MCP server disconnections are logged but don't crash the agent. Reconnection with exponential backoff.

## Acceptance criteria

- [ ] MCP plugin connects to MCP servers via stdio transport
- [ ] MCP plugin connects to MCP servers via SSE transport
- [ ] MCP tool definitions are converted to framework Tool interface with Zod schemas
- [ ] Discovered tools are registered in ToolRegistry and callable by the agent
- [ ] Tool list changes are detected dynamically (new tools appear without restart)
- [ ] MCP server disconnections are handled gracefully with reconnection
- [ ] Test: connect to a test MCP server, discover tools, agent uses them

## Blocked by

- Issue 07 (Plugin System)
- Issue 05 (Tool System)

## User stories covered

46, 47, 48
