import type { Effect } from "effect";
import type { Message } from "@agentforge/core";

export const MiddlewareEvents = {
  LLM_REQUEST_BEFORE: "llm.request.before",
  LLM_REQUEST_AFTER: "llm.request.after",
  LLM_STREAM_START: "llm.stream.start",
  LLM_STREAM_CHUNK: "llm.stream.chunk",
  LLM_STREAM_END: "llm.stream.end",
  AGENT_MESSAGE_RECEIVE: "agent.message.receive",
  AGENT_MESSAGE_SEND: "agent.message.send",
  AGENT_START: "agent.start",
  AGENT_STATUS_CHANGE: "agent.status.change",
  AGENT_STEP: "agent.step",
  AGENT_STEP_COMPLETE: "agent.step.complete",
  AGENT_COMPLETE: "agent.complete",
  AGENT_ERROR: "agent.error",
  // 工具调用相关事件
  TOOL_CALL_START: "tool.call.start",
  TOOL_CALL_END: "tool.call.end",
  TOOL_CALL_ERROR: "tool.call.error",
  TOOL_ALL_COMPLETE: "tool.all.complete",
} as const;

export type MiddlewareEventType =
  (typeof MiddlewareEvents)[keyof typeof MiddlewareEvents];

export interface MiddlewareContext {
  readonly event: MiddlewareEventType;
  readonly data: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
}

export type MiddlewareNext = (
  context: MiddlewareContext
) => Effect.Effect<MiddlewareContext, unknown, never>;

export type Middleware = (
  next: MiddlewareNext
) => (context: MiddlewareContext) => Effect.Effect<MiddlewareContext, unknown, never>;

export interface MiddlewarePipeline {
  use: (middleware: Middleware) => MiddlewarePipeline;
  execute: (
    event: MiddlewareEventType,
    data: Record<string, unknown>
  ) => Effect.Effect<MiddlewareContext, unknown, never>;
}

// 类型安全的 Model 调用请求/响应
export interface ModelRequest {
  messages: Message[];
  options?: Record<string, unknown>;
}

export interface ModelResponse {
  response: string;
  metadata?: Record<string, unknown>;
}

// 深度兼容 deepagents 的 AgentMiddleware 抽象类
export abstract class AgentMiddleware<State = Record<string, unknown>> {
  protected state: State;

  constructor(initialState: State = {} as State) {
    this.state = initialState;
  }

  /**
   * 拦截 LLM 请求调用，可以修改请求参数和响应结果
   */
  abstract wrapModelCall(
    request: ModelRequest,
    next: (request: ModelRequest) => Effect.Effect<ModelResponse, unknown, never>
  ): Effect.Effect<ModelResponse, unknown, never>;

  /**
   * 获取当前状态
   */
  getState(): Readonly<State> {
    return this.state;
  }

  /**
   * 更新状态
   */
  protected setState(newState: Partial<State>): void {
    this.state = { ...this.state, ...newState };
  }
}