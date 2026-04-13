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
import { setCurrentMemory } from '../context.js';
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
  private _sysPrompt: string;
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
    this.registry = registry ?? new ToolRegistry();
    this._sysPrompt = options?.systemPrompt ?? '';
    this.maxSteps = options?.maxSteps ?? Infinity;
    this.stateMachine = createTaskStateMachine(this.maxSteps);
    this.pluginManager = options?.pluginManager ?? new PluginManager();
    this.log = options?.logger ?? createLogger('agent');
    this.tracer = getTracer();
    this.middleware = options?.middleware ?? [];
    this.pipeline = createMiddlewarePipeline(...this.middleware);
    this.memoryManager = options?.memoryManager;
  }

  get systemPrompt(): string {
    return this._sysPrompt;
  }

  set systemPrompt(value: string) {
    this._sysPrompt = value;
  }

  getMemoryManager(): MemoryManager | undefined {
    return this.memoryManager;
  }

  observe(message: Message): void {
    const validRoles: ReadonlyArray<'user' | 'assistant' | 'tool'> = ['user', 'assistant', 'tool'];
    const role = validRoles.includes(message.role as 'user' | 'assistant' | 'tool')
      ? (message.role as 'user' | 'assistant' | 'tool')
      : 'user';
    this.history.add(role, message.content);
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
      let lastStepText = '';
      this.runStream(userInput, options).subscribe({
        next: (event) => {
          if (event.type === 'text') {
            lastStepText += event.content;
          } else if (event.type === 'done') {
            if (event.response.content) {
              lastStepText = event.response.content;
            }
          } else if (event.type === 'tool_call_start') {
            lastStepText = '';
          }
        },
        complete: () => {
          this.persistMemory()
            .then(() => resolve(lastStepText))
            .catch(() => resolve(lastStepText));
        },
        error: (err) => {
          this.persistMemory().finally(() => reject(err));
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

      let unsubscribeState: (() => void) | null = null;

      const initAndRun = async () => {
        if (this.memoryManager && !this.memoryManager.isLoaded()) {
          await this.memoryManager.load();
        }

        if (this.memoryManager) {
          // Add system prompt first
          if (this._sysPrompt) {
            this.history.add('system', this._sysPrompt);
          }
          for (const msg of sessionMessages) {
            if (msg.role !== 'system') {
              this.history.add(msg.role, msg.content);
            }
          }
        } else {
          this.history.clear();
          // Add system prompt first
          if (this._sysPrompt) {
            this.history.add('system', this._sysPrompt);
          }
          for (const msg of sessionMessages) {
            if (msg.role !== 'system') {
              this.history.add(msg.role, msg.content);
            }
          }
        }

        this.history.add('user', userInput);

        setCurrentMemory({
          messages: this.history.getMessages(),
          sessionId: this.memoryManager?.threadIdField,
        });

        this.pluginManager
          .trigger('chat.message', { role: 'user', content: userInput }, { content: userInput })
          .catch(() => {});

        let previousStatus = this.stateMachine.getState().status;
        unsubscribeState = this.stateMachine.onStateChange(async (state) => {
          handler?.onStateChange?.(state);
          await this.pluginManager.trigger(
            'state.change',
            { from: previousStatus, to: state.status },
            {}
          );
          previousStatus = state.status;
        });
        this.stateMachine.transition('running');

        let step = 0;

        const executeStep = async (): Promise<void> => {
          if (step >= this.maxSteps) {
            this.stateMachine.transition('completed');
            this.tracer.endSpan(span.spanId, 'completed');
            this.log.info('Agent run completed (max steps reached)');
            observer.next({
              type: 'done',
              response: {
                content: null,
                finishReason: 'length',
                toolCalls: [],
              },
            });
            this.pluginManager
              .trigger('agent.complete', { userInput, response: '' }, {})
              .catch(() => {});
            observer.complete();
            return;
          }

          step++;
          this.stateMachine.transition('running', { step });
          this.tracer.log(span.spanId, `Step ${step} started`);
          handler?.onStep?.(step, this.maxSteps);
          this.pluginManager
            .trigger('agent.step', { step, maxSteps: this.maxSteps }, {})
            .catch(() => {});

          const chatParamsOutput: { temperature?: number; maxTokens?: number; topP?: number } = {};
          this.pluginManager
            .trigger('chat.params', { model: 'unknown', sessionId: undefined }, chatParamsOutput)
            .catch(() => {});

          const messages = this.history.getMessages();

          const stepTextContent = await this.processLLMStream(messages, span, handler, observer);

          if (stepTextContent.trim()) {
            this.history.add('assistant', stepTextContent);
          }

          const lastHistory = this.history.getMessages();
          const lastMsg = lastHistory[lastHistory.length - 1];
          const hasToolResults = lastMsg?.role === 'tool';

          if (hasToolResults) {
            await executeStep();
          } else {
            if (stepTextContent.trim()) {
              this.responseSubject.next({ role: 'assistant', content: stepTextContent });
            }

            this.stateMachine.transition('completed');
            this.tracer.endSpan(span.spanId, 'completed');
            this.log.info('Agent run completed', { textLength: stepTextContent.length });

            observer.next({
              type: 'done',
              response: {
                content: stepTextContent,
                finishReason: 'stop',
                toolCalls: [],
              },
            });

            this.pluginManager
              .trigger('agent.complete', { userInput, response: stepTextContent }, {})
              .catch(() => {});

            this.pluginManager
              .trigger(
                'chat.response',
                {
                  finishReason: 'stop',
                  duration: 0,
                  responseText: stepTextContent,
                },
                {}
              )
              .catch(() => {});

            observer.complete();
          }
        };

        await executeStep();
      };

      initAndRun().catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.pluginManager.trigger('agent.error', { error: errorMsg }, {}).catch(() => {});
        this.tracer.endSpan(
          span.spanId,
          'failed',
          err instanceof Error ? err : new Error(errorMsg)
        );
        this.stateMachine.transition('error', { error: errorMsg });
        this.log.error('Agent run failed', { error: errorMsg });
        handler?.onError?.(err instanceof Error ? err : new Error(errorMsg));
        observer.error(err);
      });

      return () => {
        if (unsubscribeState) {
          unsubscribeState();
        }
        if (this.stateMachine.getState().status === 'running') {
          this.stateMachine.cancel();
          this.tracer.endSpan(span.spanId, 'cancelled');
          this.pluginManager
            .trigger('agent.complete', { userInput, response: '' }, {})
            .catch(() => {});
        }
      };
    });

    return this.pipeline(source$ as Observable<StreamEvent>);
  }

  private processLLMStream(
    messages: Message[],
    parentSpan: { spanId: string },
    handler: StreamHandler | undefined,
    observer: {
      next: (event: StreamEvent) => void;
      error: (err: unknown) => void;
    }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let stepTextContent = '';
      const pendingToolCalls: Map<string, PendingToolCall> = new Map();
      let pendingToolExecCount = 0;
      let completedToolExecCount = 0;
      let streamDone = false;
      let nextInProgress = 0;
      let resolved = false;

      const tryResolve = () => {
        if (resolved) return;
        if (streamDone && nextInProgress === 0 && pendingToolExecCount === completedToolExecCount) {
          resolved = true;
          resolve(stepTextContent);
        }
      };

      const executeToolCall = async (toolCall: PendingToolCall) => {
        pendingToolExecCount++;
        const toolSpan = this.tracer.startSpan(`tool.${toolCall.name}`, parentSpan.spanId);
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

          this.history.addToolResult(toolCall.id, toolCall.name, execResult, toolCall.arguments);
          handler?.onToolCallEnd?.(toolCall.id, execResult);
          observer.next({
            type: 'tool_call_end',
            id: toolCall.id,
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
          this.history.addToolResult(
            toolCall.id,
            toolCall.name,
            `Error: ${errorMsg}`,
            toolCall.arguments
          );
          handler?.onToolCallEnd?.(toolCall.id, `Error: ${errorMsg}`);
          observer.next({
            type: 'tool_call_end',
            id: toolCall.id,
            result: `Error: ${errorMsg}`,
          });
        }

        completedToolExecCount++;
        pendingToolCalls.delete(toolCall.id);
        tryResolve();
      };

      const executePendingToolCalls = () => {
        for (const [, toolCall] of pendingToolCalls) {
          if (toolCall.arguments) {
            executeToolCall(toolCall).catch(reject);
          }
        }
      };

      this.adapter.chatStream(messages).subscribe({
        next: async (event) => {
          nextInProgress++;
          try {
            switch (event.type) {
              case 'text':
                stepTextContent += event.content;
                handler?.onText?.(event.content);
                observer.next(event);
                break;

              case 'tool_call_start':
                pendingToolCalls.set(event.id, { id: event.id, name: event.name, arguments: '' });
                this.tracer.log(parentSpan.spanId, `Tool call started: ${event.name}`);
                handler?.onToolCallStart?.(event.id, event.name);
                observer.next(event);
                break;

              case 'tool_call_delta': {
                const pending = pendingToolCalls.get(event.id);
                if (pending) {
                  pending.arguments += event.arguments;
                }
                handler?.onToolCallDelta?.(event.id, event.arguments);
                observer.next(event);
                break;
              }

              case 'tool_call_end': {
                const toolCall = pendingToolCalls.get(event.id);
                if (toolCall) {
                  executeToolCall(toolCall).catch(reject);
                } else {
                  handler?.onToolCallEnd?.(event.id, event.result);
                  observer.next(event);
                }
                break;
              }

              case 'done':
                observer.next(event);
                break;
            }
          } finally {
            nextInProgress--;
            tryResolve();
          }
        },
        complete: () => {
          streamDone = true;
          if (pendingToolCalls.size > 0) {
            executePendingToolCalls();
          }
          tryResolve();
        },
        error: (err) => {
          reject(err);
        },
      });
    });
  }
}
