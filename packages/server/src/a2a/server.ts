import type { Agent } from '@agentforge/core';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  A2AMessage,
} from './types.js';
import { A2A_ERROR_CODES, isTerminal } from './types.js';
import { InMemoryTaskStore } from './task-store.js';

export interface A2ARequestHandlerOptions {
  agent: Agent;
  taskStore?: InMemoryTaskStore;
}

export class A2ARequestHandler {
  private agent: Agent;
  private taskStore: InMemoryTaskStore;

  constructor(options: A2ARequestHandlerOptions) {
    this.agent = options.agent;
    this.taskStore = options.taskStore ?? new InMemoryTaskStore();
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
        default:
          return this.error(request.id, A2A_ERROR_CODES.UNSUPPORTED_OPERATION, 'Unsupported operation');
      }
    } catch (err) {
      return this.error(request.id, A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, (err as Error).message);
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
    return this.result(request.id, { task: canceled });
  }

  private result(id: string | number | undefined, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id: id ?? null, result };
  }

  private error(id: string | number | undefined, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  }
}
