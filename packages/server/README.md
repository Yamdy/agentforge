# @primo-ai/server

HTTP server, WebSocket bridge, A2A protocol, and CLI for AgentForge.

## Overview

Provides a production-ready server for exposing AgentForge agents via HTTP, WebSocket, and the Agent-to-Agent (A2A) protocol. Includes a CLI for running agents and managing the server.

## Quick Start

### Programmatic

```typescript
import { AgentForgeServer } from '@primo-ai/server';
import { Agent } from '@primo-ai/core';

const server = new AgentForgeServer({
  port: 3000,
  apiKey: 'my-secret-key',       // optional Bearer token auth
  enableWebSocket: true,
  cors: { origin: '*' },
});

// Register an agent
server.registry.register('assistant', {
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant.',
});

const handle = await server.start();
console.log(`Server running on port ${handle.port}`);
```

### CLI

```bash
# Start server with config file
npx agentforge serve --port 3000 --config .agentforge/config.jsonc

# Run a single agent invocation
npx agentforge run --agent assistant --input "Hello"

# Dev mode with file watching
npx agentforge dev --port 3000
```

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe (checks registered agents) |
| `POST` | `/agents/:id/run` | Run an agent synchronously |
| `GET` | `/agents/:id/stream` | Stream agent output via SSE |
| `GET` | `/sessions` | List sessions |
| `GET` | `/sessions/:id` | Get session details |

## WebSocket Bridge

Enable WebSocket support for real-time bidirectional communication:

```typescript
const server = new AgentForgeServer({
  enableWebSocket: true,
});

// The bridge handles agent run requests over WebSocket
server.bridge.handleUpgrade(wsConnection);
```

## A2A Protocol

Implements the Agent-to-Agent protocol for multi-agent communication:

```typescript
import { A2AClient, A2ARequestHandler, buildAgentCard } from '@primo-ai/server';

// Server side: create an A2A handler for an agent
const handler = new A2ARequestHandler({ agent: myAgent });

// Client side: connect to a remote agent
const client = new A2AClient({
  card: {
    name: 'remote-agent',
    url: 'http://localhost:3001/a2a',
    // ...agent card fields
  },
});

const result = await client.sendMessage('Hello');
```

### A2A Methods

| Method | Description |
|--------|-------------|
| `SendMessage` | Send a message and create/update a task |
| `GetTask` | Retrieve task status and artifacts |
| `CancelTask` | Cancel a running task |
| `RegisterPushNotification` | Register a webhook for task updates |

## Configuration

The server loads agents from a JSONC config file:

```jsonc
{
  "agents": {
    "assistant": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "You are a helpful assistant.",
      "maxIterations": 5,
      "profile": "coding"  // optional built-in profile
    }
  },
  "modelGateways": [
    { "name": "custom", "url": "https://api.example.com/v1" }
  ]
}
```

## Built-in Profiles

| Profile | Description |
|---------|-------------|
| `coding` | Code generation and review agent |
| `business` | Business analysis and reporting agent |
| `data` | Data analysis and visualization agent |
| `personal` | General-purpose personal assistant |

## Docker

```bash
docker compose up
```

The container exposes port 3000 with health checks. Mount config at `/app/.agentforge/`.

## Key Exports

| Export | Description |
|--------|-------------|
| `AgentForgeServer` | HTTP/WebSocket server |
| `AgentRegistry` | Agent registration and lookup |
| `StaticKeyAuthAdapter` | Bearer token authentication |
| `A2ARequestHandler` | Server-side A2A protocol handler |
| `A2AClient` | Client-side A2A protocol client |
| `buildAgentCard` | Build an A2A agent card |
| `ProfileLoader` | Agent profile management |
| `AgentForgeClient` | Client SDK for connecting to AgentForge servers |
