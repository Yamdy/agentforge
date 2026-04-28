/**
 * Request Logger Middleware for AgentForge Server
 *
 * Logs incoming requests in Apache Combined Log Format variant.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================
// Types
// ============================================================

export interface LoggerOptions {
  /** Log level (default: 'info') */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Custom logger function */
  logger?: (message: string) => void;
}

// ============================================================
// Logger Handler
// ============================================================

/**
 * Create a request logger handler function.
 *
 * Logs requests in format: IP - "METHOD URL" STATUS SIZE DURATIONms "User-Agent"
 *
 * @param options - Logger configuration options
 * @returns Handler function that logs request on response finish
 */
export function createLoggerHandler(options?: LoggerOptions) {
  const logger = options?.logger ?? console.log;
  const level = options?.level ?? 'info';

  return (req: IncomingMessage, res: ServerResponse, startTime: number): void => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const userAgent = req.headers['user-agent'] ?? '-';
    const ip = req.socket.remoteAddress ?? '-';

    // Log on response finish or close (SSE streams may not trigger finish)
    const logResponse = () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      const contentLength = res.getHeader('content-length') ?? '-';

      const message = `${ip} - "${method} ${url}" ${statusCode} ${contentLength} ${duration}ms "${userAgent}"`;

      if (statusCode >= 500) {
        logger(`[ERROR] ${message}`);
      } else if (statusCode >= 400) {
        if (level === 'debug' || level === 'info' || level === 'warn') {
          logger(`[WARN] ${message}`);
        }
      } else {
        if (level === 'debug' || level === 'info') {
          logger(message);
        }
      }
    };

    // Use both finish and close events for SSE compatibility
    let logged = false;
    const safeLog = () => {
      if (!logged) {
        logged = true;
        logResponse();
      }
    };

    res.on('finish', safeLog);
    res.on('close', safeLog);
  };
}
