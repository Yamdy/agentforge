import { Effect } from "effect";
import type {
  Middleware,
  MiddlewareContext,
  MiddlewareNext,
  MiddlewareEventType,
} from "../types";

export interface LoggerMiddlewareOptions {
  /**
   * 是否启用日志，默认 true
   */
  enabled?: boolean;
  /**
   * 要监听的事件列表，默认监听所有事件
   */
  events?: MiddlewareEventType[];
  /**
   * 自定义日志格式化函数
   */
  formatter?: (context: MiddlewareContext, phase: "before" | "after") => string;
}

export function createLoggerMiddleware(
  options: LoggerMiddlewareOptions = {}
): Middleware {
  const {
    enabled = true,
    events,
    formatter,
  } = options;

  const defaultFormatter = (
    context: MiddlewareContext,
    phase: "before" | "after"
  ): string => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${phase.toUpperCase()}] ${context.event} - ${JSON.stringify(context.data)}`;
  };

  const log = (context: MiddlewareContext, phase: "before" | "after") => {
    if (!enabled) return;
    
    // 检查是否需要监听此事件
    if (events && !events.includes(context.event)) return;

    const message = formatter
      ? formatter(context, phase)
      : defaultFormatter(context, phase);
    
    console.log(message);
  };

  return (next: MiddlewareNext) => {
    return (context: MiddlewareContext) => {
      log(context, "before");
      
      return Effect.flatMap(next(context), (result) => {
        log(result, "after");
        return Effect.succeed(result);
      });
    };
  };
}
