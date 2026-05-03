/**
 * WebSearchTool — Web search via Exa API with mock fallback.
 *
 * Provides a sandboxed web search capability:
 * - Exa API integration for real searches
 * - Mock mode fallback when no API key is configured
 * - Input validation via Zod schema
 * - Timeout handling via AbortController
 * - Formatted results: [N] Title\nURL\nSnippet
 */

import { z } from 'zod';
import type { ToolDefinition, ToolContext } from '../core/interfaces.js';

// ============================================================
// Configuration
// ============================================================

export interface WebSearchToolConfig {
  /** Provider to use. 'exa' for Exa API, 'mock' for mock mode. Default: 'exa' if apiKey set, 'mock' otherwise */
  provider?: 'exa' | 'mock';
  /** Exa API key (required for real searches) */
  apiKey?: string;
  /** Maximum number of results to return (reserved for future use) */
  maxResults?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const EXA_API_URL = 'https://api.exa.ai/search';

// ============================================================
// Zod Schema
// ============================================================

const WebSearchSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  numResults: z.number().min(1).max(20).optional().default(5),
});

// ============================================================
// Helpers
// ============================================================

/**
 * Format Exa API search results into a readable text format.
 */
function formatResults(results: Array<{ title?: string; url?: string; text?: string }>): string {
  if (!results || results.length === 0) {
    return 'No results found.';
  }

  return results
    .map((r, i) => {
      const title = r.title ?? 'Untitled';
      const url = r.url ?? '(no URL)';
      const snippet = r.text ?? '(no snippet)';
      return `[${i + 1}] ${title}\n${url}\n${snippet}`;
    })
    .join('\n\n');
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create the web_search tool with the given configuration.
 *
 * @param config - Configuration for the web search tool
 * @returns Array of ToolDefinition(s) for web_search
 */
export function createWebSearchTool(config?: WebSearchToolConfig): ToolDefinition[] {
  const apiKey = config?.apiKey;
  const provider = config?.provider ?? (apiKey ? 'exa' : 'mock');
  const timeout = config?.timeout ?? DEFAULT_TIMEOUT;

  const shouldUseExa = provider === 'exa' && !!apiKey;

  return [
    {
      name: 'web_search',
      description:
        'Search the web using Exa API and return formatted results. ' +
        'Each result includes title, URL, and a text snippet. ' +
        'Falls back to mock mode when no API key is configured.',
      parameters: WebSearchSchema,
      execute: async (args: unknown, ctx?: ToolContext): Promise<string> => {
        // Validate arguments (always validate, even in mock mode)
        const parsed = WebSearchSchema.safeParse(args);
        if (!parsed.success) {
          return `Error: Invalid arguments. ${parsed.error.message}`;
        }

        const { query, numResults } = parsed.data;

        // Mock mode — return placeholder
        if (!shouldUseExa) {
          return '[Search mock] No results provider configured';
        }

        // Real Exa API call
        const controller = new AbortController();
        const ctxTimeout = ctx?.timeout ?? timeout;
        const timeoutId = setTimeout(() => controller.abort(), ctxTimeout);

        // Respect context abort signal if provided
        let abortHandler: (() => void) | undefined;
        if (ctx?.signal) {
          abortHandler = () => controller.abort();
          ctx.signal.addEventListener('abort', abortHandler, { once: true });
        }

        try {
          const response = await fetch(EXA_API_URL, {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, numResults }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            return `Error: Exa API returned ${response.status} ${response.statusText}. ${errorText}`;
          }

          let data: unknown;
          try {
            data = await response.json();
          } catch {
            return 'Error: Failed to parse Exa API response as JSON.';
          }

          if (!data || typeof data !== 'object' || !('results' in data)) {
            return 'Error: Invalid response from Exa API (missing results field).';
          }

          const results = (data as { results: unknown }).results;
          if (!Array.isArray(results)) {
            return 'Error: Invalid response from Exa API (results is not an array).';
          }

          return formatResults(results as Array<{ title?: string; url?: string; text?: string }>);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (
            (err instanceof DOMException && err.name === 'AbortError') ||
            (err as Error)?.name === 'AbortError'
          ) {
            return `Error: Exa API request timed out after ${ctxTimeout}ms`;
          }
          return `Error: Exa API request failed: ${message}`;
        } finally {
          clearTimeout(timeoutId);
          if (abortHandler && ctx?.signal) {
            ctx.signal.removeEventListener('abort', abortHandler);
          }
        }
      },
    },
  ];
}
