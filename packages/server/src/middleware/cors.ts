/**
 * CORS Middleware for AgentForge Server
 *
 * Handles Cross-Origin Resource Sharing (CORS) headers and preflight requests.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================
// Types
// ============================================================

export interface CORSOptions {
  /** Allowed origins (default: '*') */
  origin?: string | string[];
  /** Allowed methods (default: 'GET,POST,PUT,DELETE,OPTIONS') */
  methods?: string[];
  /** Allowed headers (default: 'Content-Type,Authorization') */
  headers?: string[];
  /** Allow credentials (default: false) */
  credentials?: boolean;
  /** Max age for preflight cache in seconds (default: 86400) */
  maxAge?: number;
}

// ============================================================
// CORS Handler
// ============================================================

/**
 * Create a CORS handler function.
 *
 * Returns a function that handles CORS headers for incoming requests.
 * If the request is a preflight (OPTIONS), it responds with 204 and returns true.
 * Otherwise, it sets CORS headers and returns false (caller should continue).
 *
 * @param options - CORS configuration options
 * @returns Handler function that returns true if request was handled (preflight)
 */
export function createCORSHandler(options?: CORSOptions) {
  const origin = options?.origin ?? '*';
  const methods = options?.methods?.join(',') ?? 'GET,POST,PUT,DELETE,OPTIONS';
  const headers = options?.headers?.join(',') ?? 'Content-Type,Authorization';
  const credentials = options?.credentials ?? false;
  const maxAge = options?.maxAge ?? 86400;

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const reqOrigin = req.headers.origin;

    // Handle preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
      // Set origin - CORS spec only allows single origin or '*'
      if (Array.isArray(origin)) {
        if (reqOrigin && origin.includes(reqOrigin)) {
          res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        } else {
          // No match - use first origin as fallback
          res.setHeader('Access-Control-Allow-Origin', origin[0]!);
        }
      } else {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }

      res.setHeader('Access-Control-Allow-Methods', methods);
      res.setHeader('Access-Control-Allow-Headers', headers);
      if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', maxAge);
      res.statusCode = 204;
      res.end();
      return true; // Handled
    }

    // Set CORS headers for actual requests
    if (Array.isArray(origin)) {
      if (reqOrigin && origin.includes(reqOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      }
      // No match - don't set origin header (browser will block)
    } else {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');

    return false; // Not handled, continue
  };
}
