import { describe, it, expect } from 'vitest';
import { of } from 'rxjs';
import type { StreamEvent } from '../../src/types';
import { createLoggingMiddleware } from '../../src/middleware/logging.middleware';

describe('createLoggingMiddleware', () => {
  it('should pass through events when disabled', () => {
    const middleware = createLoggingMiddleware(false);
    const source$ = of({ type: 'text', content: 'hello' } as StreamEvent);
    let count = 0;
    middleware(source$).subscribe(() => count++);
    expect(count).toBe(1);
  });

  it('should pass through events when enabled', () => {
    // Logging doesn't change events, just logs
    const middleware = createLoggingMiddleware(true);
    const source$ = of({ type: 'text', content: 'hello' } as StreamEvent);

    let result: StreamEvent | undefined;
    let eventCount = 0;
    middleware(source$).subscribe((x) => {
      result = x;
      eventCount++;
    });

    expect(result).toEqual({ type: 'text', content: 'hello' });
    expect(eventCount).toBe(1);
  });
});
