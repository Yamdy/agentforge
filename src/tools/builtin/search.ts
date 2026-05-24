import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';

// ========== Zod Parameter Schema ==========

const SearchParams = z.object({
  query: z.string().describe('Search query'),
});

type SearchParamsType = z.infer<typeof SearchParams>;

// ========== Metadata Interface ==========

interface SearchMetadata {
  query: string;
  resultCount: number;
}

// ========== Tool Factory ==========

export function createSearchTool(apiKey?: string): Tool<SearchParamsType, SearchMetadata> {
  return {
    name: 'web_search',
    description: 'Search the web for information using Brave Search API',
    parameters: SearchParams,

    async execute(
      args: SearchParamsType,
      ctx: ToolContext
    ): Promise<ToolResult<SearchMetadata>> {
      const { query } = args;
      const searchApiKey = apiKey || process.env.BRAVE_API_KEY;

      ctx.metadata({ title: `Searching: ${query}...` });

      if (!searchApiKey) {
        return {
          title: 'Error',
          output: 'Error: BRAVE_API_KEY not configured. Please set BRAVE_API_KEY environment variable or pass it to createSearchTool. Get one at https://api.search.brave.com/',
          metadata: { query, resultCount: 0 },
        };
      }

      try {
        const response = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
          {
            headers: {
              Accept: 'application/json',
              'Accept-Encoding': 'gzip',
              'X-Subscription-Token': searchApiKey,
            },
            signal: ctx.abort.aborted ? AbortSignal.abort() : undefined,
          }
        );

        if (!response.ok) {
          return {
            title: 'Search failed',
            output: `Search failed: ${response.status} ${response.statusText}`,
            metadata: { query, resultCount: 0 },
          };
        }

        const data = (await response.json()) as Record<string, unknown>;
        const results = (data.web as Record<string, unknown> | undefined)?.results
          ? (
              (data.web as Record<string, unknown>).results as Record<string, unknown>[]
            ).slice(0, 10)
          : [];

        if (results.length === 0) {
          return {
            title: `No results: ${query}`,
            output: 'No results found.',
            metadata: { query, resultCount: 0 },
          };
        }

        let output = `Search results for "${query}":\n\n`;
        results.forEach((result: Record<string, unknown>, index: number) => {
          output += `${index + 1}. **${result.title}**\n${result.url}\n${result.description}\n\n`;
        });

        return {
          title: `${results.length} results for "${query}"`,
          output,
          metadata: { query, resultCount: results.length },
        };
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: 'Search error',
          output: `Search error: ${errorMsg}`,
          metadata: { query, resultCount: 0 },
        };
      }
    },
  };
}

// ========== Default Instance ==========

export const SearchTool: Tool<SearchParamsType, SearchMetadata> = createSearchTool();

// ========== Legacy Export (for backward compatibility) ==========

export type SearchToolArgs = SearchParamsType;