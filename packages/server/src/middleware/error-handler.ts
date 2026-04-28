/**
 * Error Handler Middleware for AgentForge Server
 *
 * Provides unified error response format.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================
// Types
// ============================================================

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
  timestamp: string;
}

// ============================================================
// HTTP Error Class
// ============================================================

/**
 * HTTP Error with status code
 */
export class HTTPError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HTTPError';
  }
}

// ============================================================
// Error Handler
// ============================================================

/**
 * Create an error handler function.
 *
 * Returns a function that handles errors and sends unified error responses.
 *
 * @returns Handler function that sends error response
 */
export function createErrorHandler() {
  return (err: unknown, _req: IncomingMessage, res: ServerResponse): void => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const code = err instanceof Error ? err.name : 'UnknownError';

    // Use status code from HTTPError, default to 500
    const statusCode = err instanceof HTTPError ? err.statusCode : 500;

    const response: ErrorResponse = {
      error: message,
      code,
      timestamp: new Date().toISOString(),
    };

    // Include details if present
    if (err instanceof HTTPError && err.details) {
      response.details = err.details;
    }

    // Log error
    if (statusCode >= 500) {
      console.error('[ERROR]', err);
    }

    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  };
}
