import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';

export interface AuthProvider extends OAuthClientProvider {}

export function createSSETransport(
  url: string,
  options?: {
    authProvider?: AuthProvider;
    requestInit?: RequestInit;
  }
) {
  return new SSEClientTransport(new URL(url), {
    authProvider: options?.authProvider,
    requestInit: options?.requestInit,
  });
}
