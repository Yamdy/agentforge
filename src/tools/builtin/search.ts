import type { LegacyTool as Tool } from '../../types.js';

export interface SearchToolArgs {
  query: string;
}

export function createSearchTool(apiKey?: string): Tool {
  return {
    name: 'web_search',
    description: 'Search the web for information using Brave Search API',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
    execute: async (args: Record<string, unknown>) => {
      const query = args.query as string;
      const searchApiKey = apiKey || process.env.BRAVE_API_KEY;

      if (!searchApiKey) {
        return 'Error: BRAVE_API_KEY not configured. Please set BRAVE_API_KEY environment variable or pass it to createSearchTool. Get one at https://api.search.brave.com/';
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
          }
        );

        if (!response.ok) {
          return `Search failed: ${response.status} ${response.statusText}`;
        }

        const data = await response.json() as Record<string, unknown>;
        const results = (data.web as Record<string, unknown> | undefined)?.results
          ? ((data.web as Record<string, unknown>).results as Record<string, unknown>[]).slice(0, 10)
          : [];

        if (results.length === 0) {
          return 'No results found.';
        }

        let output = `Search results for "${query}":\n\n`;
        results.forEach((result: Record<string, unknown>, index: number) => {
          output += `${index + 1}. **${result.title}**\n${result.url}\n${result.description}\n\n`;
        });

        return output;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return `Search error: ${errorMsg}`;
      }
    },
  };
}

// Default instance with API key from environment
export const SearchTool: Tool = createSearchTool();
