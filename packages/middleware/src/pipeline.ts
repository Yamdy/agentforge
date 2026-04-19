import { Effect, pipe } from "effect";
import {
  Middleware,
  MiddlewareContext,
  MiddlewareNext,
  MiddlewarePipeline,
  MiddlewareEventType,
  AgentMiddleware,
  MiddlewareEvents,
  ModelRequest,
  ModelResponse,
} from "./types";

// 类型保护：判断是否是 AgentMiddleware 实例
function isAgentMiddleware(mw: unknown): mw is AgentMiddleware {
  return typeof mw === "object" && mw !== null && "wrapModelCall" in mw;
}

// 将 AgentMiddleware 适配为标准 Middleware 函数
function adaptAgentMiddleware(agentMiddleware: AgentMiddleware): Middleware {
  return (next: MiddlewareNext) => {
    return (context: MiddlewareContext) => {
      // 拦截 LLM 请求，适配 wrapModelCall
      if (
        context.event === MiddlewareEvents.LLM_REQUEST_BEFORE &&
        context.data.messages
      ) {
        const modelRequest: ModelRequest = {
          messages: context.data.messages as any,
          options: context.data.options as any,
        };

        // 构造 next 调用链
        const wrappedNext = (req: ModelRequest) =>
          pipe(
            next({
              ...context,
              data: { ...context.data, messages: req.messages, options: req.options },
            }),
            Effect.map((ctx) => {
              // 将上下文转换为 ModelResponse
              const response = ctx.data.response as string;
              return { response, metadata: ctx.metadata };
            })
          );

        return pipe(
          agentMiddleware.wrapModelCall(modelRequest, wrappedNext),
          Effect.map((response) => {
            // 转换回标准上下文
            return {
              ...context,
              data: { ...context.data, response: response.response },
              metadata: { ...context.metadata, ...response.metadata },
            };
          })
        );
      }

      // 其他事件直接通过
      return next(context);
    };
  };
}

export function createMiddlewarePipeline(
  ...middlewares: Array<Middleware | AgentMiddleware>
): MiddlewarePipeline {
  // 统一转换为标准 Middleware 函数
  const stack: Middleware[] = middlewares.map((mw) =>
    isAgentMiddleware(mw) ? adaptAgentMiddleware(mw) : mw
  );

  const use = (
    middleware: Middleware | AgentMiddleware
  ): MiddlewarePipeline => {
    const adaptedMw = isAgentMiddleware(middleware)
      ? adaptAgentMiddleware(middleware)
      : middleware;
    return createMiddlewarePipeline(...stack, adaptedMw);
  };

  const execute = (
    event: MiddlewareEventType,
    data: Record<string, unknown>
  ): Effect.Effect<MiddlewareContext, unknown, never> => {
    const initialContext: MiddlewareContext = {
      event,
      data,
      metadata: {},
    };

    const createHandler = (index: number): MiddlewareNext => {
      if (index >= stack.length) {
        return (ctx: MiddlewareContext) => Effect.succeed(ctx);
      }

      return (ctx: MiddlewareContext) => stack[index](createHandler(index + 1))(ctx);
    };

    return createHandler(0)(initialContext);
  };

  return { use, execute };
}

export function createLoggingMiddleware(): Middleware {
  return (next: MiddlewareNext) => {
    return (context: MiddlewareContext) => {
      console.log(`[Middleware] Before: ${context.event}`, context.data);
      return Effect.flatMap(next(context), (result) => {
        console.log(`[Middleware] After: ${context.event}`);
        return Effect.succeed(result);
      });
    };
  };
}

export function createTimingMiddleware(): Middleware {
  return (next: MiddlewareNext) => {
    return (context: MiddlewareContext) => {
      const start = Date.now();
      return Effect.flatMap(next(context), (result) => {
        const duration = Date.now() - start;
        console.log(`[Middleware] ${context.event} took ${duration}ms`);
        return Effect.succeed(result);
      });
    };
  };
}