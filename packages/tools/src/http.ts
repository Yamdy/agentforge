import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const httpTool: Tool<
  { url: string; method?: string; headers?: Record<string, string>; body?: string },
  { status: number; headers: Record<string, string>; body: string }
> = {
  name: 'http',
  description:
    'Make HTTP requests. Supports GET, POST, PUT, PATCH, DELETE. Returns status, headers, and body.',
  inputSchema: z.object({
    url: z.string().describe('The URL to request'),
    method: z
      .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      .optional()
      .default('GET')
      .describe('HTTP method'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('Request headers'),
    body: z.string().optional().describe('Request body (for POST/PUT/PATCH)'),
  }),
  outputSchema: z.object({
    status: z.number(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
  requireApproval: (input) => !['GET', 'HEAD'].includes((((input as Record<string, unknown>).method ?? 'GET') as string).toUpperCase()),
  async execute(input) {
    const { url, method = 'GET', headers = {}, body } = input;

    const reqHeaders = new Headers();
    reqHeaders.set('User-Agent', 'AgentForge/1.0');
    for (const [k, v] of Object.entries(headers)) {
      reqHeaders.set(k, v);
    }

    const res = await fetch(url, {
      method,
      headers: reqHeaders,
      body: ['GET', 'DELETE'].includes(method) ? undefined : body,
    });

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });

    const resBody = await res.text();
    return { status: res.status, headers: resHeaders, body: resBody };
  },
  renderCall(input) {
    return `${input.method ?? 'GET'} ${input.url}`;
  },
  renderResult(output) {
    return `[${output.status}] ${output.body.slice(0, 200)}`;
  },
};
