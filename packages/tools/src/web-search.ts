import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export interface WebSearchOptions {
  provider?: 'duckduckgo';
}

export function createWebSearchTool(options: WebSearchOptions = {}) {
  // Provider option reserved for future multi-provider support
  void options.provider;

  return {
    name: 'web_search',
    description: 'Search the web for information using DuckDuckGo.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      maxResults: z.number().optional().default(5).describe('Maximum number of results'),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
        })
      ),
    }),
    requireApproval: false,
    async execute(input: { query: string; maxResults?: number }) {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(input.query)}&format=json&no_html=1`;
      const res = await fetch(url);
      const data = (await res.json()) as {
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const results = (data.RelatedTopics ?? [])
        .filter(
          (t): t is { Text: string; FirstURL: string } => !!t.Text && !!t.FirstURL
        )
        .slice(0, input.maxResults ?? 5)
        .map((t) => ({
          title: t.Text.split(' - ')[0] ?? '',
          url: t.FirstURL,
          snippet: t.Text,
        }));

      return { results };
    },
    renderCall: (i: { query: string }) => `web_search("${i.query}")`,
    renderResult: (o: { results: unknown[] }) => `Found ${o.results.length} results`,
  } as Tool<{ query: string; maxResults?: number }, { results: Array<{ title: string; url: string; snippet: string }> }>;
}

export const webSearchTool = createWebSearchTool();
