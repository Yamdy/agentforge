# MCP Agent

An agent connected to MCP (Model Context Protocol) servers using AgentForge.

## Features

- MCP client for connecting to external tool servers
- Dynamic tool discovery from MCP servers
- Tool calling with MCP-provided schemas
- Configurable server connections

## Setup

1. Copy `.env.example` to `.env` and add your API key:

```bash
cp .env.example .env
# Edit .env with your OPENAI_API_KEY
```

2. Install dependencies:

```bash
npm install
```

3. Configure MCP servers in `src/mcp/client.ts`

4. Run the agent:

```bash
npm run dev
```

## MCP Configuration

Edit `src/mcp/client.ts` to configure your MCP servers:

```typescript
const servers = [
  {
    name: 'my-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/dir'],
  },
];
```

## Supported Transports

- **stdio**: Launch a local MCP server process
- **sse**: Connect to a remote MCP server via Server-Sent Events

## Customization

- Add more MCP servers in the client configuration
- Modify the system prompt to guide tool usage
- Add local tools alongside MCP tools