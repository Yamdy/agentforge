import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export function createSSETransport(
  url: string,
  options?: {
    authProvider?: any;
    requestInit?: RequestInit;
  }
) {
  return new SSEClientTransport(new URL(url), {
    authProvider: options?.authProvider,
    requestInit: options?.requestInit,
  });
}
