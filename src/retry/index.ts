export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: number;
  shouldRetry?: (error: Error) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = 2, shouldRetry } = options;

  let lastError: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxAttempts) break;
      if (shouldRetry && !shouldRetry(lastError)) break;

      const delay = delayMs * Math.pow(backoff, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError!;
}
