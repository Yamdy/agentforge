export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
}

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

function isRetryable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as { statusCode: number }).statusCode;
    return !NON_RETRYABLE_STATUS_CODES.has(statusCode);
  }
  return true;
}

export async function streamWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt >= options.maxRetries) {
        throw error;
      }

      const delay = options.baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
