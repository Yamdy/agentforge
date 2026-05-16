import { describe, it, expect, vi } from 'vitest';
import { streamWithRetry } from '../src/retry.js';

describe('streamWithRetry', () => {
  it('retries on transient errors (429/500) with exponential backoff', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        const error = new Error('Rate limited');
        (error as Error & { statusCode: number }).statusCode = 429;
        throw error;
      }
      return 'success';
    });

    const result = await streamWithRetry(fn, { maxRetries: 3, baseDelay: 1 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on auth errors (401)', async () => {
    const fn = vi.fn(async () => {
      const error = new Error('Unauthorized');
      (error as Error & { statusCode: number }).statusCode = 401;
      throw error;
    });

    await expect(streamWithRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on invalid request errors (400)', async () => {
    const fn = vi.fn(async () => {
      const error = new Error('Bad request');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    });

    await expect(streamWithRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toThrow('Bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after max retries', async () => {
    const fn = vi.fn(async () => {
      const error = new Error('Server error');
      (error as Error & { statusCode: number }).statusCode = 500;
      throw error;
    });

    await expect(streamWithRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toThrow('Server error');
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('retries on AI_SDK errors without statusCode (network errors)', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) throw new Error('Network timeout');
      return 'success';
    });

    const result = await streamWithRetry(fn, { maxRetries: 3, baseDelay: 1 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
