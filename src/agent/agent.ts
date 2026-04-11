import {
  LLMAdapter,
  HistoryManager,
  StreamEvent,
  AgentConfig,
  TaskState,
  createTaskStateMachine,
  PendingToolCall,
  Message,
} from '../types';
import { ToolRegistry } from '../registry';
import { PluginManager } from '../plugin/index.js';
import { createLogger } from '../logger/index.js';
import { getTracer } from '../tracer.js';
import { Observable, Subject } from 'rxjs';
import { Middleware } from '../middleware/index.js';
import { createMiddlewarePipeline } from '../middleware/index.js';
import type { MemoryManager } from '../memory/manager.js';

interface AgentOptions extends AgentConfig {
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  logger?: ReturnType<typeof createLogger>;
  middleware?: Middleware[];
  memoryManager?: MemoryManager;
}

export interface StreamHandler {
  onText?: (text: string) => void;
  onToolCallStart?: (id: string, name: string) => void;
  onToolCallDelta?: (id: string, args: string) => void;
  onToolCallEnd?: (id: string, result?: string) => void;
  onStep?: (step: number, maxSteps: number) => void;
  onStateChange?: (state: TaskState) => void;
  onError?: (error: Error) => void;
}

export interface RunOptions extends StreamHandler {
  sessionMessages?: Message[];
}

export class Agent {
  private adapter: LLMAdapter;
  private history: HistoryManager;
  private registry: ToolRegistry;
  private maxSteps: number;
  private stateMachine: ReturnType<typeof createTaskStateMachine>;
  private pluginManager: PluginManager;
  private log: ReturnType<typeof createLogger>;
  private tracer: ReturnType<typeof getTracer>;
  private memoryManager?: MemoryManager;
  private responseSubject: Subject<Message> = new Subject();

  private middleware: Middleware[] = [];
  private pipeline: Middleware;

  constructor(
    adapter: LLMAdapter,
    history: HistoryManager,
    registry?: ToolRegistry,
    options?: AgentOptions
  ) {
    this.adapter = adapter;
    this.history = history;
    this.registry = registry!;
    this.maxSteps = options?.maxSteps ?? Infinity;
    this.stateMachine = createTaskStateMachine(this.maxSteps);
    this.pluginManager = options?.pluginManager ?? new PluginManager();
    this.log = options?.logger ?? createLogger('agent');
    this.tracer = getTracer();
    this.middleware = options?.middleware ?? [];
    this.pipeline = createMiddlewarePipeline(...this.middleware);
    this.memoryManager = options?.memoryManager;
  }

  getMemoryManager(): MemoryManager | undefined {
    return this.memoryManager;
  }

  observe(message: Message): void {
    this.history.add(message.role as 'user' | 'assistant' | 'tool', message.content);
    this.log.info('Agent observed message', { role: message.role });
  }

  onResponse(): Observable<Message> {
    return this.responseSubject.asObservable();
  }

  getState(): TaskState {
    return this.stateMachine.getState();
  }

  cancel(): void {
    this.stateMachine.cancel();
    this.log.warn('Agent cancelled by user');
  }

  pause(): void {
    this.stateMachine.pause();
    this.log.warn('Agent paused by user');
  }

  resume(): void {
    this.stateMachine.resume();
    this.log.info('Agent resumed');
  }

  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  registerPlugin(plugin: Parameters<PluginManager['register']>[0]): void {
    this.pluginManager.register(plugin);
    this.log.info('Plugin registered', { name: plugin.name });
  }

  private async persistMemory(): Promise<void> {
    if (this.memoryManager) {
      try {
        await this.memoryManager.save();
        this.log.info('Memory persisted after agent run');
      } catch (err) {
        this.log.error('Failed to persist memory', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async run(userInput: string, options?: RunOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      let result = '';
      this.runStream(userInput, options).subscribe({
        next: (event) => {
          if (event.type === 'text') {
            result += event.content;
          } else if (event.type === 'tool_call_end' && event.result) {
            result += event.result;
          } else if (event.type === 'done' && event.response.content) {
            result = event.response.content;
          }
        },
        complete: () => {
          this.persistMemory()
            .then(() => resolve(result))
            .catch(() => resolve(result));
        },
        error: (err) => {
          this.persistMemory()
            .finally(() => reject(err));
        },
      });
    });
  }

  runStream(userInput: string, options?: RunOptions): Observable<StreamEvent> {
    const source$ = new Observable((observer) => {
      const handler = options;
      const sessionMessages = options?.sessionMessages ?? [];
      this.log.info('Agent run started', {
        userInput: userInput.slice(0, 100),
        sessionMessageCount: sessionMessages.length,
      });

      const span = this.tracer.startSpan('agent.run');
      this.tracer.log(span.spanId, 'Agent run started', { userInput });

      if (this.memoryManager && !this.memoryManager.isLoaded()) {
        this.memoryManager.load().catch((err) => {
          this.log.error('Failed to load memory', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      this.history.clear();

      for (const msg of sessionMessages) {
        if (msg.role !== 'system') {
          this.history.add(msg.role, msg.content);
        }
      }
      this.history.add('user', userInput);

      this.pluginManager.trigger('chat.message', { role: 'user', content: userInput }, { content: userInput }).catch(() => {});

      const initialState = this.stateMachine.getState();
      this.pluginManager.trigger('agent.start', { userInput }, {}).catch(observer.error);
      this.stateMachine.onStateChange(async (state) => {
        handler?.onStateChange?.(state);
        await this.pluginManager.trigger(
          'state.change',
          { from: initialState.status, to: state.status },
          {}
        );
      });
      this.stateMachine.transition('running');

      let step = 0;
      let hasToolCalls = false;
      let textContent = '';
      let doneSent = false;
      const pendingToolCalls: Map<string, PendingToolCall> = new Map();

      const executeStep = async () => {
        if (step >= this.maxSteps) {
          if (doneSent) return;
          doneSent = true;

          if (textContent.trim()) {
            this.history.add('assistant', textContent);
            this.responseSubject.next({ role: 'assistant', content: textContent });
          }

          this.stateMachine.transition('completed');
          this.tracer.endSpan(span.spanId, 'completed');
          this.log.info('Agent run completed', { textLength: textContent.length });
          observer.next({
            type: 'done',
            response: {
              content: textContent,
              finishReason: 'length',
              toolCalls: [],
            },
          });
          observer.complete();
          this.pluginManager
            .trigger('agent.complete', { userInput, response: textContent }, {})
            .catch(observer.error);
          return;
        }

        step++;
        this.stateMachine.transition('running', { step });
        this.tracer.log(span.spanId, `Step ${step} started`);
        handler?.onStep?.(step, this.maxSteps);
        this.pluginManager
          .trigger('agent.step', { step, maxSteps: this.maxSteps }, {})
          .catch(observer.error);

        const messages = this.history.getMessages();
        hasToolCalls = false;

        const chatParamsOutput: { temperature?: number; maxTokens?: number; topP?: number } = {};
        this.pluginManager.trigger('chat.params', { model: 'unknown', sessionId: undefined }, chatParamsOutput).catch(() => {});

        this.adapter.chatStream(messages).subscribe({
          next: async (event) => {
            switch (event.type) {
              case 'text':
                textContent += event.content;
                handler?.onText?.(event.content);
                observer.next(event);
                break;

              case 'tool_call_start':
                hasToolCalls = true;
                pendingToolCalls.set(event.id, { id: event.id, name: event.name, arguments: '' });
                this.tracer.log(span.spanId, `Tool call started: ${event.name}`);
                handler?.onToolCallStart?.(event.id, event.name);
                observer.next(event);
                break;

              case 'tool_call_delta':
                const pending = pendingToolCalls.get(event.id);
                if (pending) {
                  pending.arguments += event.arguments;
                }
                handler?.onToolCallDelta?.(event.id, event.arguments);
                observer.next(event);
                break;

              case 'tool_call_end':
                const toolCall = pendingToolCalls.get(event.id);
                const toolResult = event.result ?? '';

                if (toolCall && this.registry.get(toolCall.name)) {
                  const toolSpan = this.tracer.startSpan(`tool.${toolCall.name}`, span.spanId);
                  this.tracer.setTag(toolSpan.spanId, 'tool.name', toolCall.name);
                  try {
                    const args = JSON.parse(toolCall.arguments || '{}');

                    await this.pluginManager.trigger(
                      'tool.execute.before',
                      { tool: toolCall.name, args },
                      { args }
                    );

                    this.log.info('Executing tool', { tool: toolCall.name, args });
                    const execResult = await this.registry.execute(toolCall.name, args);
                    this.log.info('Tool executed', {
                      tool: toolCall.name,
                      result: execResult.slice(0, 50),
                    });

                    await this.pluginManager.trigger(
                      'tool.execute.after',
                      { tool: toolCall.name, args, result: execResult },
                      { result: execResult }
                    );

                    this.tracer.endSpan(toolSpan.spanId, 'completed');

                    this.history.addToolResult(toolCall.id, toolCall.name, execResult);
                    handler?.onToolCallEnd?.(toolCall.id, execResult);
                    observer.next({
                      type: 'tool_call_end',
                      id: event.id,
                      result: execResult,
                    });
                  } catch (err) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    this.tracer.endSpan(
                      toolSpan.spanId,
                      'failed',
                      err instanceof Error ? err : new Error(errorMsg)
                    );
                    this.log.error('Tool execution failed', {
                      tool: toolCall.name,
                      error: errorMsg,
                    });
                    this.history.addToolResult(toolCall.id, toolCall.name, `Error: ${errorMsg}`);
                    handler?.onToolCallEnd?.(toolCall.id, `Error: ${errorMsg}`);
                    observer.next({
                      type: 'tool_call_end',
                      id: event.id,
                      result: `Error: ${errorMsg}`,
                    });
                  }
                } else if (toolResult) {
                  const toolName = toolCall?.name || event.id;
                  this.history.addToolResult(event.id, toolName, toolResult);
                  handler?.onToolCallEnd?.(event.id, toolResult);
                  observer.next(event);
                }

                pendingToolCalls.delete(event.id);
                break;

              case 'done':
                if (doneSent) break;
                doneSent = true;

                if (textContent.trim()) {
                  this.history.add('assistant', textContent);
                }

                const finishReason = event.response.finishReason;

                this.pluginManager.trigger('chat.response', {
                  finishReason: finishReason ?? 'stop',
                  duration: 0,
                  responseText: textContent,
                }, {}).catch(() => {});

                observer.next(event);

                if (finishReason === 'tool-calls') {
                  doneSent = false;
                  executeStep().catch(observer.error);
                } else {
                  if (textContent.trim()) {
                    this.responseSubject.next({ role: 'assistant', content: textContent });
                  }
                  this.stateMachine.transition('completed');
                  this.tracer.endSpan(span.spanId, 'completed');
                  this.log.info('Agent run completed', { textLength: textContent.length });
                  this.pluginManager
                    .trigger('agent.complete', { userInput, response: textContent }, {})
                    .catch(observer.error);
                  observer.complete();
                }
                break;
            }
          },
          complete: () => {
            if (!hasToolCalls && !doneSent) {
              doneSent = true;

              if (textContent.trim()) {
                this.history.add('assistant', textContent);
                this.responseSubject.next({ role: 'assistant', content: textContent });
              }

              this.stateMachine.transition('completed');
              this.tracer.endSpan(span.spanId, 'completed');
              this.log.info('Agent run completed', { textLength: textContent.length });
              observer.next({
                type: 'done',
                response: {
                  content: textContent,
                  finishReason: 'stop',
                  toolCalls: [],
                },
              });
              this.pluginManager
                .trigger('agent.complete', { userInput, response: textContent }, {})
                .catch(observer.error);
              observer.complete();
            }
          },
          error: async (err) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            await this.pluginManager.trigger('agent.error', { error: errorMsg }, {});
            await this.pluginManager.trigger('chat.error', {
              error: err instanceof Error ? err : new Error(errorMsg),
              duration: 0,
            }, {});
            this.tracer.endSpan(
              span.spanId,
              'failed',
              err instanceof Error ? err : new Error(errorMsg)
            );
            this.stateMachine.transition('error', { error: errorMsg });
            this.log.error('Agent run failed', { error: errorMsg });
            handler?.onError?.(err instanceof Error ? err : new Error(errorMsg));
            observer.error(err);
          },
        });
      };

      executeStep().catch(observer.error);

      // Return teardown logic
      return () => {
        // Cleanup if unsubscribed early
        if (this.stateMachine.getState().status === 'running') {
          this.stateMachine.cancel();
          this.tracer.endSpan(span.spanId, 'cancelled');
          this.pluginManager
            .trigger('agent.complete', { userInput, response: textContent }, {})
            .catch(() => {});
        }
      };
    });

    return this.pipeline(source$ as Observable<StreamEvent>);
  }
}
