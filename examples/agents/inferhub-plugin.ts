import type { Plugin, ProviderContext, ProviderResult } from '../src/index.js';

async function getW3Token(): Promise<string> {
  const token = process.env.X_AUTH_TOKEN || process.env.INFERHUB_AUTH_TOKEN || '';
  if (!token) {
    throw new Error('W3 token not found. Set X_AUTH_TOKEN or INFERHUB_AUTH_TOKEN environment variable.');
  }
  return token;
}

export const inferhubPlugin: Plugin = {
  name: 'inferhub',
  version: '1.0.0',

  async provider(_ctx: ProviderContext): Promise<ProviderResult> {
    const token = await getW3Token();

    return {
      baseURL: process.env.INFERHUB_BASE_URL || 'https://ms-beta.devmate.huawei.com/codeAgent/chat/completions',
      tlsRejectUnauthorized: false,
      timeout: { total: 120000, firstToken: 60000, chunk: 30000 },
      headers: {
        'x-auth-token': token,
        'app-id': process.env.INFERHUB_APP_ID || 'CodeAgent2.0',
      },
      async fetch(input, init) {
        const currentToken = await getW3Token();
        const headers = new Headers(init?.headers);
        headers.set('x-auth-token', currentToken);
        return fetch(input, { ...init, headers });
      },
    };
  },

  hooks: {
    'llm.request.before': async (_input, output) => {
      output.headers['x-snap-traceid'] = crypto.randomUUID();
      output.headers['x-session-id'] = process.env.INFERHUB_SESSION_ID || crypto.randomUUID();
      output.headers['oc-heartbeat'] = '1';
      output.body['tool_stream'] = true;
      output.body['oc-heartbeat'] = '1';
    },
  },
};
