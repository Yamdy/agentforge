import { Observable, tap } from 'rxjs';
import type { StreamEvent } from '../types';
import { createLogger } from '../logger/index.js';
import type { Middleware } from './index.js';

const log = createLogger('middleware:logging');

/**
 * 日志中间件 - 记录每个流事件
 * 用于调试和观察
 */
export function createLoggingMiddleware(enabled: boolean = true): Middleware {
  return (source$: Observable<StreamEvent>) => {
    if (!enabled) {
      return source$;
    }
    return source$.pipe(
      tap((event) => {
        log.debug('Stream event', {
          type: event.type,
          hasContent: 'content' in event,
        });
      })
    );
  };
}
