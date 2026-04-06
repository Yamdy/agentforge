import type { Context, Next } from 'hono';
import { AppError } from '../../errors/index.js';

export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    console.error('Server error:', err);
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.status as 400 | 401 | 403 | 404 | 500
      );
    }
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      500
    );
  }
}
