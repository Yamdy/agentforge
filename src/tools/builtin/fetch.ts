import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';

// ========== Zod Parameter Schema ==========

const FetchParams = z.object({
  url: z.string().describe('The URL to fetch'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    .optional()
    .describe('HTTP method to use (default: GET)'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional HTTP headers'),
  body: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .describe('Request body for POST/PUT/PATCH'),
});

type FetchParamsType = z.infer<typeof FetchParams>;

// ========== Metadata Interface ==========

interface FetchMetadata {
  status: number;
  statusText: string;
  truncated: boolean;
}

// ========== Tool Implementation ==========

export const FetchTool: Tool<FetchParamsType, FetchMetadata> = {
  name: 'fetch',
  description: 'Make an HTTP request to a URL and get the response',
  parameters: FetchParams,

  async execute(
    args: FetchParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<FetchMetadata>> {
    const { url, method = 'GET', headers = {}, body } = args;

    const FETCH_TIMEOUT = 30000;
    const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

    ctx.metadata({ title: `Fetching ${url}...` });

    try {
      const options: RequestInit = {
        method,
        headers: new Headers(headers),
        signal: ctx.abort.aborted
          ? AbortSignal.abort()
          : AbortSignal.timeout(FETCH_TIMEOUT),
      };

      if (body) {
        if (typeof body === 'object') {
          options.body = JSON.stringify(body);
          if (!headers['Content-Type']) {
            (options.headers as Headers).set('Content-Type', 'application/json');
          }
        } else {
          options.body = body;
        }
      }

      const response = await fetch(url, options);
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        const result = await response.json();
        const output = JSON.stringify(
          {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data: result,
          },
          null,
          2
        );

        return {
          title: `${response.status} ${response.statusText}`,
          output,
          metadata: {
            status: response.status,
            statusText: response.statusText,
            truncated: false,
          },
        };
      } else {
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
          const output = JSON.stringify(
            {
              status: response.status,
              statusText: response.statusText,
              text: `[Response truncated: content-length ${contentLength} exceeds ${MAX_RESPONSE_SIZE} byte limit]`,
            },
            null,
            2
          );

          return {
            title: `${response.status} ${response.statusText}`,
            output,
            metadata: {
              status: response.status,
              statusText: response.statusText,
              truncated: true,
            },
          };
        }

        const text = await response.text();
        const truncated = text.length > MAX_RESPONSE_SIZE;
        const result = truncated
          ? text.slice(0, MAX_RESPONSE_SIZE) + '\n\n[Response truncated: exceeded 5MB limit]'
          : text;

        const output = JSON.stringify(
          {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            text: result,
            ...(truncated && { truncated: true }),
          },
          null,
          2
        );

        return {
          title: `${response.status} ${response.statusText}`,
          output,
          metadata: {
            status: response.status,
            statusText: response.statusText,
            truncated,
          },
        };
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Fetch failed: ${errorMsg}`, { cause: error });
    }
  },
};

// ========== Legacy Export (for backward compatibility) ==========

export type FetchToolArgs = FetchParamsType;