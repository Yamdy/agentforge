import * as https from 'node:https';
import { streamText, type ModelMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import {
  LLMAdapter,
  Message,
  Tool,
  StreamEvent,
  LLMResponse,
  RequestInterceptor,
  RequestContext,
  TimeoutConfig,
} from '../types.js';
import { Observable } from 'rxjs';

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface AIAdapterConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
  useTools?: boolean;
  interceptors?: RequestInterceptor[];
  timeout?: TimeoutConfig;
  tlsRejectUnauthorized?: boolean;
  fetch?: FetchFn;
}

export class AIAdapter implements LLMAdapter {
  private modelId: string;
  private apiKey: string;
  private baseURL: string;
  private tools: Record<string, Tool> = {};
  private useTools: boolean;
  private interceptors: RequestInterceptor[];
  private timeout: TimeoutConfig;
  private tlsRejectUnauthorized: boolean;
  private customFetch: FetchFn | undefined;

  constructor(config: AIAdapterConfig) {
    this.modelId = config.model;
    this.apiKey = config.apiKey || '';
    this.baseURL = config.baseURL || '';
    this.useTools = config.useTools ?? true;
    this.interceptors = config.interceptors ?? [];
    this.timeout = config.timeout ?? {};
    this.tlsRejectUnauthorized = config.tlsRejectUnauthorized ?? true;
    this.customFetch = config.fetch;
  }

  setTools(tools: Tool[]): void {
    this.tools = tools.reduce((acc, t) => ({ ...acc, [t.name]: t }), {} as Record<string, Tool>);
  }

  getTool(name: string): Tool | undefined {
    return this.tools[name];
  }

  setInterceptors(interceptors: RequestInterceptor[]): void {
    this.interceptors = interceptors;
  }

  private createCustomFetch(): FetchFn {
    const interceptors = this.interceptors;
    const rejectUnauthorized = this.tlsRejectUnauthorized;
    const customFetch = this.customFetch;

    return async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);

      let body: Record<string, unknown> | undefined;
      if (init?.body && typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = undefined;
        }
      }

      if (interceptors.length > 0 && body) {
        const ctx: RequestContext = {
          url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
          method: init?.method || 'POST',
          headers: Object.fromEntries(headers.entries()),
          body,
        };

        let result = ctx;
        for (const interceptor of interceptors) {
          if (interceptor.beforeRequest) {
            result = await interceptor.beforeRequest(result);
          }
        }

        for (const [key, value] of Object.entries(result.headers)) {
          headers.set(key, value);
        }
        body = result.body;
      }

      const newInit: RequestInit = {
        ...init,
        headers,
        body: body ? JSON.stringify(body) : init?.body,
      };

      if (!rejectUnauthorized) {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.startsWith('https://')) {
          const agent = new https.Agent({ rejectUnauthorized: false });
          const parsedUrl = new URL(urlStr);
          const nodeRequestOptions: https.RequestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: (newInit.method || 'POST') as string,
            headers: Object.fromEntries(headers.entries()),
            agent,
          };

          return new Promise<Response>((resolve, reject) => {
            const req = https.request(nodeRequestOptions, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                const responseBody = Buffer.concat(chunks);
                const responseHeaders = new Headers();
                for (const [key, value] of Object.entries(res.headers)) {
                  if (value) {
                    responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
                  }
                }
                resolve(new Response(responseBody, {
                  status: res.statusCode,
                  statusText: res.statusMessage,
                  headers: responseHeaders,
                }));
              });
            });
            req.on('error', reject);
            if (newInit.body) {
              req.write(newInit.body);
            }
            req.end();
          });
        }
      }

      const fetchImpl = customFetch ?? fetch;
      return fetchImpl(input, newInit);
    };
  }

  private createModel() {
    const needsCustomFetch = this.interceptors.length > 0
      || !this.tlsRejectUnauthorized
      || this.customFetch !== undefined;

    const provider = createOpenAICompatible({
      name: 'custom',
      baseURL: this.baseURL,
      apiKey: this.apiKey,
      ...(needsCustomFetch ? { fetch: this.createCustomFetch() } : {}),
    });
    return provider(this.modelId);
  }

  private getTools() {
    const result: Record<string, unknown> = {};
    for (const [name, t] of Object.entries(this.tools)) {
      const properties: Record<string, z.ZodType> = {};
      if (t.parameters?.properties) {
        for (const [key, prop] of Object.entries(t.parameters.properties)) {
          const propSchema = prop as { type?: string; enum?: unknown[] };
          if (propSchema.type === 'string') {
            let schema: z.ZodType = z.string();
            if (propSchema.enum) {
              schema = z.enum(propSchema.enum as [string, ...string[]]);
            }
            properties[key] = schema;
          } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
            properties[key] = z.number();
          } else if (propSchema.type === 'boolean') {
            properties[key] = z.boolean();
          } else if (propSchema.type === 'array') {
            properties[key] = z.array(z.unknown());
          } else if (propSchema.type === 'object') {
            properties[key] = z.record(z.unknown());
          } else {
            properties[key] = z.unknown();
          }
        }
      }

      const schema = z.object(properties);

      result[name] = {
        description: t.description,
        parameters: schema,
      };
    }
    return result;
  }

  private toModelMessages(messages: Message[]): Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  }> {
    const result: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      tool_call_id?: string;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }> = [];
    const pendingToolCalls: Array<{ id: string; name: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.toolCallId && msg.toolName) {
          pendingToolCalls.push({ id: msg.toolCallId, name: msg.toolName });
        } else {
          if (pendingToolCalls.length > 0) {
            result.push({
              role: 'assistant',
              content: msg.content,
              tool_calls: pendingToolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: '{}' },
              })),
            });
            pendingToolCalls.length = 0;
          } else {
            result.push({ role: 'assistant', content: msg.content });
          }
        }
      } else if (msg.role === 'tool') {
        if (pendingToolCalls.length > 0) {
          result.push({
            role: 'assistant',
            content: '',
            tool_calls: pendingToolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: '{}' },
            })),
          });
          pendingToolCalls.length = 0;
        }
        result.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId ?? '',
        });
      } else if (msg.role === 'system') {
        result.push({ role: 'system', content: msg.content });
      }
    }

    if (pendingToolCalls.length > 0) {
      result.push({
        role: 'assistant',
        content: '',
        tool_calls: pendingToolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: '{}' },
        })),
      });
    }

    return result;
  }

  async chat(messages: Message[]): Promise<LLMResponse> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      this.chatStream(messages).subscribe({
        next: (event) => {
          if (event.type === 'done' && !resolved) {
            resolved = true;
            resolve(event.response);
          }
        },
        error: reject,
        complete: () => {
          if (!resolved) {
            resolved = true;
            resolve({
              content: null,
              finishReason: 'stop',
              toolCalls: [],
            });
          }
        },
      });
    });
  }

  chatStream(messages: Message[]): Observable<StreamEvent> {
    return new Observable((observer) => {
      const model = this.createModel();
      const tools = this.useTools ? this.getTools() : {};
      const hasTimeout = this.timeout.firstToken || this.timeout.chunk || this.timeout.total;
      const modelMessages = this.toModelMessages(messages);

      const streamConfig = {
        model,
        messages: modelMessages as unknown as ModelMessage[],
        tools:
          this.useTools && Object.keys(tools).length > 0
            ? (tools as unknown as Parameters<typeof streamText>[0]['tools'])
            : undefined,
        maxRetries: 0,
      };

      const mapEvent = (event: { type: string; [key: string]: unknown }): StreamEvent | null => {
        if (event.type === 'text-delta') {
          return { type: 'text', content: event.text as string };
        } else if (event.type === 'tool-call') {
          return null;
        } else if (event.type === 'finish') {
          return {
            type: 'done',
            response: {
              content: null,
              finishReason: event.finishReason as LLMResponse['finishReason'],
              toolCalls: [],
            },
          };
        }
        return null;
      };

      if (hasTimeout) {
        const overallAbort = new AbortController();
        let firstTokenTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let chunkTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let firstTokenReceived = false;

        const clearFirstTokenTimeout = () => {
          if (firstTokenTimeoutId) {
            clearTimeout(firstTokenTimeoutId);
            firstTokenTimeoutId = null;
          }
        };

        const resetChunkTimeout = () => {
          if (chunkTimeoutId) {
            clearTimeout(chunkTimeoutId);
          }
          if (this.timeout.chunk) {
            chunkTimeoutId = setTimeout(() => {
              chunkAbort.abort(`Timeout: no data received over ${this.timeout.chunk}ms`);
              overallAbort.abort();
            }, this.timeout.chunk);
          }
        };

        const chunkAbort = new AbortController();

        if (this.timeout.firstToken) {
          firstTokenTimeoutId = setTimeout(() => {
            overallAbort.abort(`Timeout: no response received after ${this.timeout.firstToken}ms`);
          }, this.timeout.firstToken);
        }

        if (this.timeout.total) {
          setTimeout(() => {
            overallAbort.abort(`Total timeout exceeded: ${this.timeout.total}ms`);
          }, this.timeout.total);
        }

        const result = streamText({
          ...streamConfig,
          abortSignal: overallAbort.signal,
        });

        (async () => {
          try {
            for await (const event of result.fullStream) {
              if (observer.closed) break;

              if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearFirstTokenTimeout();
              }
              resetChunkTimeout();

              if (event.type === 'tool-call') {
                observer.next({
                  type: 'tool_call_start',
                  id: event.toolCallId as string,
                  name: event.toolName as string,
                });
                observer.next({
                  type: 'tool_call_delta',
                  id: event.toolCallId as string,
                  arguments: JSON.stringify(event.input),
                });
              } else {
                const mapped = mapEvent(event);
                if (mapped) observer.next(mapped);
              }
            }
            clearFirstTokenTimeout();
            if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
            observer.complete();
          } catch (error) {
            clearFirstTokenTimeout();
            if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
            observer.error(error);
          }
        })();

        return () => {
          clearFirstTokenTimeout();
          if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
          overallAbort.abort();
        };
      }

      const result = streamText(streamConfig);

      (async () => {
        try {
          for await (const event of result.fullStream) {
            if (observer.closed) break;

            if (event.type === 'tool-call') {
              observer.next({
                type: 'tool_call_start',
                id: event.toolCallId as string,
                name: event.toolName as string,
              });
              observer.next({
                type: 'tool_call_delta',
                id: event.toolCallId as string,
                arguments: JSON.stringify(event.input),
              });
            } else {
              const mapped = mapEvent(event);
              if (mapped) observer.next(mapped);
            }
          }
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      })();

      return () => {};
    });
  }
}
