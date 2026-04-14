import { Observable, tap } from 'rxjs';
import type { StreamEvent } from '../types';
import { createLogger } from '../logger/index.js';
import type { Middleware } from './index.js';

const log = createLogger('middleware:token-counting');

/**
 * Token 计数中间件 - 统计输出 tokens 数量
 * 近似计算：每个单词约 1.3 个 token
 */
export interface TokenCountingMiddlewareOptions {
  enabled?: boolean;
  onComplete?: (totalTokens: number) => void;
}

function estimateTokens(text: string): number {
  // 简单估计：按空格分词，每个单词约 1.3 tokens
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words * 1.3);
}

export function createTokenCountingMiddleware(
  options: TokenCountingMiddlewareOptions = {}
): Middleware {
  const { enabled = true, onComplete } = options;
  let totalText = '';

  if (!enabled) {
    return (source$) => source$;
  }

  return (source$: Observable<StreamEvent>) => {
    return source$.pipe(
      tap((event) => {
        if (event.type === 'text' && event.content) {
          totalText += event.content;
        }
        if (event.type === 'done') {
          const tokens = estimateTokens(totalText);
          log.debug('Response token estimate', { tokens });
          onComplete?.(tokens);
        }
      })
    );
  };
}
