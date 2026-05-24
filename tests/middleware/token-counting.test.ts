import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import type { StreamEvent } from '../../src/types';
import {
  createTokenCountingMiddleware,
  type TokenCountingMiddlewareOptions,
} from '../../src/middleware/token-counting.middleware';

describe('createTokenCountingMiddleware', () => {
  it('should estimate tokens from text events', () => {
    let countedTokens = 0;
    const onComplete = (tokens: number) => {
      countedTokens = tokens;
    };

    const middleware = createTokenCountingMiddleware({ enabled: true, onComplete });
    const source$ = of({ type: 'text', content: 'Hello world' } as StreamEvent, {
      type: 'done',
      response: { content: 'Hello world', finishReason: 'stop' },
    });

    let events = 0;
    middleware(source$).subscribe(() => events++);

    expect(events).toBe(2);
    // "Hello world" → 2 words → ~3 tokens
    expect(countedTokens).toBeGreaterThan(0);
    expect(countedTokens).toBeLessThanOrEqual(3);
  });

  it('should do nothing when disabled', () => {
    let called = false;
    const onComplete = () => {
      called = true;
    };
    const middleware = createTokenCountingMiddleware({ enabled: false, onComplete });
    const source$ = of({ type: 'text', content: 'Hello world' });

    let events = 0;
    middleware(source$).subscribe(() => events++);

    expect(events).toBe(1);
    expect(called).toBe(false);
  });

  it('should accumulate text from multiple text events', () => {
    let countedTokens = 0;
    const onComplete = (tokens: number) => {
      countedTokens = tokens;
    };

    const middleware = createTokenCountingMiddleware({ enabled: true, onComplete });
    const source$ = of(
      { type: 'text', content: 'First ' } as StreamEvent,
      { type: 'text', content: 'second ' } as StreamEvent,
      { type: 'text', content: 'third' } as StreamEvent,
      { type: 'done', response: { content: 'done', finishReason: 'stop' } }
    );

    middleware(source$).subscribe();

    // "First second third" → 3 words → ~4 tokens
    expect(countedTokens).toBe(4);
  });
});
