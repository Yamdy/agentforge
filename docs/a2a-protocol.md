# A2A Protocol

AgentForge implements the Agent-to-Agent (A2A) protocol for inter-agent communication. A2A uses JSON-RPC 2.0 over HTTP with optional streaming via Server-Sent Events (SSE).

## Overview

The A2A protocol enables agents to communicate as peers:

- **Task-based**: Communication is structured around tasks with defined lifecycles
- **Streaming**: Long-running tasks can stream status updates and artifacts
- **Push Notifications**: Agents can register webhooks for task updates
- **Agent Cards**: Agents describe their capabilities via structured metadata

## Task Lifecycle

```
submitted --> working --> completed
                 |-----> failed
                 |-----> canceled
                 |-----> input-required --> working
                 |-----> auth-required --> working
                 |
submitted --> rejected
```

| State | Description | Terminal |
|-------|-------------|----------|
| `submitted` | Task received, not yet started | No |
| `working` | Agent is processing the task | No |
| `completed` | Task finished successfully | Yes |
| `failed` | Task failed with an error | Yes |
| `canceled` | Task was canceled by the caller | Yes |
| `input-required` | Agent needs additional input | No |
| `auth-required` | Agent needs authentication | No |
| `rejected` | Task was rejected by the agent | Yes |

## JSON-RPC Methods

### SendMessage

Send a message to an agent. Creates a new task or continues an existing one.

```json
{
  "jsonrpc": "2.0",
  "method": "SendMessage",
  "params": {
    "message": {
      "kind": "message",
      "messageId": "msg-1",
      "role": "user",
      "parts": [{ "kind": "text", "text": "Summarize this topic" }]
    }
  },
  "id": 1
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "task-abc",
      "contextId": "ctx-1",
      "status": { "state": "completed", "timestamp": "..." },
      "artifacts": [{ "artifactId": "a1", "parts": [{ "kind": "text", "text": "..." }] }]
    }
  }
}
```

### GetTask

Retrieve the current state of a task.

```json
{
  "jsonrpc": "2.0",
  "method": "GetTask",
  "params": { "id": "task-abc" },
  "id": 2
}
```

### CancelTask

Cancel a running task.

```json
{
  "jsonrpc": "2.0",
  "method": "CancelTask",
  "params": { "id": "task-abc" },
  "id": 3
}
```

### RegisterPushNotification

Register a webhook URL for task status updates.

```json
{
  "jsonrpc": "2.0",
  "method": "RegisterPushNotification",
  "params": { "taskId": "task-abc", "url": "https://example.com/webhook" },
  "id": 4
}
```

## Streaming

Tasks can stream events via SSE. The server emits `status-update` and `artifact-update` events:

```typescript
// Server side: stream events for a task
const stream = handler.streamSendMessage({
  message: { kind: 'message', messageId: 'msg-1', role: 'user', parts: [...] },
  taskId: 'task-abc',
});

for await (const event of stream) {
  // event.kind === 'status-update' | 'artifact-update'
}
```

```typescript
// Client side: consume streaming events
const client = new A2AClient({ card: remoteAgentCard });
for await (const event of client.streamTask('task-abc')) {
  if (event.kind === 'artifact-update') {
    process.stdout.write(event.artifact.parts[0].text);
  }
}
```

## Error Codes

| Code | Meaning |
|------|---------|
| `-32001` | Task not found |
| `-32002` | Task not cancelable |
| `-32004` | Unsupported operation |
| `-32005` | Content type not supported |
| `-32006` | Invalid agent response |

## Message Parts

Messages support three part types:

| Type | Fields | Description |
|------|--------|-------------|
| `text` | `kind: 'text', text: string` | Plain text content |
| `data` | `kind: 'data', data: Record<string, unknown>` | Structured JSON data |
| `file` | `kind: 'file', url?: string, bytes?: string, mimeType?: string` | File attachments (URL or base64) |

## Agent Card

Agents describe themselves via an `A2AAgentCard`:

```typescript
const card: A2AAgentCard = {
  name: 'my-agent',
  description: 'A research assistant agent',
  version: '1.0.0',
  url: 'https://api.example.com/a2a',
  skills: [
    {
      id: 'summarize',
      name: 'Summarize',
      description: 'Summarize text on any topic',
      tags: ['nlp', 'research'],
    },
  ],
  capabilities: {
    streaming: true,
    pushNotifications: true,
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
};
```

## Server Setup

```typescript
import { AgentForgeServer, A2ARequestHandler, a2aRoutes, InMemoryTaskStore } from '@agentforge/server';

const server = new AgentForgeServer({ port: 3000 });
const agent = /* your Agent instance */;
const taskStore = new InMemoryTaskStore();
const handler = new A2ARequestHandler({ agent, taskStore });

// Mount A2A routes
server.hono.route('/a2a', a2aRoutes({ handler, taskStore }));

await server.start();
```

## Client Usage

```typescript
import { A2AClient } from '@agentforge/server';

const client = new A2AClient({
  card: { name: 'remote', url: 'http://localhost:3000/a2a', /* ... */ },
});

// Send a message
const result = await client.sendMessage('Hello');

// Extract text from response
const text = await client.sendAndExtract('Summarize this topic');

// Get task status
const task = await client.getTask('task-abc');

// Cancel a task
await client.cancelTask('task-abc');
```
