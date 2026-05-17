import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { Agent } from '@primo-ai/core';
import type {
  A2AMessage,
  A2AStreamEvent,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from './types.js';
import { InMemoryTaskStore } from './task-store.js';

// ---------------------------------------------------------------------------
// streamSendMessage — async generator yielding A2AStreamEvents
// ---------------------------------------------------------------------------

export interface StreamSendMessageParams {
  message: A2AMessage;
}

export async function* streamSendMessage(
  agent: Agent,
  taskStore: InMemoryTaskStore,
  params: StreamSendMessageParams,
): AsyncGenerator<A2AStreamEvent> {
  const message = params.message;

  const inputText = message.parts
    .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
    .map((p) => p.text)
    .join('\n');

  const contextId = message.contextId ?? 'ctx-default';
  const task = await taskStore.create(contextId);

  // Emit: status-update → working
  const workingStatus = await taskStore.updateStatus(task.id, 'working');
  yield {
    kind: 'status-update',
    taskId: task.id,
    contextId,
    status: workingStatus.status,
  } satisfies TaskStatusUpdateEvent;

  try {
    const result = await agent.run(inputText);

    // Emit: artifact-update with response
    const artifact = {
      artifactId: `artifact-${task.id}`,
      parts: [{ kind: 'text' as const, text: result.response }],
    };
    await taskStore.addArtifact(task.id, artifact);
    yield {
      kind: 'artifact-update',
      taskId: task.id,
      contextId,
      artifact,
      lastChunk: true,
    } satisfies TaskArtifactUpdateEvent;

    // Emit: status-update → completed
    const completedStatus = await taskStore.updateStatus(task.id, 'completed');
    yield {
      kind: 'status-update',
      taskId: task.id,
      contextId,
      status: completedStatus.status,
    } satisfies TaskStatusUpdateEvent;
  } catch {
    // Emit: status-update → failed
    const failedStatus = await taskStore.updateStatus(task.id, 'failed');
    yield {
      kind: 'status-update',
      taskId: task.id,
      contextId,
      status: failedStatus.status,
    } satisfies TaskStatusUpdateEvent;
  }
}

// ---------------------------------------------------------------------------
// a2aStreamRoute — Hono sub-app providing GET /tasks/:id/stream
// ---------------------------------------------------------------------------

export interface A2AStreamRouteOptions {
  agent: Agent;
  taskStore: InMemoryTaskStore;
}

export function a2aStreamRoute(options: A2AStreamRouteOptions): Hono {
  const app = new Hono();
  const { taskStore } = options;

  app.get('/tasks/:id/stream', async (c) => {
    const taskId = c.req.param('id');
    const task = await taskStore.get(taskId);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');

    return stream(c, async (s) => {
      const statusEvent: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: task.id,
        contextId: task.contextId,
        status: task.status,
      };
      s.write(`data: ${JSON.stringify(statusEvent)}\n\n`);

      if (task.artifacts) {
        for (const artifact of task.artifacts) {
          const artifactEvent: TaskArtifactUpdateEvent = {
            kind: 'artifact-update',
            taskId: task.id,
            contextId: task.contextId,
            artifact,
            lastChunk: true,
          };
          s.write(`data: ${JSON.stringify(artifactEvent)}\n\n`);
        }
      }
    });
  });

  return app;
}

/** Convenience: create SSE route from a task store alone (query completed tasks). */
export function a2aStreamingRoute(taskStore: InMemoryTaskStore): Hono {
  return a2aStreamRoute({ agent: null as unknown as Agent, taskStore });
}
