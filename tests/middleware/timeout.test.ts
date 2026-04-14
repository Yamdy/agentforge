import { describe, it, expect } from 'vitest';
import { of, delay } from 'rxjs';
import { createTimeoutMiddleware } from '../../src/middleware/timeout.middleware';

describe('createTimeoutMiddleware', () => {
  it('should not timeout if completes before timeout', async () => {
    const middleware = createTimeoutMiddleware({ timeoutMs: 100 });
    const source$ = of({ type: 'done', response: { content: 'done', finishReason: 'stop' } });

    const result = new Promise((resolve, reject) => {
      let completed = false;
      middleware(source$).subscribe({
        next: () => (completed = true),
        complete: () => resolve(completed),
        error: reject,
      });
    });

    expect(await result).toBe(true);
  });

  it('should timeout if does not complete before timeout', async () => {
    const middleware = createTimeoutMiddleware({ timeoutMs: 50 });
    // Create a slow observable that doesn't complete in time
    const source$ = of({ type: 'text', content: 'waiting' }).pipe(delay(100));

    const result = new Promise((resolve, reject) => {
      middleware(source$).subscribe({
        error: (err) => reject(err),
        complete: resolve,
      });
    });

    await expect(result).rejects.toThrow(/timeout/);
  });
});
