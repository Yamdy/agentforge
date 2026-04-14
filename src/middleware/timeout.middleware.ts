import { Observable, timeout, catchError } from 'rxjs';
import type { StreamEvent } from '../types';
import type { Middleware } from './index.js';

export interface TimeoutMiddlewareOptions {
  timeoutMs: number;
}

/**
 * 超时中间件 - 如果流在指定时间内没完成就中断
 */
export function createTimeoutMiddleware(options: TimeoutMiddlewareOptions): Middleware {
  const { timeoutMs } = options;

  return (source$: Observable<StreamEvent>) => {
    return source$.pipe(
      timeout(timeoutMs),
      catchError((err) => {
        if (err.name === 'TimeoutError') {
          throw new Error(`Stream timeout after ${timeoutMs}ms`);
        }
        throw err;
      })
    );
  };
}
