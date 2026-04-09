import type { Tool } from '../../types.js';

export interface FetchToolArgs {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | object;
}

export const FetchTool: Tool = {
  name: 'fetch',
  description: 'Make an HTTP request to a URL and get the response',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        default: 'GET',
        description: 'HTTP method to use',
      },
      headers: {
        type: 'object',
        description: 'Optional HTTP headers',
        additionalProperties: { type: 'string' },
      },
      body: {
        type: ['string', 'object'],
        description: 'Request body for POST/PUT/PATCH',
      },
    },
    required: ['url'],
  },
  execute: async (args: Record<string, unknown>) => {
    const url = args.url as string;
    const method = (args.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH') || 'GET';
    const headers = (args.headers as Record<string, string>) || {};
    const body = args.body as string | object | undefined;

    try {
      const options: RequestInit = {
        method,
        headers: new Headers(headers),
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
      let result;

      if (contentType?.includes('application/json')) {
        result = await response.json();
        return JSON.stringify(
          {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data: result,
          },
          null,
          2
        );
      } else {
        result = await response.text();
        return JSON.stringify(
          {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            text: result,
          },
          null,
          2
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Fetch failed: ${errorMsg}`);
    }
  },
};
