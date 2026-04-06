import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function createStreamableHTTPTransport(
  url: string,
  options?: {
    authProvider?: any;
    requestInit?: RequestInit;
  }
) {
  return new StreamableHTTPClientTransport(new URL(url), {
    authProvider: options?.authProvider,
    requestInit: options?.requestInit,
  });
}
