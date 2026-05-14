import type { A2AAgentCard, JsonRpcResponse } from './types.js';

export interface A2AClientOptions {
  card: A2AAgentCard;
  fetch?: typeof globalThis.fetch;
}

let rpcId = 0;

export class A2AClient {
  private card: A2AAgentCard;
  private fetchFn: typeof globalThis.fetch;

  constructor(options: A2AClientOptions) {
    this.card = options.card;
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async sendMessage(text: string, options?: { contextId?: string }): Promise<{ task: unknown }> {
    return this.rpc('SendMessage', {
      message: {
        kind: 'message',
        messageId: `msg-${++rpcId}`,
        role: 'user',
        parts: [{ kind: 'text', text }],
        ...(options?.contextId && { contextId: options.contextId }),
      },
    });
  }

  async sendAndExtract(text: string, options?: { contextId?: string }): Promise<string> {
    const response = await this.rpc('SendMessage', {
      message: {
        kind: 'message',
        messageId: `msg-${++rpcId}`,
        role: 'user',
        parts: [{ kind: 'text', text }],
        ...(options?.contextId && { contextId: options.contextId }),
      },
    });
    const task = (response as { task: { artifacts?: Array<{ parts: Array<{ kind: string; text?: string }> }> } }).task;
    const firstText = task.artifacts?.[0]?.parts?.find((p) => p.kind === 'text');
    return firstText?.text ?? '';
  }

  async getTask(taskId: string): Promise<{ task: unknown }> {
    return this.rpc('GetTask', { id: taskId });
  }

  async cancelTask(taskId: string): Promise<{ task: unknown }> {
    return this.rpc('CancelTask', { id: taskId });
  }

  private async rpc(method: string, params: unknown): Promise<{ task: unknown }> {
    const id = ++rpcId;
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });

    const res = await this.fetchFn(this.card.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as JsonRpcResponse;

    if (json.error) {
      throw new Error(`A2A error ${json.error.code}: ${json.error.message}`);
    }

    return json.result as { task: unknown };
  }

  get agentCard(): A2AAgentCard {
    return this.card;
  }
}
