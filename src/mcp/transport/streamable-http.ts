import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AuthProvider } from './sse.js';

export function createStreamableHTTPTransport(
  url: string,
  options?: {
    authProvider?: AuthProvider;
    requestInit?: RequestInit;
  }
) {
  return new StreamableHTTPClientTransport(new URL(url), {
    authProvider: options?.authProvider,
    requestInit: options?.requestInit,
  });
}
