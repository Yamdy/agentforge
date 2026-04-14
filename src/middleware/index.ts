import { Observable } from 'rxjs';
import { StreamEvent } from '../types';

// 中间件类型定义（专门针对StreamEvent）
export type Middleware = (source$: Observable<StreamEvent>) => Observable<StreamEvent>;

// 中间件管道创建函数
export function createMiddlewarePipeline(...middlewares: Middleware[]): Middleware {
  return (source$) => {
    return middlewares.reduce((current$, middleware) => middleware(current$), source$);
  };
}

// 基础中间件工厂函数 - 用于扩展现有中间件
export function createMiddleware(
  name: string,
  handler: (source$: Observable<StreamEvent>) => Observable<StreamEvent>
): Middleware {
  return (source$) => {
    console.log(`[${name} middleware] initialized`);
    return handler(source$);
  };
}

// 导出常用中间件
export { createLoggingMiddleware } from './logging.middleware';
export { createTokenCountingMiddleware } from './token-counting.middleware';
export { createTimeoutMiddleware } from './timeout.middleware';
export type { TokenCountingMiddlewareOptions } from './token-counting.middleware';
export type { TimeoutMiddlewareOptions } from './timeout.middleware';
