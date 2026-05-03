/**
 * WebFetchTool — HTTP request tool with domain filtering and response truncation.
 *
 * Provides a sandboxed web fetch capability:
 * - Domain allow/blocklist for security
 * - Timeout via AbortController
 * - Response truncation at configurable max size
 * - Supports GET and POST requests
 */

import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../core/interfaces.js';

// ============================================================
// Configuration
// ============================================================

export interface WebFetchToolConfig {
  /** Default timeout in milliseconds (default: 30000) */
  defaultTimeout?: number;
  /** Maximum response body size in characters (default: 100000) */
  maxResponseSize?: number;
  /** Allowed domains — if set, only these domains are permitted */
  allowedDomains?: string[];
  /** Blocked domains — requests to these domains are rejected */
  blockedDomains?: string[];
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RESPONSE_SIZE = 100_000;

// ============================================================
// Zod Schema
// ============================================================

const WebFetchSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

// ============================================================
// Helpers
// ============================================================

/**
 * Extract the hostname from a URL string.
 */
function getHostname(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Check if a hostname matches a domain or is a subdomain of it.
 * For example, 'api.example.com' matches 'example.com'.
 */
function matchesDomain(hostname: string, domain: string): boolean {
  const normalized = domain.toLowerCase();
  if (hostname === normalized) return true;
  if (hostname.endsWith('.' + normalized)) return true;
  return false;
}

/**
 * Check if a hostname is allowed given the allowlist and blocklist.
 * Blocklist takes precedence over allowlist.
 */
function checkDomainAccess(
  hostname: string,
  allowedDomains?: string[],
  blockedDomains?: string[]
): { allowed: boolean; reason?: string } {
  // Blocklist check (blocklist takes precedence)
  if (blockedDomains && blockedDomains.length > 0) {
    for (const domain of blockedDomains) {
      if (matchesDomain(hostname, domain)) {
        return {
          allowed: false,
          reason: `Domain "${hostname}" is blocked (matches blocked domain "${domain}")`,
        };
      }
    }
  }

  // Allowlist check
  if (allowedDomains && allowedDomains.length > 0) {
    for (const domain of allowedDomains) {
      if (matchesDomain(hostname, domain)) {
        return { allowed: true };
      }
    }
    return {
      allowed: false,
      reason: `Domain "${hostname}" is not in the allowed domains list`,
    };
  }

  return { allowed: true };
}

/**
 * Format response headers into a compact summary string.
 */
function formatHeaders(headers: Headers): string {
  const importantHeaders = ['content-type', 'content-length', 'server', 'date'];
  const parts: string[] = [];
  for (const name of importantHeaders) {
    const value = headers.get(name);
    if (value) {
      parts.push(`${name}: ${value}`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'no headers';
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create the web_fetch tool with the given configuration.
 *
 * @param config - Configuration for the web fetch tool
 * @returns ToolDefinition for web_fetch
 */
export function createWebFetchTool(config: WebFetchToolConfig): ToolDefinition {
  const defaultTimeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;
  const maxResponseSize = config.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE;
  const allowedDomains = config.allowedDomains;
  const blockedDomains = config.blockedDomains;

  return {
    name: 'web_fetch',
    description:
      'Fetch content from a URL via HTTP GET or POST. ' +
      'Returns the response status, headers, and body. ' +
      'Supports domain allow/blocklisting for security. ' +
      'Large responses are truncated to the configured max size.',
    parameters: WebFetchSchema,
    execute: async (args: unknown, ctx?: ToolContext): Promise<string> => {
      // Validate arguments
      const parsed = WebFetchSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { url, method, headers: customHeaders, body } = parsed.data;

      // Check domain access
      const hostname = getHostname(url);
      if (!hostname) {
        return `Error: Could not parse hostname from URL "${url}"`;
      }

      const domainCheck = checkDomainAccess(hostname, allowedDomains, blockedDomains);
      if (!domainCheck.allowed) {
        return `Error: Access denied. ${domainCheck.reason}`;
      }

      // Determine timeout (context timeout overrides config default)
      const timeout = ctx?.timeout ?? defaultTimeout;

      // Setup AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Respect context abort signal if provided
      let abortHandler: (() => void) | undefined;
      if (ctx?.signal) {
        abortHandler = () => controller.abort();
        ctx.signal.addEventListener('abort', abortHandler, { once: true });
      }

      try {
        const fetchOptions: RequestInit = {
          method,
          signal: controller.signal,
        };

        if (customHeaders && Object.keys(customHeaders).length > 0) {
          fetchOptions.headers = customHeaders;
        }

        if (method === 'POST' && body !== undefined) {
          fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);

        let responseBody = await response.text();

        // Truncate if needed
        if (responseBody.length > maxResponseSize) {
          const originalSize = responseBody.length;
          responseBody =
            responseBody.slice(0, maxResponseSize) +
            `\n\n[Response truncated at ${maxResponseSize} characters. ` +
            `Original size: ${originalSize} approx.]`;
        }

        const headerSummary = formatHeaders(response.headers);

        return `[${response.status} ${response.statusText}] ${headerSummary}\n\n${responseBody}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err as Error)?.name === 'AbortError'
        ) {
          return `Error: Request to "${url}" timed out after ${timeout}ms`;
        }
        return `Error: Failed to fetch "${url}": ${message}`;
      } finally {
        clearTimeout(timeoutId);
        if (abortHandler && ctx?.signal) {
          ctx.signal.removeEventListener('abort', abortHandler);
        }
      }
    },
  };
}
