import type { AuthAdapter, AuthResult } from '@primo-ai/sdk';

export class StaticKeyAuthAdapter implements AuthAdapter {
  constructor(private apiKey: string) {}

  async authenticate(request: { header(name: string): string | undefined }): Promise<AuthResult> {
    const header = request.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return { authenticated: false, error: 'Missing Authorization header' };
    }
    if (header.slice(7) !== this.apiKey) {
      return { authenticated: false, error: 'Invalid API key' };
    }
    return { authenticated: true };
  }
}
