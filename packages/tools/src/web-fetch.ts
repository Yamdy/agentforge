import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export interface WebFetchOptions {
  timeout?: number;
}

export function createWebFetchTool(options: WebFetchOptions = {}) {
  const timeout = options.timeout ?? 30000;

  return {
    name: 'web_fetch',
    description: 'Fetch and extract content from a web page.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to fetch'),
      maxLength: z.number().optional().default(10000).describe('Maximum content length'),
    }),
    outputSchema: z.object({
      content: z.string(),
      title: z.string().optional(),
      status: z.number(),
    }),
    requireApproval: false,
    async execute(input: { url: string; maxLength?: number }) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(input.url, { signal: controller.signal });
        const html = await res.text();

        // Strip scripts and styles
        let content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch?.[1]?.trim();

        // Truncate if needed
        if (content.length > (input.maxLength ?? 10000)) {
          content = content.slice(0, input.maxLength ?? 10000) + '... [truncated]';
        }

        return { content, title, status: res.status };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    renderCall: (i: { url: string }) => `web_fetch("${i.url}")`,
    renderResult: (o: { content: string; status: number }) =>
      `[${o.status}] ${o.content.slice(0, 100)}...`,
  } as Tool<{ url: string; maxLength?: number }, { content: string; title?: string; status: number }>;
}

export const webFetchTool = createWebFetchTool();
