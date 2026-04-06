import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import {
  LLMAdapter,
  Message,
  Tool,
  StreamEvent,
  LLMResponse,
  ToolCall,
  ToolResult,
} from '../types.js';
import { Observable, from, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface AIAdapterConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
  useTools?: boolean;
}

export class AIAdapter implements LLMAdapter {
  private modelId: string;
  private apiKey: string = '';
  private baseURL: string = '';
  private tools: Record<string, Tool> = {};
  private useTools: boolean = true;

  constructor(config: AIAdapterConfig) {
    this.modelId = config.model;
    this.apiKey = config.apiKey || '';
    this.baseURL = config.baseURL || '';
    this.useTools = config.useTools ?? true;
  }

  setTools(tools: Tool[]): void {
    this.tools = tools.reduce((acc, t) => ({ ...acc, [t.name]: t }), {} as Record<string, Tool>);
  }

  getTool(name: string): Tool | undefined {
    return this.tools[name];
  }

  private createModel() {
    const provider = createOpenAICompatible({
      name: 'custom',
      baseURL: this.baseURL,
      apiKey: this.apiKey,
    });
    return provider(this.modelId);
  }

  private getTools() {
    const result: Record<string, unknown> = {};
    for (const [name, t] of Object.entries(this.tools)) {
      const properties: Record<string, z.ZodType> = {};
      if (t.parameters?.properties) {
        for (const [key, prop] of Object.entries(t.parameters.properties)) {
          const propTyped = prop as { type?: string };
          if (propTyped.type === 'string') {
            properties[key] = z.string();
          } else if (propTyped.type === 'number') {
            properties[key] = z.number();
          } else if (propTyped.type === 'boolean') {
            properties[key] = z.boolean();
          } else {
            properties[key] = z.unknown();
          }
        }
      }

      const schema = z.object(properties);

      result[name] = {
        description: t.description,
        inputSchema: schema,
        execute: async (args: Record<string, unknown>) => {
          return await t.execute(args);
        },
      };
    }
    return result;
  }

  private toModelMessages(
    messages: Message[]
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  private extractToolCalls(events: StreamEvent[]): { calls: ToolCall[]; results: ToolResult[] } {
    const calls: ToolCall[] = [];
    const results: ToolResult[] = [];
    let currentCall: { id: string; name: string; arguments: string } | null = null;

    for (const event of events) {
      if (event.type === 'tool_call_start') {
        currentCall = { id: event.id, name: event.name, arguments: '' };
      } else if (event.type === 'tool_call_delta' && currentCall) {
        currentCall.arguments += event.arguments;
      } else if (event.type === 'tool_call_end' && currentCall) {
        try {
          const parsed = JSON.parse(currentCall.arguments);
          calls.push({ name: currentCall.name, arguments: parsed });
          results.push({ toolCallId: currentCall.id, toolName: currentCall.name, result: '' });
        } catch {
          // ignore parse errors
        }
      }
    }
    return { calls, results };
  }

  async chat(messages: Message[]): Promise<LLMResponse> {
    return new Promise((resolve, reject) => {
      const events: StreamEvent[] = [];
      this.chatStream(messages).subscribe({
        next: (event) => {
          events.push(event);
          if (event.type === 'done') {
            resolve(event.response);
          }
        },
        error: reject,
      });
    });
  }

  chatStream(messages: Message[]): Observable<StreamEvent> {
    return new Observable((observer) => {
      const model = this.createModel();
      const tools = this.useTools ? this.getTools() : {};

      const result = streamText({
        model,
        messages: this.toModelMessages(messages),
        tools:
          this.useTools && Object.keys(tools).length > 0
            ? (tools as unknown as Parameters<typeof streamText>[0]['tools'])
            : undefined,
        maxRetries: 0,
      });

      (async () => {
        try {
          for await (const event of result.fullStream) {
            if (observer.closed) break;

            if (event.type === 'text-delta') {
              observer.next({ type: 'text', content: event.text });
            } else if (event.type === 'tool-call') {
              observer.next({
                type: 'tool_call_start',
                id: event.toolCallId,
                name: event.toolName,
              });
              observer.next({
                type: 'tool_call_delta',
                id: event.toolCallId,
                arguments: JSON.stringify(event.input),
              });
            } else if (event.type === 'tool-result') {
              const output =
                typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
              observer.next({ type: 'tool_call_end', id: event.toolCallId, result: output });
            } else if (event.type === 'finish') {
              observer.next({
                type: 'done',
                response: {
                  content: null,
                  finishReason: event.finishReason as LLMResponse['finishReason'],
                  toolCalls: [],
                },
              });
            }
          }
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      })();

      return () => {
        // 清理资源
      };
    });
  }
}
