/**
 * Authentication Middleware for AgentForge Server
 *
 * Supports API Key and JWT authentication.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================
// Types
// ============================================================

export interface AuthOptions {
  /** API Key(s) for authentication */
  apiKeys?: string[];
  /** JWT secret for token verification (TODO: implement verification) */
  jwtSecret?: string;
  /** Paths that don't require authentication */
  publicPaths?: string[];
  /** Custom authentication function */
  customAuth?: (req: IncomingMessage) => Promise<boolean>;
}

// ============================================================
// Auth Handler
// ============================================================

/**
 * Create an authentication handler function.
 *
 * Returns a function that checks authentication for incoming requests.
 * If authentication fails, it responds with 401 and returns true.
 * If authentication succeeds or path is public, it returns false (caller should continue).
 *
 * Authentication methods (checked in order):
 * 1. API Key (via Authorization: Bearer <key> or X-API-Key header)
 * 2. JWT token (via Authorization: Bearer <token>) - TODO: implement verification
 * 3. Custom auth function
 *
 * @param options - Authentication configuration options
 * @returns Handler function that returns true if request was handled (auth failed)
 */
export function createAuthHandler(options?: AuthOptions) {
  const publicPaths = new Set([
    '/health',
    '/ready',
    '/metrics',
    '/docs',
    '/swagger',
    ...(options?.publicPaths ?? []),
  ]);

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';

    // Skip auth for public paths
    if (publicPaths.has(pathname)) {
      return false; // Not handled, continue
    }

    // Skip auth for OPTIONS (CORS preflight)
    if (req.method === 'OPTIONS') {
      return false;
    }

    // Skip auth if no auth methods configured
    const hasApiKeys = options?.apiKeys && options.apiKeys.length > 0;
    const hasJwt = !!options?.jwtSecret;
    const hasCustomAuth = !!options?.customAuth;
    if (!hasApiKeys && !hasJwt && !hasCustomAuth) {
      return false; // No auth configured, skip
    }

    // Check API Key
    if (hasApiKeys && options?.apiKeys) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (options.apiKeys.includes(token)) {
          return false; // Authenticated
        }
      }

      // Also check X-API-Key header
      const apiKeyHeader = req.headers['x-api-key'];
      if (typeof apiKeyHeader === 'string' && options.apiKeys.includes(apiKeyHeader)) {
        return false; // Authenticated
      }
    }

    // Check JWT
    if (options?.jwtSecret) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        // TODO: Implement JWT verification with jsonwebtoken or jose
        // For now, just check if token is not empty
        if (token) {
          return false; // Authenticated (placeholder - not actually verified!)
        }
      }
    }

    // Custom auth
    if (options?.customAuth) {
      const authenticated = await options.customAuth(req);
      if (authenticated) {
        return false; // Authenticated
      }
    }

    // Authentication failed
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return true; // Handled
  };
}
