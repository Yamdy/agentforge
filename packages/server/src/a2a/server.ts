import type { Agent } from '@agentforge/core';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  A2AMessage,
  A2AStreamEvent,
} from './types.js';
import { A2A_ERROR_CODES, isTerminal } from './types.js';
import { InMemoryTaskStore } from './task-store.js';
import { streamSendMessage, type StreamSendMessageParams } from './streaming.js';
import { InMemoryNotificationRegistry, type NotificationRegistry } from './push-notification.js';
import { validatePushNotificationUrl } from './url-validator.js';

export interface A2ARequestHandlerOptions {
  agent: Agent;
  taskStore?: InMemoryTaskStore;
  notificationRegistry?: NotificationRegistry;
  fetchFn?: typeof globalThis.fetch;
}

export class A2ARequestHandler {
  private agent: Agent;
  private taskStore: InMemoryTaskStore;
  private notificationRegistry: NotificationRegistry;
  private fetchFn: typeof globalThis.fetch;

  constructor(options: A2ARequestHandlerOptions) {
    this.agent = options.agent;
    this.taskStore = options.taskStore ?? new InMemoryTaskStore();
    this.notificationRegistry = options.notificationRegistry ?? new InMemoryNotificationRegistry();
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      switch (request.method) {
        case 'SendMessage':
          return await this.handleSendMessage(request);
        case 'GetTask':
          return await this.handleGetTask(request);
        case 'CancelTask':
          return await this.handleCancelTask(request);
        case 'RegisterPushNotification':
          return await this.handleRegisterPushNotification(request);
        default:
          return this.error(request.id, A2A_ERROR_CODES.UNSUPPORTED_OPERATION, 'Unsupported operation');
      }
    } catch (err) {
      return this.error(request.id, A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, (err as Error).message);
    }
  }

  async *streamSendMessage(params: StreamSendMessageParams): AsyncGenerator<A2AStreamEvent> {
    yield* streamSendMessage(this.agent, this.taskStore, params);
  }

  async notify(taskId: string): Promise<void> {
    const url = this.notificationRegistry.get(taskId);
    if (!url) return;

    const task = await this.taskStore.get(taskId);
    if (!task) return;

    try {
      await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, status: task.status }),
      });
    } catch {
      // Webhook delivery failure is non-fatal
    }
  }

  private async handleSendMessage(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { message: A2AMessage };
    const message = params.message;

    const inputText = message.parts
      .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
      .map((p) => p.text)
      .join('\n');

    const contextId = message.contextId ?? 'ctx-default';
    const task = await this.taskStore.create(contextId);

    await this.taskStore.updateStatus(task.id, 'working');

    try {
      const result = await this.agent.run(inputText);
      await this.taskStore.addArtifact(task.id, {
        artifactId: `artifact-${task.id}`,
        parts: [{ kind: 'text', text: result.response }],
      });
      await this.taskStore.updateStatus(task.id, 'completed');
    } catch {
      await this.taskStore.updateStatus(task.id, 'failed');
    }

    await this.notify(task.id);

    const finalTask = await this.taskStore.get(task.id);
    return this.result(request.id, { task: finalTask });
  }

  private async handleGetTask(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { id: string };
    const task = await this.taskStore.get(params.id);
    if (!task) {
      return this.error(request.id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found');
    }
    return this.result(request.id, { task });
  }

  private async handleCancelTask(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { id: string };
    const task = await this.taskStore.get(params.id);
    if (!task) {
      return this.error(request.id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found');
    }
    if (isTerminal(task.status.state)) {
      return this.error(request.id, A2A_ERROR_CODES.TASK_NOT_CANCELABLE, 'Task is in terminal state and cannot be canceled');
    }
    const canceled = await this.taskStore.cancel(params.id);
    await this.notify(params.id);
    return this.result(request.id, { task: canceled });
  }

  private async handleRegisterPushNotification(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { taskId: string; pushNotificationUrl: string };
    const task = await this.taskStore.get(params.taskId);
    if (!task) {
      return this.error(request.id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found');
    }
    const validation = validatePushNotificationUrl(params.pushNotificationUrl);
    if (!validation.valid) {
      return this.error(request.id, A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, `Invalid push notification URL: ${validation.reason}`);
    }
    this.notificationRegistry.register(params.taskId, params.pushNotificationUrl);
    return this.result(request.id, { registered: true });
  }

  private result(id: string | number | undefined, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id: id ?? null, result };
  }

  private error(id: string | number | undefined, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  }
}
