import { Effect, pipe } from "effect";
import {
  Message,
  SessionManager,
  Session,
  SessionError,
  Tool,
  ToolCall,
} from "@agentforge/core";
import {
  type LLMProvider,
  type LLMStreamProvider,
  LLMError,
  type StreamEvent,
} from "@agentforge/llm";
import {
  type MiddlewareEventType,
  type MiddlewarePipeline,
  type AgentMiddleware,
  MiddlewareEvents,
  createMiddlewarePipeline,
} from "@agentforge/middleware";
import {
  AgentState,
  type AgentStatus,
  type ProcessorContext,
  type StepStats,
} from "./state";

export type StreamChunkCallback = (chunk: string) => void | Promise<void>;

export interface AgentStats {
  rounds: number;
  llmCalls: number;
  toolCalls: number;
  totalTokens: number;
}

export interface ChatAgentConfig {
  sessionManager: SessionManager;
  llmProvider: LLMProvider & Partial<LLMStreamProvider>;
  systemPrompt?: string;
  middleware?: MiddlewarePipeline | Array<AgentMiddleware>;
  tools?: Array<Tool>;
  maxToolCallRounds?: number;
  /** Enable state management */
  enableState?: boolean;
}

export class ChatAgent {
  private session: Session;
  private readonly sessionManager: SessionManager;
  private readonly llmProvider: LLMProvider & Partial<LLMStreamProvider>;
  private readonly middleware?: MiddlewarePipeline;
  private readonly tools: Map<string, Tool>;
  private readonly maxToolCallRounds: number;
  private readonly agentState: AgentState;

  constructor(config: ChatAgentConfig) {
    this.sessionManager = config.sessionManager;
    this.llmProvider = config.llmProvider;

    // Initialize agent state
    this.agentState = new AgentState();
    
    // 处理 middleware 配置
    if (config.middleware) {
      if (Array.isArray(config.middleware)) {
        // 传入的是 AgentMiddleware 数组，自动创建 Pipeline
        this.middleware = createMiddlewarePipeline(...config.middleware);
      } else {
        // 直接使用传入的 Pipeline
        this.middleware = config.middleware;
      }
    }

    // 初始化工具
    this.tools = new Map();
    if (config.tools) {
      config.tools.forEach(tool => {
        this.tools.set(tool.name, tool);
      });
    }

    // 初始化最大工具调用轮次，默认5次防止无限循环
    this.maxToolCallRounds = config.maxToolCallRounds ?? 5;

    this.session = Effect.runSync(
      this.sessionManager.create({
        systemPrompt: config.systemPrompt,
      })
    );

    // Set up status change listener to trigger middleware
    this.agentState.onStatusChange((from, to) => {
      this.triggerMiddleware(MiddlewareEvents.AGENT_STATUS_CHANGE, {
        from,
        to,
        sessionId: this.session.id,
      });
    });

    // 触发启动事件
    this.triggerMiddleware(MiddlewareEvents.AGENT_START, { sessionId: this.session.id });
  }

  private triggerMiddleware(
    event: MiddlewareEventType,
    data: Record<string, unknown>
  ): void {
    if (this.middleware) {
      try {
        // 异步执行，不阻塞主流程
        Effect.runPromise(this.middleware.execute(event, data));
      } catch {
        // ignore middleware errors
      }
    }
  }

  sendMessage(
    userInput: string
  ): Effect.Effect<string, LLMError | SessionError, never> {
    this.triggerMiddleware(MiddlewareEvents.AGENT_MESSAGE_RECEIVE, { message: userInput });

    return pipe(
      // 1. 添加用户消息到会话
      this.sessionManager.addMessage(this.session.id, {
        role: "user",
        content: userInput,
      }),
      Effect.map((session) => {
        this.session = session;
        return session;
      }),
      // 2. 循环处理，支持多轮工具调用
      Effect.flatMap(() => this.processAgentLoop()),
      // 3. 返回最终结果
      Effect.tap((finalResponse) => {
        this.triggerMiddleware(MiddlewareEvents.AGENT_MESSAGE_SEND, { content: finalResponse });
        return Effect.void;
      })
    );
  }

  /**
   * 处理 Agent 执行循环，包括工具调用
   */
  private processAgentLoop(): Effect.Effect<string, LLMError | SessionError, never> {
    const processRound = (round: number): Effect.Effect<string, LLMError | SessionError, never> => {
      // Check stop signal
      if (this.agentState.getContext().shouldStop) {
        return Effect.fail(new LLMError("Agent stopped by user"));
      }

      // 超过最大轮次，返回错误
      if (round > this.maxToolCallRounds) {
        return Effect.fail(new LLMError(`Exceeded maximum tool call rounds (${this.maxToolCallRounds})`));
      }

      // Update state
      this.agentState.incrementRound();
      this.agentState.incrementLlmCalls();

      // 构造要发送的消息
      const messagesToSend: Message[] = [];
      if (this.session.systemPrompt) {
        messagesToSend.push({
          role: "system",
          content: this.session.systemPrompt,
        });
      }
      messagesToSend.push(...this.session.messages);

      this.triggerMiddleware(MiddlewareEvents.LLM_REQUEST_BEFORE, {
        messages: messagesToSend,
        round,
        stats: this.agentState.getStats(),
      });

      return pipe(
        // 调用 LLM
        this.llmProvider.generate({
          messages: messagesToSend,
          tools: this.tools.size > 0 ? Array.from(this.tools.values()) : undefined,
        }),
        Effect.flatMap((result) => {
          this.triggerMiddleware(MiddlewareEvents.LLM_REQUEST_AFTER, {
            messages: messagesToSend,
            response: result.text,
            toolCalls: result.toolCalls,
            stats: this.agentState.getStats(),
          });

          // 没有工具调用，直接返回结果
          if (!result.toolCalls || result.toolCalls.length === 0) {
            return pipe(
              // 添加助手回复到会话
              this.sessionManager.addMessage(this.session.id, {
                role: "assistant",
                content: result.text,
              }),
              Effect.map((session) => {
                this.session = session;
                return result.text;
              })
            );
          }

          // Record tool calls in state
          for (const tc of result.toolCalls) {
            this.agentState.addToolCall(tc.id, tc.name, tc.parameters);
          }
          this.agentState.incrementToolCalls(result.toolCalls.length);

          // 有工具调用，执行工具
          return pipe(
            this.executeToolCalls(result.toolCalls!),
            Effect.flatMap(() => {
              // 工具执行完成，触发事件
              this.triggerMiddleware(MiddlewareEvents.TOOL_ALL_COMPLETE, {
                toolCount: result.toolCalls!.length,
                stats: this.agentState.getStats(),
              });

              // 触发步骤完成事件
              this.triggerMiddleware(MiddlewareEvents.AGENT_STEP_COMPLETE, {
                round,
                stats: this.agentState.getStats(),
              });

              // Check if we should continue
              if (this.agentState.getContext().shouldBreak) {
                return Effect.succeed("");
              }

              // 继续下一轮循环
              return processRound(round + 1);
            })
          );
        })
      );
    };

    return processRound(1);
  }

  /**
   * 执行工具调用列表
   */
  private executeToolCalls(toolCalls: Array<ToolCall>): Effect.Effect<void, LLMError | SessionError, never> {
    // 并行执行所有工具调用
    return pipe(
      Effect.all(
        toolCalls.map((toolCall) => this.executeSingleToolCall(toolCall))
      ),
      Effect.map(() => void 0),
      Effect.mapError((error: unknown) => {
        if (error instanceof LLMError || error instanceof SessionError) {
          return error;
        }
        return new LLMError(`Tool execution failed: ${String(error)}`, error);
      })
    );
  }

  /**
   * 执行单个工具调用
   */
  private executeSingleToolCall(toolCall: ToolCall): Effect.Effect<void, LLMError | SessionError, never> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      const errorMsg = `Tool "${toolCall.name}" not found`;
      this.triggerMiddleware(MiddlewareEvents.TOOL_CALL_ERROR, {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: errorMsg,
      });

      // 添加错误结果到会话
      return pipe(
        this.sessionManager.addMessage(this.session.id, {
          role: "tool",
          content: `Error: ${errorMsg}`,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        }),
        Effect.map((session) => {
          this.session = session;
          return void 0;
        })
      );
    }

    // 处理参数为undefined的情况
    const parameters = toolCall.parameters ?? {};

    // 触发工具开始事件
    this.triggerMiddleware(MiddlewareEvents.TOOL_CALL_START, {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      parameters,
    });

    return pipe(
      // 执行工具
      tool.execute(parameters),
      // 处理执行结果
      Effect.flatMap((resultContent) => {
        // 触发工具结束事件
        this.triggerMiddleware(MiddlewareEvents.TOOL_CALL_END, {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: resultContent,
        });

        // 添加工具结果到会话
        return this.sessionManager.addMessage(this.session.id, {
          role: "tool",
          content: resultContent,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        });
      }),
      // 处理执行错误
      Effect.mapError((error: unknown) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.triggerMiddleware(MiddlewareEvents.TOOL_CALL_ERROR, {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          error: errorMsg,
        });

        // 添加错误结果到会话
        Effect.runPromise(this.sessionManager.addMessage(this.session.id, {
          role: "tool",
          content: `工具执行错误: ${errorMsg}`,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        }));

        // 转换成LLMError，让上层逻辑处理
        return new LLMError(`工具 ${toolCall.name} 执行失败: ${errorMsg}`, error);
      }),
      // 更新会话
      Effect.map((session: Session) => {
        this.session = session;
        return void 0;
      })
    );
  }

  sendMessageStream(
    userInput: string,
    onChunk?: StreamChunkCallback
  ): Effect.Effect<string, LLMError | SessionError, never> {
    this.triggerMiddleware(MiddlewareEvents.AGENT_MESSAGE_RECEIVE, { message: userInput });

    const streamProvider = this.llmProvider as unknown as LLMStreamProvider;
    if (!streamProvider.generateStream) {
      return Effect.fail(
        new LLMError(
          "Provider does not support streaming. Use sendMessage instead.",
          undefined
        )
      );
    }

    // 流式工具调用循环处理
    const processStreamRound = (round: number): Effect.Effect<string, LLMError | SessionError, never> => {
      // 超过最大轮次，返回错误
      if (round > this.maxToolCallRounds) {
        return Effect.fail(new LLMError(`超过最大工具调用轮次 (${this.maxToolCallRounds})`));
      }

      // 构造要发送的消息
      const messagesToSend: Message[] = [];
      if (this.session.systemPrompt) {
        messagesToSend.push({
          role: "system",
          content: this.session.systemPrompt,
        });
      }
      messagesToSend.push(...this.session.messages);

      this.triggerMiddleware(MiddlewareEvents.LLM_STREAM_START, {
        messages: messagesToSend,
        round,
      });

      return Effect.tryPromise({
        try: async () => {
          let fullResponse = "";
          let currentToolCalls: Array<{ id: string; name: string; parameters: Record<string, any> }> | undefined;

          const streamEffects = await Effect.runPromise(
            streamProvider.generateStream({
              messages: messagesToSend,
              tools: this.tools.size > 0 ? Array.from(this.tools.values()) : undefined,
            })
          );

          for await (const event of streamEffects) {
            switch (event.type) {
              case "text-delta":
                fullResponse += event.content;
                if (onChunk) {
                  onChunk(event.content);
                }
                this.triggerMiddleware(MiddlewareEvents.LLM_STREAM_CHUNK, {
                  chunk: event.content,
                });
                break;
              case "tool-call-start":
                this.triggerMiddleware(MiddlewareEvents.TOOL_CALL_START, {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                });
                break;
              case "done":
                this.triggerMiddleware(MiddlewareEvents.LLM_STREAM_END, {
                  response: event.text,
                  toolCalls: event.toolCalls,
                });
                currentToolCalls = event.toolCalls;
                break;
            }
          }

          return { fullResponse, toolCalls: currentToolCalls };
        },
        catch: (e) => new LLMError(`流式请求失败: ${e}`, e),
      }).pipe(
        Effect.mapError((e) => {
          return new LLMError(`流式处理失败: ${e instanceof Error ? e.message : String(e)}`, e);
        }),
        Effect.flatMap(({ fullResponse, toolCalls }) => {
          // 没有工具调用，直接返回结果
          if (!toolCalls || toolCalls.length === 0) {
            return pipe(
              this.sessionManager.addMessage(this.session.id, {
                role: "assistant",
                content: fullResponse,
              }),
              Effect.map((finalSession) => {
                this.session = finalSession;
                this.triggerMiddleware(MiddlewareEvents.AGENT_MESSAGE_SEND, { content: fullResponse });
                return fullResponse;
              })
            );
          }

          // 有工具调用，先添加助手回复到会话
          return pipe(
            this.sessionManager.addMessage(this.session.id, {
              role: "assistant",
              content: fullResponse,
            }),
            Effect.map((session) => {
              this.session = session;
              return toolCalls;
            }),
            // 执行所有工具调用
            Effect.flatMap((calls) => this.executeToolCalls(calls)),
            // 工具执行完成，触发事件
            Effect.tap(() => {
              this.triggerMiddleware(MiddlewareEvents.TOOL_ALL_COMPLETE, {
                toolCount: toolCalls.length,
              });
              return Effect.succeed(undefined);
            }),
            // 递归执行下一轮
            Effect.flatMap(() => processStreamRound(round + 1))
          );
        })
      );
    };

    return pipe(
      // 首先添加用户消息到会话
      this.sessionManager.addMessage(this.session.id, {
        role: "user",
        content: userInput,
      }),
      Effect.map((session) => {
        this.session = session;
        return session;
      }),
      // 开始处理循环
      Effect.flatMap(() => processStreamRound(1))
    );
  }

  getSession(): Effect.Effect<Session, never> {
    return Effect.succeed(this.session);
  }

  getStatus(): AgentStatus {
    return this.agentState.getStatus();
  }

  getStats(): AgentStats {
    const stats = this.agentState.getStats();
    return {
      rounds: stats.round,
      llmCalls: stats.llmCalls,
      toolCalls: stats.toolCalls,
      totalTokens: stats.totalTokens,
    };
  }

  stop(): void {
    this.agentState.stop();
  }

  takeSnapshot(): string {
    return this.agentState.takeSnapshot();
  }

  restore(data: string): void {
    this.agentState.restore(data);
  }

  reset(): void {
    this.agentState.reset();
  }
}